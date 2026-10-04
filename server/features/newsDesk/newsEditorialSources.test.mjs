import assert from "node:assert/strict";
import test from "node:test";

import { NEWS_SOURCES, sourceOwnsUrl } from "./newsSources.js";
import { EDITORIAL } from "./newsEditorial.js";
import { canonicalEditorialUrl, canonicalManualCitationUrl, editorialSourceForUrl, editorialSourceNameMatches } from "./newsEditorialSources.js";
import { isConfirmed } from "./newsStoryRules.js";
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

test("known publisher lookup remains bounded to vetted hosts and rejects lookalikes or unsafe URLs", () => {
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

test("manual citations reject duplicate URLs without requiring independent publisher groups", () => {
  assert.throws(() => normalizeSelfWrittenSources([
    article("Billboard Substack", "https://billboard.substack.com/p/duplicate"),
    article("Billboard", "https://billboard.substack.com/p/duplicate"),
    article("Yonhap", "https://en.yna.co.kr/view/duplicate"),
  ]), /distinct URL/u);
  const sameOwner = normalizeSelfWrittenSources([
    article("Billboard", "https://billboard.com/music/music-news/one"),
    article("Rolling Stone", "https://rollingstone.com/music/music-news/two"),
    article("Variety", "https://variety.com/v/music/three"),
  ]);
  assert.equal(sameOwner.length, 3);
  assert.equal(new Set(sameOwner.map(source => source.group)).size, 1);
  assert.equal(normalizeSelfWrittenSources([
    article("Billboard", "https://www.billboard.com/music/music-news/one"),
    article("Billboard Substack", "https://billboard.substack.com/p/two"),
    article("Yonhap", "https://en.yna.co.kr/view/three"),
  ]).length, 3);
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
  assert.equal(EDITORIAL.minOutlets, 3);
  assert.equal(isConfirmed([{ group: "one" }, { group: "two" }]), false);
  assert.equal(isConfirmed([{ group: "one" }, { group: "two" }, { group: "three" }]), true);
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
  ]), /named article sources/u);
  assert.throws(() => normalizeSelfWrittenSources([
    article("Billboard Substack", "https://billboard.substack.com/p/photo-only"),
    article("Yonhap", "https://en.yna.co.kr/view/photo-only"),
    { kind: "photo", name: "Official photo", url: "https://photos.example/photo" },
  ]), /Article sources must be marked/u);
});

test("manual citations accept official and independent reporting without inventing publisher identity", () => {
  for (const name of ["Fixture Artist", "Fixture Venue", "Fixture Label", "Fixture Ticket Office", "Independent Music Reporter"]) {
    const source = { ...article(name, "https://artist.example.com/announcement#details"), sourceId: "nme", group: "pmc" };
    assert.deepEqual(normalizeSelfWrittenSources([source]), [article(name, "https://artist.example.com/announcement")]);
  }
  assert.equal(normalizeSelfWrittenSources([article("NME", "https://www.nme.com/news/one")])[0].sourceId, "nme");
  assert.equal(normalizeSelfWrittenSources(Array.from({ length: 10 }, (_, i) => article("Fixture Artist", `https://artist.example.com/report-${i}`))).length, 10);
  assert.throws(() => normalizeSelfWrittenSources([]), /named article sources/u);
  assert.throws(() => normalizeSelfWrittenSources([article("", "https://artist.example.com/report")]), /needs a name/u);
  const bounded = normalizeSelfWrittenSources([{ ...article("Example source ".repeat(12), "https://artist.example.com/report"), title: "Example title ".repeat(20) }]);
  assert.equal(bounded[0].name.length, 160);
  assert.equal(bounded[0].title.length, 240);
});

test("manual citation URLs stay bounded HTTPS references without local or numeric hosts", () => {
  for (const url of [
    "http://artist.example.com/report", "javascript:alert(1)", "file:///report", "data:text/html,report",
    "https://user:pass@artist.example.com/report", "https://artist.example.com:443/report", "https://artist.example.com:/report",
    "https://artist.example.com\\report", "https://artist.example.com/\u0000report", "https://artist.example.com/\nreport",
    " https://artist.example.com/report", "HTTPS://artist.example.com/report", "https://artist.example.com/report ",
    "https://localhost/report", "https://sub.localhost/report", "https://metadata.google.internal/report", "https://example.local/report",
    "https://127.0.0.1/report", "https://2130706433/report", "https://0x7f000001/report", "https://[::1]/report",
    "https://10.0.0.1/report", "https://169.254.169.254/report", "https://192.168.1.1/report",
    "https://artist.example.com/" + "x".repeat(2048),
  ]) {
    assert.equal(canonicalManualCitationUrl(url), null, JSON.stringify(url));
    assert.throws(() => normalizeSelfWrittenSources([article("Fixture Artist", url)]), /secure HTTPS/u);
  }
  assert.equal(canonicalManualCitationUrl("https://artist.example.com/report#quotes"), "https://artist.example.com/report");
});

test("manual citations cannot borrow a known publisher name for an unrelated URL", () => {
  for (const [name, url] of [
    ["NME", "https://artist.example.com/report"],
    ["Billboard", "https://billboard.com.evil.com/report"],
    ["Billboard Substack", "https://unrelated.substack.com/p/report"],
    ["Yonhap", "https://en.yna.co.kr.evil.com/report"],
    ["MoneyToday", "https://artist.example.com/report"],
    ["NME\u200b", "https://artist.example.com/report"],
    ["ＮＭＥ", "https://artist.example.com/report"],
    ["Rolling\u00a0Stone", "https://artist.example.com/report"],
    ["Fixture Artist", "https://www.nme.com/news/report"],
  ]) assert.throws(() => normalizeSelfWrittenSources([article(name, url)]), /publisher name must match/u);
  assert.equal(normalizeSelfWrittenSources([article("NME\u200b", "https://www.nme.com/news/report")])[0].name, "NME");
});
