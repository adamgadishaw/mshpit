import { AppError } from "../../lib/diagnostics";
import { createNotificationActivity } from "./notificationActivityState.mjs";
import { fetchNotificationPage, writeNotificationReads } from "./notificationsApi.js";

const demoNotifications = () => [
      { id: "nf1", userId: "u_demo", type: "follow", actorId: "u_mara", actorName: "Mara Quinn", actorInitials: "MQ", ts: Date.now() - 3600000, read: false },
      { id: "nf2", userId: "u_demo", type: "like", actorId: "u_devon", actorName: "Devon Ash", actorInitials: "DA", postId: "log_1", artist: "Turnstile", ts: Date.now() - 7200000, read: false },
      { id: "nf3", userId: "u_demo", type: "comment", actorId: "u_priya", actorName: "Priya N.", actorInitials: "PN", postId: "log_1", artist: "Turnstile", ts: Date.now() - 10800000, read: true },
];

export function createNotificationRuntime(options) {
  return createNotificationActivity({ ...options,
    makeError: (message, code = "PIT-API-001") => new AppError(message, { code, context: "Loading activity", source: "notifications", retryable: true }),
    normalizeError: error => error instanceof AppError ? error : new AppError("Activity could not be loaded. Check your connection and try again.", { code: "PIT-NET-001", cause: error, source: "notifications", retryable: true }),
    seed: options.seed?.length ? options.seed : options.demo ? demoNotifications() : [], fetchPage: fetchNotificationPage, writeReads: writeNotificationReads });
}
