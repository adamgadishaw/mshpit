import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-seo-indexes-"));
process.env.PIT_DATA_DIR = dataDir;

const { db } = await import("../../db.js");
const { activeAccountSql } = await import("../../accountVisibility.js");
const { PUBLIC_POST_COLUMNS } = await import("./publicDocumentRepository.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const plan = (sql, ...params) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params)
  .map((row) => String(row.detail));

test("canonical artist and reverse-follower reads use dedicated indexes", () => {
  const slugPlan = plan(`SELECT * FROM artists
    WHERE public_slug IS NOT NULL AND public_slug<>'' AND lower(public_slug)=lower(?)`, "drake");
  assert.ok(slugPlan.some((detail) => detail.includes("idx_artists_public_slug")), slugPlan.join(" | "));

  const followerPlan = plan("SELECT follower_id FROM follows WHERE followee_id=?", "u_target");
  assert.ok(followerPlan.some((detail) => detail.includes("idx_follows_followee_follower")), followerPlan.join(" | "));
});

test("public post artist links avoid a per-card catalog scan", () => {
  const postPlan = plan(`SELECT ${PUBLIC_POST_COLUMNS}
    FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=?`, "post-id");
  assert.ok(postPlan.some((detail) => /SEARCH canonical .*sqlite_autoindex_artists_1/i.test(detail)), postPlan.join(" | "));
  assert.ok(postPlan.some((detail) => detail.includes("idx_artists_name_nocase")), postPlan.join(" | "));
  assert.equal(postPlan.some((detail) => /SCAN (canonical|legacy)/i.test(detail)), false, postPlan.join(" | "));
});

test("sitemap tour keyset uses date/id ordering without a temporary sort", () => {
  const tourPlan = plan(`SELECT td.id,td.artist,td.artist_key,td.venue,td.place,td.source,
      td.venue_provider_id,td.date,td.updated_at,td.owner_id,COALESCE(td.provider_active,1) AS provider_active,
      td.venue_city,td.venue_region,td.venue_country_code,td.venue_country
    FROM tour_dates td INDEXED BY idx_tourdates_sitemap_cursor LEFT JOIN users owner ON owner.id=td.owner_id
    WHERE td.release_at<=?
      AND td.date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND TRIM(COALESCE(td.artist,''))<>'' AND TRIM(COALESCE(td.venue,''))<>''
      AND (td.owner_id IS NULL OR ${activeAccountSql("owner")})
      AND (td.owner_id IS NOT NULL OR COALESCE(td.provider_active,1)=1 OR td.date<?)
      AND (? IS NULL OR td.date>? OR (td.date=? AND td.id>?))
    ORDER BY td.date ASC,td.id ASC LIMIT ?`,
  Date.now(), "2026-08-26", null, null, null, null, 500);

  assert.ok(tourPlan.some((detail) => detail.includes("idx_tourdates_sitemap_cursor")), tourPlan.join(" | "));
  assert.equal(tourPlan.some((detail) => /USE TEMP B-TREE FOR ORDER BY/i.test(detail)), false, tourPlan.join(" | "));
});
