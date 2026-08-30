const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_POLICY_KEY = "approval-pending";

const epoch = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : null;
};

const boundedPolicyKey = (value) => {
  const key = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-z0-9][a-z0-9._-]{0,79}$/u.test(key) ? key : DEFAULT_RETENTION_POLICY_KEY;
};

// There is intentionally no deletion deadline here. Product/legal must approve
// one before a purge worker exists. Deployments may name a policy and optional
// review interval now, which makes every archive auditable without silently
// converting "not decided" into indefinite retention.
export function loungeArchiveRetentionPolicy(at, env = process.env) {
  const archivedAt = epoch(at) || Date.now();
  const reviewDays = Number.parseInt(env?.LOUNGE_ARCHIVE_REVIEW_DAYS || "", 10);
  return {
    key: boundedPolicyKey(env?.LOUNGE_ARCHIVE_RETENTION_POLICY),
    reviewAt: Number.isSafeInteger(reviewDays) && reviewDays >= 1 && reviewDays <= 3650
      ? archivedAt + reviewDays * DAY_MS
      : null,
  };
}

export function resolveLoungeWindow({ doorsOpenAt = null, showStartAt = null } = {}, at = Date.now()) {
  const doors = epoch(doorsOpenAt);
  const start = epoch(showStartAt);
  const basisAt = doors || start;
  if (!basisAt) {
    return { status: "open", timingKnown: false, cutoffAt: null, cutoffSource: null };
  }
  const cutoffAt = basisAt + DAY_MS;
  return {
    status: epoch(at) >= cutoffAt ? "closed" : "open",
    timingKnown: true,
    cutoffAt,
    cutoffSource: doors ? "doors_open" : "show_start",
  };
}

export function createLoungeLifecycleService({
  database,
  attendanceRepository,
  atomicWrite = (work) => work(),
  env = process.env,
} = {}) {
  if (!database?.prepare || !attendanceRepository?.resolveShow || typeof atomicWrite !== "function") {
    throw new TypeError("Lounge lifecycle service requires database, attendance, and transaction boundaries");
  }

  const roomById = database.prepare("SELECT * FROM concert_lounges WHERE lounge_id=?");
  const latestGoingIdentity = database.prepare(`SELECT artist FROM going
    WHERE concert_key=? ORDER BY created_at DESC,user_id LIMIT 1`);
  const messageCount = database.prepare("SELECT COUNT(*) count FROM lounge_messages WHERE lounge_id=?");
  const insertOpenRoom = database.prepare(`INSERT OR IGNORE INTO concert_lounges
    (lounge_id,show_id,artist,doors_open_at,show_start_at,cutoff_at,cutoff_source,
      status,created_at,updated_at)
    VALUES (@loungeId,@showId,@artist,@doorsOpenAt,@showStartAt,@cutoffAt,@cutoffSource,
      'open',@createdAt,@updatedAt)`);
  const insertArchivedRoom = database.prepare(`INSERT OR IGNORE INTO concert_lounges
    (lounge_id,show_id,artist,doors_open_at,show_start_at,cutoff_at,cutoff_source,
      status,closed_at,archived_at,retention_policy_key,retention_review_at,created_at,updated_at)
    VALUES (@loungeId,@showId,@artist,@doorsOpenAt,@showStartAt,@cutoffAt,@cutoffSource,
      'archived',@closedAt,@archivedAt,@retentionPolicyKey,@retentionReviewAt,@createdAt,@updatedAt)`);
  const archiveRoom = database.prepare(`UPDATE concert_lounges SET
    status='archived',closed_at=?,archived_at=COALESCE(archived_at,?),
    retention_policy_key=COALESCE(retention_policy_key,?),
    retention_review_at=COALESCE(retention_review_at,?),updated_at=?
    WHERE lounge_id=? AND status<>'archived'`);
  const deleteEmptyRoom = database.prepare("DELETE FROM concert_lounges WHERE lounge_id=?");

  function identity(key, existingRoom = null) {
    const show = attendanceRepository.resolveShow(key);
    const artist = String(existingRoom?.artist || show?.artist || latestGoingIdentity.get(key)?.artist || "").trim();
    return {
      show,
      artist,
      showId: existingRoom?.show_id || (show?.persisted ? show.id : null),
    };
  }

  function snapshot(key, at = Date.now(), { register = false } = {}) {
    const requestAt = epoch(at) || Date.now();
    let room = roomById.get(key) || null;
    const entity = identity(key, room);
    // Only a server-maintained room may supply a verified doors time. Provider
    // access time is deliberately excluded because it is not proof of doors.
    const window = resolveLoungeWindow({
      doorsOpenAt: room?.doors_open_at,
      showStartAt: room?.show_start_at || entity.show?.startAt,
    }, requestAt);
    const common = {
      loungeId: key,
      showId: entity.showId,
      artist: entity.artist,
      doorsOpenAt: epoch(room?.doors_open_at),
      showStartAt: epoch(room?.show_start_at || entity.show?.startAt),
      cutoffAt: window.cutoffAt,
      cutoffSource: window.cutoffSource,
    };

    if (room?.status === "archived" || window.status === "closed") {
      atomicWrite(() => {
        const count = Number(messageCount.get(key)?.count) || 0;
        if (!count) {
          if (room) deleteEmptyRoom.run(key);
          room = null;
          return;
        }
        const policy = loungeArchiveRetentionPolicy(requestAt, env);
        const archivedValues = {
          ...common,
          closedAt: window.cutoffAt || room?.cutoff_at || requestAt,
          archivedAt: requestAt,
          retentionPolicyKey: policy.key,
          retentionReviewAt: policy.reviewAt,
          createdAt: room?.created_at || requestAt,
          updatedAt: requestAt,
        };
        if (room) {
          archiveRoom.run(
            archivedValues.closedAt,
            archivedValues.archivedAt,
            archivedValues.retentionPolicyKey,
            archivedValues.retentionReviewAt,
            requestAt,
            key,
          );
        } else if (window.cutoffAt) {
          insertArchivedRoom.run(archivedValues);
        }
        room = roomById.get(key) || null;
      });
      return {
        ...common,
        status: "closed",
        timingKnown: window.timingKnown || !!room?.cutoff_at,
        archived: !!room,
        retentionPolicyKey: room?.retention_policy_key || null,
        retentionReviewAt: epoch(room?.retention_review_at),
      };
    }

    if (register && window.timingKnown && !room) {
      insertOpenRoom.run({ ...common, createdAt: requestAt, updatedAt: requestAt });
      room = roomById.get(key) || null;
    }
    return {
      ...common,
      status: "open",
      timingKnown: window.timingKnown,
      archived: false,
      retentionPolicyKey: null,
      retentionReviewAt: null,
    };
  }

  return Object.freeze({ snapshot });
}

export const LOUNGE_CLOSE_DELAY_MS = DAY_MS;
