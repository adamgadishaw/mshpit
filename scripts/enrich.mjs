#!/usr/bin/env node
// Fill missing artist data: hometown (origin), formed year, and EXTRA photos
// (Wikimedia Commons category) so the artist page has a real gallery. Keyless.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const UA = "PitConcertApp/0.1 (contact@example.com)";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "seed", "catalog.generated.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJSON = async (url, h = {}) => { try { const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json", ...h } }); return r.ok ? r.json() : null; } catch { return null; } };

async function wikidataId(mbid) {
  if (!mbid) return null;
  const d = await getJSON(`https://musicbrainz.org/ws/2/artist/${mbid}?inc=url-rels&fmt=json`);
  const wd = d?.relations?.find((r) => r.type === "wikidata")?.url?.resource;
  return wd ? wd.split("/").pop() : null;
}
const commonsThumb = (title) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(title.replace(/^File:/, ""))}?width=900`;
const isImg = (t) => /\.(jpe?g|png)$/i.test(t);
async function commonsImages(category) {
  if (!category) return [];
  const d = await getJSON(`https://commons.wikimedia.org/w/api.php?action=query&format=json&list=categorymembers&cmtitle=Category:${encodeURIComponent(category)}&cmtype=file&cmlimit=20`);
  return (d?.query?.categorymembers || []).map((m) => m.title).filter(isImg).slice(0, 8).map(commonsThumb);
}
// Fallback when an artist has no Wikidata Commons category (P373): search the
// File namespace on Commons by name. Lower precision, so only used to fill gaps.
async function commonsSearch(name) {
  if (!name) return [];
  const d = await getJSON(`https://commons.wikimedia.org/w/api.php?action=query&format=json&list=search&srnamespace=6&srlimit=10&srsearch=${encodeURIComponent(name)}`);
  return (d?.query?.search || []).map((s) => s.title).filter(isImg).slice(0, 6).map(commonsThumb);
}

async function main() {
  const cat = JSON.parse(await readFile(OUT, "utf8"));
  const keys = Object.keys(cat.artists);
  const originIds = {};
  let done = 0;
  for (const k of keys) {
    const a = cat.artists[k];
    if (a.hometown && a.photos?.length > 1) { done++; continue; }
    const wid = a.wikidataId || (await wikidataId(a.mbid));
    await sleep(1100);
    if (wid) {
      a.wikidataId = wid;
      const ent = await getJSON(`https://www.wikidata.org/wiki/Special:EntityData/${wid}.json`);
      const claims = ent?.entities?.[wid]?.claims || {};
      const inception = claims.P571?.[0]?.mainsnak?.datavalue?.value?.time;
      if (inception) a.formed = inception.replace(/^\+/, "").slice(0, 4);
      const originId = claims.P740?.[0]?.mainsnak?.datavalue?.value?.id || claims.P19?.[0]?.mainsnak?.datavalue?.value?.id;
      if (originId) originIds[k] = originId;
      const commonsCat = claims.P373?.[0]?.mainsnak?.datavalue?.value;
      let imgs = commonsCat ? await commonsImages(commonsCat) : [];
      // No category (or it was empty)? Fall back to a name search so thin/empty
      // galleries still get filled instead of being left blank.
      if (imgs.length < 2) {
        await sleep(300);
        imgs = [...new Set([...imgs, ...(await commonsSearch(a.name))])];
      }
      if (imgs.length) a.photos = [...new Set([...(a.photo ? [a.photo] : []), ...imgs])].slice(0, 8);
    }
    if (++done % 15 === 0) { console.log(`  …${done}/${keys.length}`); await writeFile(OUT, JSON.stringify(cat, null, 2)); }
    await sleep(300);
  }
  const ids = [...new Set(Object.values(originIds))];
  for (let i = 0; i < ids.length; i += 40) {
    const d = await getJSON(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&ids=${ids.slice(i, i + 40).join("|")}&props=labels&languages=en`);
    for (const k in originIds) { const lbl = d?.entities?.[originIds[k]]?.labels?.en?.value; if (lbl) cat.artists[k].hometown = lbl; }
    await sleep(400);
  }
  await writeFile(OUT, JSON.stringify(cat, null, 2));
  console.log("Done. hometowns + formed years + galleries filled.");
}
main();
