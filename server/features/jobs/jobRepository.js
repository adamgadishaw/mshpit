export function ensureJobSchema(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS staff_jobs (
    id TEXT PRIMARY KEY,
    draft_json TEXT NOT NULL,
    published_json TEXT,
    state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','closed','archived')),
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL,
    updated_by TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS idx_staff_jobs_state_id ON staff_jobs(state,id);`);
}
const decode = row => row ? {
  id: row.id, draft: JSON.parse(row.draft_json), published: row.published_json ? JSON.parse(row.published_json) : null,
  state: row.state, revision: row.revision, updatedAt: row.updated_at,
} : null;
export function createJobRepository(database) {
  const read = database.prepare("SELECT * FROM staff_jobs WHERE id = ?");
  const list = database.prepare("SELECT * FROM staff_jobs WHERE id > ? ORDER BY id LIMIT 101");
  const publicList = database.prepare("SELECT id,published_json FROM staff_jobs WHERE state='published' AND id > ? ORDER BY id LIMIT 101");
  const publicRead = database.prepare("SELECT id,published_json FROM staff_jobs WHERE state='published' AND id = ?");
  const project = row => row ? { id: row.id, ...JSON.parse(row.published_json) } : null;
  const page = (rows, map) => ({ jobs: rows.slice(0,100).map(map), cursor: rows.length > 100 ? rows[99].id : null });
  return {
    read: id => decode(read.get(id)),
    list: cursor => page(list.all(cursor || ""), decode),
    publicList: cursor => page(publicList.all(cursor || ""), project),
    publicRead: id => project(publicRead.get(id)),
    insert: ({ id, draft, at, accountId }) => database.prepare("INSERT INTO staff_jobs(id,draft_json,updated_at,updated_by) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING").run(id, JSON.stringify(draft), at, accountId),
    update: ({ id, draft, published, state, revision, at, accountId }) => database.prepare("UPDATE staff_jobs SET draft_json=?,published_json=?,state=?,revision=revision+1,updated_at=?,updated_by=? WHERE id=? AND revision=?").run(JSON.stringify(draft), published ? JSON.stringify(published) : null, state, at, accountId, id, revision),
  };
}
