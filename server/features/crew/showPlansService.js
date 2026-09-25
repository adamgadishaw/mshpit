import {
  OPEN_PLANS_PER_SHOW,
  PLAN_KINDS,
  PLAN_MESSAGE_MAX,
  PLAN_SPOTS_MAX,
  PLAN_SPOTS_MIN,
  PLAN_TEXT_MAX,
  PLAN_TEXT_MIN,
  PLANS_PER_HOST_PER_SHOW,
  planKindLabel,
} from "../../../src/domain/showPlans.mjs";
import { CrewError } from "./crewService.js";

// Plans live inside a show's Lounge. Anyone going can read the Lounge, but
// plans are only for adults: a host posts "carpool from Hamilton, 2 seats",
// others tap "I'm in", and the people in a plan get a small shared chat.
// There are no person cards and no one-on-one matching.
//
// The rules here: adults only; a plan's members and chat are visible only to
// its members; blocks keep people out of each other's plans; a host can
// remove anyone and close the plan; staff can close any plan. Callers check
// that the Lounge is open and that the member is going.

export function ensureShowPlansSchema(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS show_plans (
    id TEXT PRIMARY KEY,
    lounge_key TEXT NOT NULL,
    show_artist TEXT NOT NULL DEFAULT '',
    show_venue TEXT NOT NULL DEFAULT '',
    show_date TEXT NOT NULL DEFAULT '',
    host_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    text TEXT NOT NULL CHECK(length(text) <= 400),
    spots INTEGER NOT NULL CHECK(spots BETWEEN 1 AND 8),
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    closed_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_show_plans_lounge ON show_plans(lounge_key, status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_show_plans_host ON show_plans(host_id, status);
  CREATE TABLE IF NOT EXISTS show_plan_members (
    plan_id TEXT NOT NULL REFERENCES show_plans(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (plan_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_show_plan_members_user ON show_plan_members(user_id, joined_at DESC);
  CREATE TABLE IF NOT EXISTS show_plan_messages (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL REFERENCES show_plans(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL CHECK(length(text) <= 1000),
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_show_plan_messages_plan ON show_plan_messages(plan_id, created_at, id);`);
}

const clean = (value, max) => (typeof value === "string"
  ? value.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/gu, " ").replace(/[ \t]+/gu, " ").replace(/\n{3,}/gu, "\n\n").trim().slice(0, max)
  : "");

export function assertPlanAdult(user) {
  if (user?.age_band === "18_plus") return;
  if (!user?.age_band || user.age_band === "unknown") {
    throw new CrewError(403, "Choose your age group in Settings to see plans. Plans are for members 18 and over.", "PLAN_AGE_REQUIRED");
  }
  throw new CrewError(403, "Plans are for members 18 and over.", "PLAN_ADULTS_ONLY");
}

const NOT_OPEN = "This plan is no longer open.";
const planRow = (database, planId) => (typeof planId === "string" && planId.length <= 80
  ? database.prepare("SELECT * FROM show_plans WHERE id=?").get(planId) : null);
const memberIds = (database, planId) => database.prepare("SELECT user_id FROM show_plan_members WHERE plan_id=? ORDER BY joined_at ASC")
  .all(planId).map((row) => row.user_id);
const isInPlan = (database, plan, userId) => plan.host_id === userId
  || !!database.prepare("SELECT 1 FROM show_plan_members WHERE plan_id=? AND user_id=?").get(plan.id, userId);

function projectPlan(database, plan, { user, projectUser, blockedEitherWay }) {
  const members = memberIds(database, plan.id);
  const inside = plan.host_id === user.id || members.includes(user.id);
  return {
    id: plan.id,
    kind: plan.kind,
    kindLabel: planKindLabel(plan.kind),
    text: plan.text,
    spots: plan.spots,
    joinedCount: members.length,
    full: members.length >= plan.spots,
    isHost: plan.host_id === user.id,
    joined: members.includes(user.id),
    host: projectUser(plan.host_id),
    // Who else is in a plan is for the people in it, not the whole Lounge.
    members: inside
      ? members.filter((id) => id !== user.id && !blockedEitherWay(user.id, id)).map(projectUser).filter(Boolean)
      : [],
    show: { artist: plan.show_artist, venue: plan.show_venue, date: plan.show_date, loungeKey: plan.lounge_key },
    createdAt: plan.created_at,
  };
}

// Open plans in one Lounge, newest first, leaving out hosts you have blocked
// or who blocked you.
export function listLoungePlans(database, { user, loungeKey, projectUser, blockedEitherWay }) {
  assertPlanAdult(user);
  return database.prepare("SELECT * FROM show_plans WHERE lounge_key=? AND status='open' ORDER BY created_at DESC, id DESC LIMIT 100")
    .all(loungeKey)
    .filter((plan) => !blockedEitherWay(user.id, plan.host_id))
    .map((plan) => projectPlan(database, plan, { user, projectUser, blockedEitherWay }))
    .filter((plan) => plan.host);
}

export function createLoungePlan(database, { user, loungeKey, show = {}, kind, text, spots, id, at = Date.now(), projectUser, blockedEitherWay }) {
  assertPlanAdult(user);
  if (!Object.hasOwn(PLAN_KINDS, kind)) throw new CrewError(400, "Choose what the plan is for.", "VALIDATION_FAILED");
  const body = clean(text, PLAN_TEXT_MAX);
  if (body.length < PLAN_TEXT_MIN) throw new CrewError(400, "Say a little about the plan.", "VALIDATION_FAILED");
  const seats = Number(spots);
  if (!Number.isInteger(seats) || seats < PLAN_SPOTS_MIN || seats > PLAN_SPOTS_MAX) {
    throw new CrewError(400, `Choose between ${PLAN_SPOTS_MIN} and ${PLAN_SPOTS_MAX} spots.`, "VALIDATION_FAILED");
  }
  const mine = database.prepare("SELECT COUNT(*) c FROM show_plans WHERE lounge_key=? AND host_id=? AND status='open'").get(loungeKey, user.id).c;
  if (mine >= PLANS_PER_HOST_PER_SHOW) {
    throw new CrewError(409, `You can host ${PLANS_PER_HOST_PER_SHOW} plans per show. Close one to start another.`, "CONFLICT");
  }
  const open = database.prepare("SELECT COUNT(*) c FROM show_plans WHERE lounge_key=? AND status='open'").get(loungeKey).c;
  if (open >= OPEN_PLANS_PER_SHOW) throw new CrewError(409, "This show has plenty of plans. Join one of them instead.", "CONFLICT");
  database.prepare(`INSERT INTO show_plans(id,lounge_key,show_artist,show_venue,show_date,host_id,kind,text,spots,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,'open',?,?)`).run(id, loungeKey, clean(show.artist, 160), clean(show.venue, 180),
    /^\d{4}-\d{2}-\d{2}$/u.test(String(show.date || "")) ? show.date : "", user.id, kind, body, seats, at, at);
  return projectPlan(database, planRow(database, id), { user, projectUser, blockedEitherWay });
}

// "I'm in". Every reason a plan cannot be joined gets the same answer, so a
// join attempt cannot be used to learn who blocked whom.
export function joinLoungePlan(database, { user, planId, blockedEitherWay, at = Date.now() }) {
  assertPlanAdult(user);
  const plan = planRow(database, planId);
  if (!plan || plan.status !== "open") throw new CrewError(404, NOT_OPEN, "NOT_FOUND");
  if (isInPlan(database, plan, user.id)) return { plan, created: false };
  const members = memberIds(database, plan.id);
  const blocked = [plan.host_id, ...members].some((id) => blockedEitherWay(user.id, id));
  const hostAdult = database.prepare("SELECT age_band FROM users WHERE id=?").get(plan.host_id)?.age_band === "18_plus";
  if (blocked || !hostAdult) throw new CrewError(404, NOT_OPEN, "NOT_FOUND");
  if (members.length >= plan.spots) throw new CrewError(409, "This plan is full.", "CONFLICT");
  database.prepare("INSERT OR IGNORE INTO show_plan_members(plan_id,user_id,joined_at) VALUES (?,?,?)").run(plan.id, user.id, at);
  return { plan, created: true };
}

export function leaveLoungePlan(database, { user, planId }) {
  const plan = planRow(database, planId);
  if (!plan) throw new CrewError(404, NOT_OPEN, "NOT_FOUND");
  if (plan.host_id === user.id) throw new CrewError(409, "Hosts close their plan instead of leaving it.", "CONFLICT");
  database.prepare("DELETE FROM show_plan_members WHERE plan_id=? AND user_id=?").run(plan.id, user.id);
  return { left: true };
}

export function closeLoungePlan(database, { user, planId, staff = false, at = Date.now() }) {
  const plan = planRow(database, planId);
  if (!plan || (plan.host_id !== user.id && !staff)) throw new CrewError(404, NOT_OPEN, "NOT_FOUND");
  database.prepare("UPDATE show_plans SET status='closed',closed_at=COALESCE(closed_at,?),updated_at=? WHERE id=?").run(at, at, plan.id);
  return { closed: true };
}

export function removePlanMember(database, { user, planId, memberId }) {
  const plan = planRow(database, planId);
  if (!plan || plan.host_id !== user.id) throw new CrewError(404, NOT_OPEN, "NOT_FOUND");
  database.prepare("DELETE FROM show_plan_members WHERE plan_id=? AND user_id=?").run(plan.id, String(memberId || ""));
  return { removed: true };
}

// The plan chat: only the host and members, and never someone you blocked.
export function readPlanForMember(database, { user, planId }) {
  assertPlanAdult(user);
  const plan = planRow(database, planId);
  if (!plan || !isInPlan(database, plan, user.id)) throw new CrewError(404, NOT_OPEN, "NOT_FOUND");
  return plan;
}

export function listPlanMessages(database, { user, planId, after = 0, blockedEitherWay, projectUser }) {
  const plan = readPlanForMember(database, { user, planId });
  const since = Number.isFinite(Number(after)) ? Number(after) : 0;
  const rows = database.prepare(`SELECT id,user_id,text,created_at FROM show_plan_messages WHERE plan_id=? AND created_at>?
    ORDER BY created_at ASC, id ASC LIMIT 300`).all(plan.id, since);
  const cards = new Map();
  const card = (id) => {
    if (!cards.has(id)) cards.set(id, projectUser(id));
    return cards.get(id);
  };
  return {
    messages: rows.filter((row) => !blockedEitherWay(user.id, row.user_id)).map((row) => {
      const author = card(row.user_id);
      return author ? { id: row.id, userId: row.user_id, name: author.name, initials: author.initials,
        avatarUri: author.avatarUri, avatarColor: author.avatarColor, text: row.text, createdAt: row.created_at } : null;
    }).filter(Boolean),
    closed: plan.status !== "open",
  };
}

export function postPlanMessage(database, { user, planId, text, id, at = Date.now() }) {
  const plan = readPlanForMember(database, { user, planId });
  if (plan.status !== "open") throw new CrewError(409, "This plan is closed.", "CONFLICT");
  const body = clean(text, PLAN_MESSAGE_MAX);
  if (!body) throw new CrewError(400, "Say something first.", "VALIDATION_FAILED");
  database.prepare("INSERT INTO show_plan_messages(id,plan_id,user_id,text,created_at) VALUES (?,?,?,?,?)").run(id, plan.id, user.id, body, at);
  return { id, createdAt: at };
}

// Plans you host or joined that are still open, soonest show first.
export function listMyPlans(database, { user, projectUser, blockedEitherWay }) {
  if (user?.age_band !== "18_plus") return [];
  return database.prepare(`SELECT DISTINCT p.* FROM show_plans p LEFT JOIN show_plan_members m ON m.plan_id=p.id AND m.user_id=?
      WHERE p.status='open' AND (p.host_id=? OR m.user_id IS NOT NULL)
      ORDER BY p.show_date ASC, p.created_at DESC LIMIT 50`).all(user.id, user.id)
    .filter((plan) => !blockedEitherWay(user.id, plan.host_id))
    .map((plan) => projectPlan(database, plan, { user, projectUser, blockedEitherWay }))
    .filter((plan) => plan.host);
}

export function planLoungeKey(database, planId) {
  return planRow(database, planId)?.lounge_key || null;
}
