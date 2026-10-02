import assert from "node:assert/strict";
import test from "node:test";

import { NEWS_SOURCES, sourceOwnsUrl } from "./newsSources.js";
import { EDITORIAL } from "./newsEditorial.js";
import { canonicalEditorialUrl, editorialSourceForUrl, editorialSourceNameMatches } from "./newsEditorialSources.js";
import { normalizeSelfWrittenSources } from "./newsDeskService.js";

const article = (name, url) => ({ kind: "article", name, url });
const moneyTodayKorean = String.fromCodePoint(0xBA38, 0xB2C8, 0xD22C, 0xB370, 0xC774);

test("manual editorial registry accepts the three newly vetted publishers and aliases", () => {
  const sources = normalizeSelfWrittenSources([
    article("Billboard Substack", "https://billboard.substack.com/p/bts-update"),
    article("Yonhap", "https://en.yna.co.kr/view/AEN20260319010251315"),
    article("MoneyToday", "https://www.mt.co.kr/entertainment/2026/10/01/2026100116277220024"),
  ]);
  assert.equal(sources.length, 3);
  assert.deepEqual(sources.map((source) => [source.sourceId, source.name, source.group]), [
    ["billboard-substack", "Billboard Substack", "pmc"],
    ["yonhap", "Yonhap News", "yonhap"],
    ["moneytoday", "Money Today", "moneytoday"],
  ]);
  assert.equal(new Set(sources.map((source) => source.group)).size, EDITORIAL.minOutlets);
});

test("manual sources remain bounded to exact vetted hosts and reject lookalikes or unsafe URLs", () => {
  for (const [url, id] of [
    ["https://billboard.substack.com/p/example", "billboard-substack"],
    ["https://en.yna.co.kr/view/example", "yonhap"],
    ["https://www.yna.co.kr/view/example", "yonhap"],
    ["https://www.mt.co.kr/entertainment/example", "moneytoday"],
    ["https://en.mt.co.kr/entertainment/example", "moneytoday"],
    ["https://m.mt.co.kr/entertainment/example", "moneytoday"],
  ]) assert.equal(editorialSourceForUrl(url)?.id, id, url);

  for (const url of [
    "https://substack.com/@billboard",
    "https://evil.billboard.substack.com/p/example",
    "https://billboard.substack.com.evil.example/p/example",
    "https://yna.co.kr/view/example",
    "https://evil.yna.co.kr/view/example",
    "https://en.yna.co.kr.evil.example/view/example",
    "https://mt.co.kr/entertainment/example",
    "https://evil.mt.co.kr/entertainment/example",
    "http://billboard.substack.com/p/example",
    "https://user:pass@en.yna.co.kr/view/example",
    "https://www.mt.co.kr:443/entertainment/example",
    "https://www.mt.co.kr.evil.example/entertainment/example",
  ]) assert.equal(editorialSourceForUrl(url), null, url);
});

test("publisher aliases are case-insensitive but do not accept arbitrary names", () => {
  const source = editorialSourceForUrl("https://www.mt.co.kr/entertainment/example");
  assert.equal(editorialSourceNameMatches(source, "Money Today"), true);
  assert.equal(editorialSourceNameMatches(source, moneyTodayKorean), true);
  assert.equal(editorialSourceNameMatches(source, "Money Today Official"), false);
});

test("manual evidence rejects duplicate URLs and same-owner source inflation", () => {
  assert.throws(() => normalizeSelfWrittenSources([
    article("Billboard Substack", "https://billboard.substack.com/p/duplicate"),
    article("Billboard", "https://billboard.substack.com/p/duplicate"),
    article("Yonhap", "https://en.yna.co.kr/view/duplicate"),
  ]), /distinct URL/u);
  assert.throws(() => normalizeSelfWrittenSources([
    article("Billboard", "https://billboard.com/music/music-news/one"),
    article("Rolling Stone", "https://rollingstone.com/music/music-news/two"),
    article("Variety", "https://variety.com/v/music/three"),
  ]), /independent music-publisher groups/u);
  assert.throws(() => normalizeSelfWrittenSources([
    article("Billboard", "https://www.billboard.com/music/music-news/one"),
    article("Billboard Substack", "https://billboard.substack.com/p/two"),
    article("Yonhap", "https://en.yna.co.kr/view/three"),
  ]), /independent music-publisher groups/u);
});

test("manual URL validation rejects raw normalization tricks and collapses fragments to one document", () => {
  for (const url of [
    "https://www.mt.co.kr:443/entertainment/example",
    "https://www.mt.co.kr\t:443/entertainment/example",
    "https://www.mt.co.kr\\:443/entertainment/example",
    "https://www.mt.co.kr/entertainment/example\\#section",
    "HTTPS://www.mt.co.kr/entertainment/example",
    " https://www.mt.co.kr/entertainment/example",
    "https://www.mt.co.kr/entertainment/example ",
  ]) assert.equal(editorialSourceForUrl(url), null, JSON.stringify(url));

  assert.equal(canonicalEditorialUrl("https://www.mt.co.kr/entertainment/example#facts"), "https://www.mt.co.kr/entertainment/example");
  assert.throws(() => normalizeSelfWrittenSources([
    article("NME", "https://www.nme.com/news/synthetic#facts"),
    article("NME", "https://www.nme.com/news/synthetic#quotes"),
    article("Yonhap", "https://en.yna.co.kr/view/synthetic"),
  ]), /distinct URL/u);
});

test("existing automated RSS registry and generated ownership checks are unchanged", () => {
  assert.equal(NEWS_SOURCES.length, 17);
  const billboard = NEWS_SOURCES.find((source) => source.id === "billboard");
  assert.equal(billboard.group, "pmc");
  assert.equal(sourceOwnsUrl(billboard, "https://www.billboard.com/music/music-news/example"), true);
  assert.equal(sourceOwnsUrl(billboard, "https://billboard.substack.com/p/example"), false);
  assert.equal(sourceOwnsUrl(billboard, "https://billboard.com.evil.example/example"), false);
});

test("manual normalization still caps at ten distinct article sources and keeps photo sources out of evidence", () => {
  const sources = [
    article("Billboard Substack", "https://billboard.substack.com/p/one"),
    article("Yonhap", "https://en.yna.co.kr/view/one"),
    article("Money Today", "https://www.mt.co.kr/entertainment/one"),
  ];
  assert.throws(() => normalizeSelfWrittenSources([
    ...sources,
    ...Array.from({ length: 8 }, (_, index) => article("Yonhap", `https://en.yna.co.kr/view/${index + 2}`)),
  ]), /independent article sources/u);
  assert.throws(() => normalizeSelfWrittenSources([
    article("Billboard Substack", "https://billboard.substack.com/p/photo-only"),
    article("Yonhap", "https://en.yna.co.kr/view/photo-only"),
    { kind: "photo", name: "Official photo", url: "https://photos.example/photo" },
  ]), /Article sources must be marked/u);
});
