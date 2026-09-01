import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  canonicalYouTubeReviewLink,
  cleanExperienceType,
  inPersonReviewSql,
  projectedOnlineReviewFields,
} from "./onlineReviews.js";

test("online review YouTube links canonicalize supported watch, short, live, and id inputs", () => {
  const id = "dQw4w9WgXcQ";
  for (const input of [
    id,
    `https://www.youtube.com/watch?v=${id}&t=15`,
    `https://youtube.com/shorts/${id}?feature=share`,
    `https://youtube.com/live/${id}?si=tracking`,
    `https://youtu.be/${id}?t=1`,
  ]) {
    assert.deepEqual(canonicalYouTubeReviewLink({ youtubeUrl: input }), {
      youtubeVideoId: id,
      youtubeUrl: `https://www.youtube.com/watch?v=${id}`,
    });
  }
  assert.deepEqual(canonicalYouTubeReviewLink({ youtubeVideoId: id }), {
    youtubeVideoId: id,
    youtubeUrl: `https://www.youtube.com/watch?v=${id}`,
  });
});

test("online review YouTube links reject foreign hosts, malformed ids, and conflicting identities", () => {
  assert.equal(canonicalYouTubeReviewLink({ youtubeUrl: "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ" }), undefined);
  assert.equal(canonicalYouTubeReviewLink({ youtubeUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ" }), undefined);
  assert.equal(canonicalYouTubeReviewLink({ youtubeUrl: "https://youtu.be/too-short" }), undefined);
  assert.equal(canonicalYouTubeReviewLink({
    youtubeUrl: "https://youtu.be/dQw4w9WgXcQ",
    youtubeVideoId: "abcdefghijk",
  }), undefined);
});

test("stored online review fields fail closed without breaking legacy in-person projections", () => {
  assert.equal(cleanExperienceType("online"), "online");
  assert.equal(cleanExperienceType("in_person"), "in_person");
  assert.equal(cleanExperienceType("virtual"), null);
  assert.deepEqual(projectedOnlineReviewFields({}), {
    experienceType: "in_person",
    onlineTitle: null,
    youtubeUrl: null,
    youtubeVideoId: null,
  });
  assert.deepEqual(projectedOnlineReviewFields({
    experience_type: "online",
    online_title: "  Tiny Desk Concert  ",
    youtube_url: "https://evil.test/watch?v=dQw4w9WgXcQ",
  }), {
    experienceType: "online",
    onlineTitle: "Tiny Desk Concert",
    youtubeUrl: null,
    youtubeVideoId: null,
  });
  assert.match(inPersonReviewSql("review_post"), /experience_type/);
  assert.throws(() => inPersonReviewSql("p;DROP TABLE posts"), /Invalid SQL alias/);

  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE posts (kind TEXT, experience_type TEXT);
    INSERT INTO posts VALUES ('review','in_person'),('review','online'),('status','in_person')`);
  assert.equal(database.prepare(`SELECT COUNT(*) count FROM posts p WHERE ${inPersonReviewSql("p")}`).get().count, 1);
  database.close();
});
