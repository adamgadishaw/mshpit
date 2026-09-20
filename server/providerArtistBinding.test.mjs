import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { tourDateArtistBindingAllowedSql, tourDateArtistIdentityPending } from "./providerArtistBinding.js";

test("provider identity guards agree in JS and SQL and never hold member-authored shows", () => {
  const database=new DatabaseSync(":memory:");
  try {
    database.exec("CREATE TABLE tour_dates(owner_id TEXT,artist_identity_status TEXT)");
    const insert=database.prepare("INSERT INTO tour_dates VALUES (?,?)");
    for (const owner of [null,"member"]) for (const status of [null,"registered","pending","conflict"]) {
      database.exec("DELETE FROM tour_dates");
      insert.run(owner,status);
      const row={owner_id:owner,artist_identity_status:status};
      const allowed=database.prepare(`SELECT ${tourDateArtistBindingAllowedSql("td")} AS allowed FROM tour_dates td`).get().allowed;
      assert.equal(!!allowed,!tourDateArtistIdentityPending(row));
      assert.equal(tourDateArtistIdentityPending(row),owner===null && ["pending","conflict"].includes(status));
    }
    assert.throws(()=>tourDateArtistBindingAllowedSql("td;DROP"),/Invalid tour-date SQL alias/);
  } finally {database.close();}
});
