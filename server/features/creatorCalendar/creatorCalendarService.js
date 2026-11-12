import { createHash } from "node:crypto";
import { ApiError } from "../../errors.js";
import { withImmediateWrite } from "../../databaseTransaction.js";
import { writeTourDateBatch } from "./tourDateWriter.js";
import { creatorUpdateError } from "../../../src/domain/creatorUpdate.mjs";

const fail = (message, status = 400) => {
  if (status === 409) throw new ApiError(409, message, "CONFLICT");
  if (status === 403) throw new ApiError(403, message, "FORBIDDEN");
  throw new ApiError(400, message, "VALIDATION_FAILED");
};
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const hash = value => createHash("sha256").update(JSON.stringify(ordered(value))).digest("hex");
const fields = ["clientMutationId", "kind", "review", "creatorUpdate", "photos", "mediaAssetIds", "photosPublic", "song", "playlistId"];
export const CALENDAR_EVIDENCE = "mshpit:creator-calendar";

// This service is reached only through the shared post composer. Callbacks
// retain the existing artist validation, post receipts, media and inbox rules.
export function createCreatorCalendarService({ database: db, requireUser, authorize, authorizeWithdrawal = authorize, validatePost, validateBatch,
  createPost, readPost, holdMedia, releaseMedia, submissionLimit, uid, now = Date.now }) {
  const eventById = id => db.prepare("SELECT * FROM tour_dates WHERE id=?").get(id);
  const receipt = (accountId, mutationId) => db.prepare("SELECT * FROM creator_calendar_publications WHERE account_id=? AND mutation_id=?").get(accountId, mutationId);
  const projectEvent = row => ({ id: row.id, revision: row.creator_revision, venue: row.venue, place: row.place,
    date: row.date, ticketUrl: row.ticket_url || "", releaseAt: row.publication_state === "scheduled" || row.publication_state === "blocked" ? row.publication_release_at : row.release_at, status: row.event_status || "scheduled", publicationState: row.publication_state || null });
  const response = (ctx, row) => row.post_id && row.state === "published"
    ? { ...readPost(ctx, row.post_id), calendarReceipt: { id: row.id, eventId: row.event_id, revision: row.revision, state: row.state, mutationId: row.mutation_id } }
    : { calendarReceipt: { id: row.id, eventId: row.event_id, revision: row.revision, state: row.state,
      releaseAt: row.release_at, mutationId: row.mutation_id, creatorUpdate: JSON.parse(row.payload).creatorUpdate } };
  const publish = (ctx, row) => {
    db.prepare("UPDATE tour_dates SET release_at=? WHERE id=? AND creator_revision=?").run(row.release_at,row.event_id,row.revision);
    const result = createPost(ctx, JSON.parse(row.payload));
    db.prepare("UPDATE creator_calendar_publications SET state='published',post_id=? WHERE id=? AND state='scheduled'").run(result.id, row.id);
    return result;
  };
  const currentArtist = (ctx, withdrawal = false) => {
    const account = requireUser(ctx);
    const current = db.prepare("SELECT * FROM users WHERE id=?").get(account.id);
    if (!current || current.role !== "artist") fail("Only the artist account can publish its own calendar dates.", 403);
    (withdrawal ? authorizeWithdrawal : authorize)(current);
    return current;
  };
  return {
    submit(ctx) {
      const cancellationRequested = ctx.body?.creatorUpdate?.calendar?.action === "cancel";
      currentArtist(ctx, cancellationRequested);
      const payload = Object.fromEntries(fields.filter(key => Object.hasOwn(ctx.body || {}, key)).map(key => [key, ctx.body[key]]));
      if (JSON.stringify(payload).length > 100000) fail("This show update is too large.");
      const mutationId = payload.clientMutationId;
      if (typeof mutationId !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/u.test(mutationId)) fail("Retry this update with its saved submission ID.");
      const payloadHash = hash(payload);
      return withImmediateWrite(db, () => {
        ctx.assertCurrentSession?.(); const user = currentArtist(ctx, cancellationRequested);
        const previous = receipt(user.id, mutationId);
        if (previous) {
          if (previous.payload_hash !== payloadHash) fail("This submission already has different details. Reopen the saved update before retrying.", 409);
          if (cancellationRequested && previous.state !== "cancelled") authorize(user);
          return response(ctx, previous);
        }
        submissionLimit?.(ctx);
        const update = payload.creatorUpdate, calendar = update?.calendar;
        if (payload.kind !== "status" || update?.entityType !== "artist" || update.kind !== "show"
          || !calendar || !["create", "edit", "cancel"].includes(calendar.action)) fail("Choose a valid artist calendar action.");
        const prior = calendar.action === "create" ? null : eventById(calendar.eventId);
        if (calendar.action !== "create" && (!prior || prior.owner_id !== user.id || prior.source !== "artist-submitted"
          || String(user.artist_name || "").trim().toLowerCase() !== update.entityKey
          || (prior.artist_key || prior.artist.trim().toLowerCase()) !== update.entityKey)) fail("This account cannot change that calendar record.", 403);
        if (prior && (!Number.isSafeInteger(calendar.expectedRevision) || prior.creator_revision !== calendar.expectedRevision)) fail("This show changed. Refresh it before saving.", 409);
        if (prior && ["cancelled", "canceled"].includes(prior.event_status) && calendar.action !== "cancel") fail("This show was cancelled. Publish a new show to announce a replacement.", 409);
        if (prior && prior.event_status === "cancelled" && calendar.action === "cancel") fail("This show is already cancelled. Refresh its saved status.", 409);
        const releaseAt = Number(calendar.releaseAt || 0);
        if (prior && prior.release_at <= now() && releaseAt > now()) fail("An already published show cannot be made private by scheduling its edit.");
        const cancellation = calendar.action === "cancel";
        if (cancellation && (update.date !== prior.date || calendar.venue !== prior.venue || calendar.place !== prior.place)) fail("Refresh the show before cancelling it.", 409);
        // Withdrawal is cleanup, not a new publication. Prove this identity is
        // still private and has never published before bypassing eligibility.
        // Current owner/session and revision checks above remain mandatory.
        const privateWithdrawal = cancellation && prior.release_at === Number.MAX_SAFE_INTEGER
          && !!db.prepare("SELECT 1 FROM creator_calendar_publications WHERE event_id=? AND account_id=? AND revision=? AND state IN ('scheduled','blocked') AND post_id IS NULL")
            .get(prior.id, user.id, prior.creator_revision)
          && !db.prepare("SELECT 1 FROM creator_calendar_publications WHERE event_id=? AND (state='published' OR post_id IS NOT NULL)").get(prior.id);
        if (privateWithdrawal) {
          const error = creatorUpdateError(update); if (error) fail(error);
          if (update.url !== (prior.ticket_url || "")) fail("Refresh the show before cancelling it.", 409);
        } else {
          authorize(user);
          validatePost(user, payload);
        }
        const batch = privateWithdrawal
          ? { artist: prior.artist, releaseAt: 0, dates: [{ venue: prior.venue, place: prior.place, date: prior.date, ticketUrl: prior.ticket_url || "" }] }
          : validateBatch({ ...ctx, body: { artist: user.artist_name, releaseAt: cancellation ? 0 : releaseAt,
            dates: [{ venue: calendar.venue, place: calendar.place, date: update.date, ticketUrl: update.url }] } }, user);
        const entry = batch.dates[0];
        const collision = db.prepare(`SELECT id FROM tour_dates WHERE owner_id=? AND lower(artist)=lower(?)
          AND lower(venue)=lower(?) AND lower(place)=lower(?) AND date=? AND id<>? LIMIT 1`)
          .get(user.id, batch.artist, entry.venue, entry.place, entry.date, prior?.id || "");
        if (collision && !privateWithdrawal) fail("That show is already on your calendar. Choose Change a show to update it.", 409);
        let event;
        if (!prior) {
          event = writeTourDateBatch(db, { batch, user, uid, at: now() })[0];
          db.prepare("UPDATE tour_dates SET creator_revision=1,music_evidence=? WHERE id=?").run(CALENDAR_EVIDENCE, event.id);
        } else {
          db.prepare(`UPDATE tour_dates SET venue=?,place=?,date=?,ticket_url=?,release_at=?,event_status=?,
            creator_revision=creator_revision+1,updated_at=?,music_evidence=? WHERE id=? AND owner_id=? AND creator_revision=?`)
            .run(entry.venue, entry.place, entry.date, entry.ticketUrl, cancellation ? prior.release_at : batch.releaseAt,
              cancellation ? "cancelled" : prior.event_status, now(), CALENDAR_EVIDENCE, prior.id, user.id, prior.creator_revision);
          event = prior;
          // Revisions supersede pending announcements, never existing public
          // posts. Old request receipts remain tombstones for safe retries.
          const superseded = db.prepare("SELECT payload FROM creator_calendar_publications WHERE event_id=? AND state IN ('scheduled','blocked')").all(event.id);
          db.prepare("UPDATE creator_calendar_publications SET state='cancelled' WHERE event_id=? AND state IN ('scheduled','blocked')").run(event.id);
          for (const old of superseded) releaseMedia?.(user.id, JSON.parse(old.payload));
        }
        event = eventById(event.id);
        const neverPublishedCancellation = cancellation && prior.release_at > now();
        const id = uid("cpub");
        db.prepare(`INSERT INTO creator_calendar_publications(id,account_id,mutation_id,payload_hash,event_id,revision,release_at,state,payload,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, user.id, mutationId, payloadHash, event.id, event.creator_revision,
            cancellation ? 0 : batch.releaseAt, neverPublishedCancellation ? "cancelled" : "scheduled", JSON.stringify(payload), now());
        const row = receipt(user.id, mutationId);
        if (neverPublishedCancellation || row.release_at > now()) db.prepare("UPDATE tour_dates SET release_at=? WHERE id=?").run(Number.MAX_SAFE_INTEGER,event.id);
        if (!neverPublishedCancellation && row.release_at <= now()) publish(ctx, row);
        else if (!neverPublishedCancellation) holdMedia(user, payload);
        return response(ctx, receipt(user.id, mutationId));
      });
    },
    list(ctx) {
      const user = currentArtist(ctx, true); ctx.setHeader?.("Cache-Control", "private, no-store");
      const after = typeof ctx.query?.after === "string" ? ctx.query.after : "";
      if (after.length > 180) fail("Choose a valid calendar page.");
      const rows = db.prepare(`SELECT tour_dates.*,(SELECT state FROM creator_calendar_publications cp WHERE cp.event_id=tour_dates.id ORDER BY cp.revision DESC,cp.created_at DESC LIMIT 1) AS publication_state,(SELECT release_at FROM creator_calendar_publications cp WHERE cp.event_id=tour_dates.id ORDER BY cp.revision DESC,cp.created_at DESC LIMIT 1) AS publication_release_at FROM tour_dates WHERE owner_id=? AND source='artist-submitted'
        AND lower(trim(artist))=lower(trim(?)) AND id>? ORDER BY id LIMIT 31`).all(user.id, user.artist_name, after);
      return { events: rows.slice(0,30).map(projectEvent), nextCursor: rows.length > 30 ? rows[29].id : null };
    },
    runDue({ at = now(), limit = 30 } = {}) {
      const rows = db.prepare("SELECT id FROM creator_calendar_publications WHERE state='scheduled' AND release_at<=? ORDER BY release_at,id LIMIT ?").all(at, Math.max(1, Math.min(100, limit)));
      let published = 0, blocked = 0;
      for (const candidate of rows) {
        withImmediateWrite(db, () => {
          const row = db.prepare("SELECT * FROM creator_calendar_publications WHERE id=? AND state='scheduled'").get(candidate.id);
          if (!row) return;
          const event = eventById(row.event_id), user = db.prepare("SELECT * FROM users WHERE id=?").get(row.account_id);
          const ctx = { user, ip: "creator-calendar-worker" };
          try {
            currentArtist(ctx);
            if (!event || event.creator_revision !== row.revision || event.owner_id !== user.id || event.event_status === "cancelled") fail("The scheduled show changed.", 409);
            validatePost(user, JSON.parse(row.payload));
            // Scheduling is not continuing permission to publish. Recheck the
            // current calendar facts and eligibility (including memorials)
            // after the writer lock, before releasing the row or announcing it.
            // This is a release now, not a request to schedule again in the past.
            validateBatch({ ...ctx, body: { artist: user.artist_name, releaseAt: 0,
              dates: [{ venue: event.venue, place: event.place, date: event.date, ticketUrl: event.ticket_url || "" }] } }, user);
          } catch (error) {
            if (![400,401,403,404,409].includes(error.status)) throw error;
            db.prepare("UPDATE creator_calendar_publications SET state='blocked' WHERE id=?").run(row.id);
            // Keep the private authored payload and media on hold. Only an
            // explicit authorized revision/cancellation supersedes this receipt.
            blocked++;
            return;
          }
          publish(ctx, row); published++;
        });
      }
      return { published, blocked };
    },
  };
}
