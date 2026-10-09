// Isolated read-path profile: fresh synthetic SQLite, no inherited credentials.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

if (!process.env.PIT_DISCOVER_PROFILE) {
  const dir = mkdtempSync(join(tmpdir(), 'pit-discover-profile-'));
  const env = Object.fromEntries(['PATH','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','LOCALAPPDATA']
    .filter(key => process.env[key]).map(key => [key, process.env[key]]));
  Object.assign(env, { NODE_ENV:'test', RENDER:'true', PIT_DATA_DIR:dir,
    PIT_ALLOW_EMPTY_DB_BOOTSTRAP:'true', PIT_DISCOVER_PROFILE:'1' });
  try {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)],
      { env, stdio:'inherit', windowsHide:true });
    process.exitCode = result.status ?? 1;
  } finally { rmSync(dir, { recursive:true, force:true }); }
} else {
  globalThis.fetch = async () => { throw new Error('Profile outbound network disabled'); };
  const root = resolve(process.argv[2] || fileURLToPath(new URL('../', import.meta.url)));
  const { pathToFileURL } = await import('node:url');
  const moduleUrl = path => pathToFileURL(join(root, path)).href;
  const at = Date.parse('2026-10-09T12:00:00Z');
  Date.now = () => at;
  const { db, artistStmts, artistRow } = await import(moduleUrl('server/db.js'));
  const artistCount = Number(process.argv[4] || 2000), eventCount = Number(process.argv[5] || 5000);
  db.exec('BEGIN');
  for (let i=0;i<artistCount;i++) artistStmts.upsert.run(artistRow(`profile artist ${i}`, {
    name:`Profile Artist ${i}`, rank_score:i, bio:i%7===0?'Public artist biography '.repeat(5):'' }));
  const insert = db.prepare(`INSERT INTO tour_dates(id,artist,artist_key,venue,place,date,source,updated_at,
    venue_city,venue_country_code,event_timezone,event_kind,event_end_date,music_evidence,event_status)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (let i=0;i<eventCount;i++) insert.run(`profile_${i}`,`Profile Artist ${i%artistCount}`,`profile artist ${i%artistCount}`,
    `Profile Hall ${i%120}`,'Toronto, ON, CA',i%25===0?'2026-10-08':`2026-10-${String(10+i%20).padStart(2,'0')}`,
    'ticketmaster',at,'Toronto','CA',i%2?'America/Toronto':'Europe/London',i%25===0?'festival':'concert',
    i%25===0?'2026-10-10':null,'ticketmaster:classification:music',i%43?'scheduled':'cancelled');
  db.exec('COMMIT');
  const queries=[];
  const database = new Proxy(db, { get(target,key) {
    if(key!=='prepare') return typeof target[key]==='function'?target[key].bind(target):target[key];
    return sql => {
      const statement=target.prepare(sql);
      return new Proxy(statement,{get(stmt,method) {
        if(!['all','get'].includes(method)) return typeof stmt[method]==='function'?stmt[method].bind(stmt):stmt[method];
        return (...args)=> { const start=performance.now(); const result=stmt[method](...args);
          queries.push({sql,args,ms:performance.now()-start,rows:Array.isArray(result)?result.length:1});return result; };
      }});
    };
  }});
  const { createPublicDocumentRepository } = await import(moduleUrl('server/features/seo/publicDocumentRepository.js'));
  const { createPublicDocumentService } = await import(moduleUrl('server/features/seo/publicDocuments.js'));
  const repo = createPublicDocumentRepository(database);
  const service = createPublicDocumentService({database,origin:'https://example.test'});
  const cpu=process.cpuUsage(), start=performance.now();
  const raw=repo.readDiscover({at});
  const readMs=performance.now()-start;
  const timings=queries.splice(0);
  const projectionStart=performance.now();
  const doc=service.discoverDocument({at});
  const documentMs=performance.now()-projectionStart;
  const renderStart=performance.now(), html=service.render(doc), renderMs=performance.now()-renderStart;
  const used=process.cpuUsage(cpu);
  const report={root,inventory:{artists:artistStmts.count.get().c,events:eventCount},readMs,documentMs,renderMs,
    cpuMs:(used.user+used.system)/1000,outputHash:createHash('sha256').update(JSON.stringify(doc)).digest('hex'),
    htmlHash:createHash('sha256').update(html).digest('hex'),counts:{artists:raw.artists.length,events:raw.events.length,posts:raw.posts.length},
    queries:timings.map(q=>({...q,plan:db.prepare('EXPLAIN QUERY PLAN '+q.sql).all(...q.args)}))};
  if(process.argv[3]) writeFileSync(resolve(process.argv[3]),JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,queries:report.queries.map(q=>({ms:q.ms,rows:q.rows,sql:q.sql.slice(0,160),plan:q.plan}))},null,2));
  db.close();
}
