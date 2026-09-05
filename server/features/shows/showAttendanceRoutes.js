import { createShowAttendanceRepository } from "./showAttendanceRepository.js";
import {
  isAttendeeState,
  normalizeAttendanceState,
  normalizeAttendanceVisibility,
  normalizeCrowdScope,
  normalizeShowAliasKey,
  normalizeStableShowId,
  normalizeTourDateId,
} from "./showIdentity.js";

const TEN_MINUTES = 10 * 60 * 1000;

const noStore = (ctx) => ctx.setHeader?.("Cache-Control", "no-store");

function publicShow(show, requestedKey) {
  return {
    id: show.id,
    tourDateId: show.tourDateId || null,
    key: show.canonicalKey,
    requestedKey: normalizeShowAliasKey(requestedKey),
    aliases: show.aliases,
  };
}

export function showAttendanceRoutes({
  database,
  attendanceRepository = null,
  ApiError,
  assertLiveAttendanceAvailable,
  assertSafeAuthoredFields,
  atomicWrite,
  clean,
  cleanDate,
  decodeShowKey,
  finishPage,
  limits,
  now,
  pageRequest,
  projectUser,
  rateLimit,
  requireSessionUser,
  requireUser,
  requireVerifiedUser,
  resolveTourDateShow = null,
  userById,
}) {
  if (!database?.prepare || typeof ApiError !== "function" || typeof assertLiveAttendanceAvailable !== "function"
    || typeof assertSafeAuthoredFields !== "function"
    || typeof atomicWrite !== "function" || typeof clean !== "function" || typeof cleanDate !== "function"
    || typeof decodeShowKey !== "function" || typeof finishPage !== "function" || !limits
    || typeof now !== "function" || typeof pageRequest !== "function" || typeof projectUser !== "function"
    || typeof rateLimit !== "function" || typeof requireSessionUser !== "function"
    || typeof requireUser !== "function"
    || typeof requireVerifiedUser !== "function" || !userById?.get) {
    throw new TypeError("Show attendance routes require complete boundary dependencies");
  }
  const repository = attendanceRepository || createShowAttendanceRepository(database);

  return Object.freeze({
    "GET /api/me/going": (ctx) => {
      const user = requireUser(ctx);
      noStore(ctx);
      const attendance = repository.listForUser(user.id);
      return {
        // Exact legacy projection: current clients treat this as a boolean list.
        going: attendance.filter(({ state, key }) => state === "going" && !!key).map((entry) => ({
          key: entry.key,
          ...(entry.tourDateId ? { tourDateId: entry.tourDateId } : {}),
          artist: entry.artist,
          venue: entry.venue,
          city: entry.city,
          date: entry.date,
        })),
        attendance: attendance.map((entry) => ({
          showId: entry.showId,
          tourDateId: entry.tourDateId,
          key: entry.key,
          canonicalKey: entry.canonicalKey,
          artist: entry.artist,
          artistKey: entry.artistKey,
          venue: entry.venue,
          venueKey: entry.venueKey,
          city: entry.city,
          date: entry.date,
          tour: entry.tour,
          state: entry.state,
          visibility: entry.visibility,
          verified: entry.verified,
          checkedInAt: entry.checkedInAt,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        })),
      };
    },

    "POST /api/going": (ctx) => {
      const user = requireSessionUser(ctx);
      rateLimit(ctx, "going", 120, TEN_MINUTES);
      noStore(ctx);
      const key = normalizeShowAliasKey(clean(ctx.body?.key, { max: 300 }));
      const hasTourDateId = Object.prototype.hasOwnProperty.call(ctx.body || {}, "tourDateId");
      const tourDateId = hasTourDateId ? normalizeTourDateId(ctx.body?.tourDateId) : null;
      if (hasTourDateId && !tourDateId) {
        throw new ApiError(400, "Choose an exact event.", "VALIDATION_FAILED");
      }
      if (!key && !tourDateId) throw new ApiError(400, "Missing key.", "VALIDATION_FAILED");
      if (tourDateId && typeof resolveTourDateShow !== "function") {
        throw new ApiError(503, "Exact event attendance is temporarily unavailable.", "DATABASE_UNAVAILABLE");
      }
      const stableShowId = normalizeStableShowId(key);

      const hasState = Object.prototype.hasOwnProperty.call(ctx.body || {}, "state");
      const hasGoing = Object.prototype.hasOwnProperty.call(ctx.body || {}, "going");
      const hasVisibility = Object.prototype.hasOwnProperty.call(ctx.body || {}, "visibility");
      let requestedState;
      if (hasState) {
        if (ctx.body.state == null) requestedState = null;
        else {
          requestedState = normalizeAttendanceState(ctx.body.state);
          if (!requestedState) {
            throw new ApiError(400, "Choose Interested, Going, Here, or Went.", "VALIDATION_FAILED");
          }
        }
        if (hasGoing) {
          if (typeof ctx.body.going !== "boolean" || ctx.body.going !== isAttendeeState(requestedState)) {
            throw new ApiError(400, "Going and attendance state disagree.", "VALIDATION_FAILED");
          }
        }
      }
      if (hasGoing && typeof ctx.body.going !== "boolean") {
        throw new ApiError(400, "going must be true or false.", "VALIDATION_FAILED");
      }
      const requestedVisibility = hasVisibility
        ? normalizeAttendanceVisibility(ctx.body.visibility)
        : null;
      if (hasVisibility && !requestedVisibility) {
        throw new ApiError(400, "Choose Members, Followers, or Private.", "VALIDATION_FAILED");
      }

      const result = atomicWrite(() => {
        // Current state, authorization, live-transition policy, and the write
        // share one IMMEDIATE transaction. A concurrent removal or transition
        // can never turn an authorized privacy retry into a new attendance or
        // let a stale Here snapshot bypass the live check-in window.
        const operationAt = now();
        const exactDescriptor = tourDateId ? resolveTourDateShow(user, tourDateId, operationAt) : null;
        const existing = exactDescriptor
          ? repository.ownExactAttendance(user.id, exactDescriptor)
          : repository.ownAttendance(user.id, key);
        if (!exactDescriptor && stableShowId && !existing.show) {
          throw new ApiError(404, "That show is not available.", "NOT_FOUND");
        }
        const current = existing.attendance;
        let state;
        if (hasState) {
          state = requestedState;
        } else if (hasGoing) {
          state = ctx.body.going
            ? (isAttendeeState(current?.state) ? current.state : "going")
            : null;
        } else if (hasVisibility) {
          if (!current) throw new ApiError(400, "Choose an attendance state first.", "VALIDATION_FAILED");
          state = current.state;
        } else {
          state = isAttendeeState(current?.state) ? null : "going";
        }

        const removal = state === null;
        const freshLiveTransition = state === "here" && current?.state !== "here";
        const visibility = !removal && hasVisibility
          ? requestedVisibility
          : (freshLiveTransition ? "private" : (current?.visibility || "private"));

        // Privacy self-service remains available when email verification or
        // active-account gates would otherwise trap an existing relationship.
        // Every new state, state transition, or audience widening stays behind
        // the normal active + verified membership boundary.
        const privacyOnly = !removal
          && !!current
          && state === current.state
          && hasVisibility
          && visibility === "private";
        if (!removal && !privacyOnly) requireVerifiedUser(ctx);

        let artist = "";
        let venue = "";
        let city = "";
        let artistKey = null;
        let venueKey = null;
        let tour = null;
        let date = "";
        if (!removal && !privacyOnly) {
          if (exactDescriptor) {
            ({ artist, venue, city, artistKey, venueKey, tour, date } = exactDescriptor);
          } else {
            artist = clean(ctx.body?.artist, { max: limits.artist }) || "";
            venue = clean(ctx.body?.venue, { max: limits.venue }) || "";
            city = clean(ctx.body?.city, { max: limits.city }) || "";
            artistKey = clean(ctx.body?.artistKey, { max: 180 }) || null;
            venueKey = clean(ctx.body?.venueKey, { max: 200 }) || null;
            tour = clean(ctx.body?.tour, { max: 120 }) || null;
            assertSafeAuthoredFields({ artist, venue, city, tour: tour || "" });
            date = cleanDate(ctx.body?.date) || "";
          }
        }

        if (!removal) {
          // Exact catalog data wins when present. Legacy-key rows keep their
          // historical identity in the member snapshot; a new legacy-key write
          // has only validated request fields. Include the alias so the policy
          // can verify its artist segment independently of duplicated client
          // metadata.
          const policyIdentity = exactDescriptor || existing.show || {};
          const storedIdentity = current?.snapshot || {};
          assertLiveAttendanceAvailable({
            artistKey: policyIdentity.artistKey || storedIdentity.artistKey || artistKey,
            artist: policyIdentity.artist || storedIdentity.artist || artist,
            key,
          });
        }

        const writeAt = now();
        const exactShow = freshLiveTransition && exactDescriptor
          ? repository.ensureExactShow(exactDescriptor, writeAt) : null;
        if (freshLiveTransition && !repository.checkInAvailable(exactShow?.id || key, writeAt)) {
          throw new ApiError(
            409,
            "Live check-in is not available for this show yet. You can still mark Going or Went.",
            "CHECK_IN_UNAVAILABLE",
          );
        }
        const values = {
          userId: user.id,
          key,
          state,
          visibility,
          artist,
          artistKey,
          venue,
          venueKey,
          city,
          date,
          tour,
          at: writeAt,
        };
        return exactDescriptor
          ? repository.writeExactAttendance({ ...values, descriptor: exactDescriptor })
          : repository.writeAttendance(values);
      });
      if (!result?.show) throw new ApiError(404, "That show is not available.", "NOT_FOUND");
      const attendance = result.attendance ? {
        showId: result.show.id,
        tourDateId: result.show.tourDateId || null,
        state: result.attendance.state,
        visibility: result.attendance.visibility,
        verified: result.attendance.verified,
        checkedInAt: result.attendance.checkedInAt,
        createdAt: result.attendance.createdAt,
        updatedAt: result.attendance.updatedAt,
      } : null;
      return {
        showId: result.show.id,
        going: isAttendeeState(attendance?.state),
        state: attendance?.state || null,
        visibility: attendance?.visibility || null,
        attendance,
        show: publicShow(result.show, key),
      };
    },

    "GET /api/going/:key/attendees": (ctx) => {
      const key = normalizeShowAliasKey(decodeShowKey(ctx));
      if (!key) throw new ApiError(400, "That show link is invalid.", "VALIDATION_FAILED");
      const scope = normalizeCrowdScope(ctx.query?.scope);
      if (!scope) throw new ApiError(400, "Choose Everyone, Following, or Friends.", "VALIDATION_FAILED");
      const { cursor, limit } = pageRequest(ctx, 50, 100);
      const viewerId = ctx.user ? requireVerifiedUser(ctx).id : null;
      noStore(ctx);
      const resolvedShow = repository.resolveShow(key);
      assertLiveAttendanceAvailable({
        artistKey: resolvedShow?.artistKey || null,
        artist: resolvedShow?.artist || null,
        key,
      });
      const snapshot = repository.crowdSnapshot({
        key,
        viewerId,
        scope,
        activeAt: now(),
        cursor,
        limit,
      });
      const page = viewerId ? finishPage(snapshot.rows, limit) : { rows: [], nextCursor: null };
      const attendees = page.rows.map((row) => {
        const person = projectUser(userById.get(row.id));
        if (!person) return null;
        return {
          id: person.id,
          name: person.name,
          handle: person.handle,
          initials: person.initials,
          avatarUri: person.avatarUri,
          avatarColor: person.avatarColor,
          role: person.role,
          verified: person.verified,
          state: row.state,
          verifiedAttendance: !!row.attendance_verified,
        };
      }).filter(Boolean);
      const viewerAttendance = snapshot.viewerAttendance ? {
        showId: snapshot.show.id,
        state: snapshot.viewerAttendance.state,
        visibility: snapshot.viewerAttendance.visibility,
        verified: snapshot.viewerAttendance.verified,
        checkedInAt: snapshot.viewerAttendance.checkedInAt,
        createdAt: snapshot.viewerAttendance.createdAt,
        updatedAt: snapshot.viewerAttendance.updatedAt,
      } : null;
      const stateCounts = viewerId ? snapshot.stateCounts : {
        ...snapshot.stateCounts,
        going: snapshot.stateCounts.going + snapshot.stateCounts.here,
        here: 0,
      };
      return {
        showId: snapshot.show.id,
        attendees,
        total: snapshot.total,
        nextCursor: page.nextCursor,
        viewerGoing: isAttendeeState(viewerAttendance?.state),
        viewerAttendance,
        stateCounts,
        verifiedAttendeeCount: snapshot.verifiedAttendeeCount,
        liveStateRedacted: !viewerId,
        scope,
        show: publicShow(snapshot.show, key),
      };
    },
  });
}
