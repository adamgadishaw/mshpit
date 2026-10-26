import { sourceRegistry, sourceKinds } from "./sourceRegistry.js";
import { publicPageFor, renderPublicPage } from "../../publicPages.js";
import { listPublicPhotoCredits } from "../../photoCredits.js";
const esc = value => String(value ?? "").replace(/[&<>"']/gu, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
export function sourceRegistryPageResponse(database,query,env=process.env) {
  try { return {status:200,body:renderSourceRegistryPage(database,query,env)}; }
  catch (error) {
    // Do not render database errors, private records or query details publicly.
    console.error("[sources] public directory temporarily unavailable");
    return {status:503,body:renderPublicPage("/promotion-sources",env,{
      ...publicPageFor("/promotion-sources"),title:"Sources",intro:"Sources are temporarily unavailable.",
      note:"Please try again in a moment.",sections:[{heading:"Try again",links:[{label:"Reload Sources",href:"/promotion-sources"},{label:"Contact support",href:"/support"}]}],
    })};
  }
}
export function renderSourceRegistryPage(database, query, env = process.env) {
  const result = sourceRegistry(database).list(Object.fromEntries(query));
  const base = publicPageFor("/promotion-sources");
  const page = { ...base, title: "Sources", intro: result.edition ? `Credits for ${result.editions[0]?.title || result.edition}.` : "Reporting, media and data credits, organized by article and edition.",
    note: "A source credit identifies an origin. Reuse depends on the specific licence and permissions.", sections: [] };
  const href = overrides => { const p = new URLSearchParams({ ...Object.fromEntries(query), ...overrides }); return `/promotion-sources?${esc(p)}`; };
  const family=["photos","providers"].includes(query.get("family"))?query.get("family"):"articles";
  const controls = `<nav aria-label="Source collections"><a href="/promotion-sources" ${family==="articles"?'aria-current="page"':""}>Articles and editions</a><a href="/promotion-sources?family=photos" ${family==="photos"?'aria-current="page"':""}>Catalogue photographs</a><a href="/promotion-sources?family=providers" ${family==="providers"?'aria-current="page"':""}>Data providers</a></nav><form action="/promotion-sources" method="get" class="registry-search">
    <input type="hidden" name="family" value="${family}" />
    <label>Find a source or article <input name="q" value="${esc(result.q)}" maxlength="160" /></label>
    <label>Source kind <select name="kind"><option value="">All sources</option>${sourceKinds.map(kind => `<option${kind===result.kind?' selected':''} value="${kind}">${esc(kind[0].toUpperCase()+kind.slice(1))}</option>`).join("")}</select></label>
    ${["post","edition"].map(k => result[k] ? `<input type="hidden" name="${k}" value="${esc(result[k])}" />` : "").join("")}
    <button type="submit">Search</button><a href="/promotion-sources">Clear filters</a></form>`;
  const entries = [...result.editions.map(e=>({...e,headline:e.title,editionSlug:e.slug})),...result.articles].map(article => `<section><h2><a href="${href({post:article.postId || '',page:1,creditPage:1,q:"",edition:article.editionSlug || ''})}">${esc(article.headline)}</a></h2>
    ${article.postId?`<p><a href="/post/${encodeURIComponent(article.postId)}">Read article</a></p>`:""}
    ${sourceKinds.map(kind => {
      const credits = article.credits.filter(c => c.kind===kind);
      return credits.length ? `<h3>${esc(kind[0].toUpperCase()+kind.slice(1))}</h3><ul>${credits.map(c => `<li><a href="${esc(c.url)}" rel="noopener noreferrer">${esc(c.name)}</a>${c.credit ? ` — <span class="attribution">${esc(c.credit)}</span>` : ""}${c.licence ? `<br><span class="attribution">${esc(c.licence)}</span>` : ""}${c.edition ? `<br><a href="${href({edition:c.edition,post:"",q:"",page:1,creditPage:1})}">Edition: ${esc(c.edition)}</a>` : ""}</li>`).join("")}</ul>` : "";
    }).join("")}${article.credits.length ? "" : "<p>No credits for this filter.</p>"}${article.creditPage>1 || article.nextCreditPage ? `<nav aria-label="Credit pages for ${esc(article.headline)}">${article.creditPage>1?`<a href="${href({post:article.postId || "",edition:article.editionSlug || result.edition,page:1,creditPage:article.creditPage-1})}">Previous credits</a>`:""}<span>Credits page ${article.creditPage}</span>${article.nextCreditPage?`<a href="${href({post:article.postId || "",edition:article.editionSlug || result.edition,page:1,creditPage:article.nextCreditPage})}">Next credits</a>`:""}</nav>`:""}</section>`).join("") || "<section><p>No public articles match. Try another search or clear the filters.</p></section>";
  const photos=family==="photos"?listPublicPhotoCredits(result):null;
  const photoEntries=`<p>Permanent credits for registered artist share-card photographs. Other photographs retain their specific credits on <a href="/artists">artist</a>, <a href="/venues">venue</a> and <a href="/cities">city</a> pages.</p>`+(photos?.records.map(r=>`<section><h2><a href="${esc(r.path)}">${esc(r.artistKey)} — ${esc(r.photo.title)}</a></h2><p>${esc(r.photo.creator)} · ${esc(r.licenseLabel)}</p><p>${esc(r.photo.modificationNotice || '')}</p><a href="${esc(r.path)}">Source and licence details</a></section>`).join("") || "<section><p>No catalogue photo credits match.</p></section>");
  const providers=[
    ["MusicBrainz","Artist identities and core catalogue data","https://musicbrainz.org/doc/About/Data_License"],
    ["Wikidata","Structured artist identities and source links","https://www.wikidata.org/wiki/Wikidata:Data_access"],
    ["YouTube","Video metadata and official embedded playback","https://www.youtube.com/t/terms"],
    ["Deezer","Artist and track catalogue metadata","https://developers.deezer.com/termsofuse"],
    ["Ticketmaster","Tour dates and ticket links","https://www.ticketmaster.com"],
    ["Setlist.fm","Setlist information, with source attribution alongside setlists","https://www.setlist.fm"],
    ["Wikimedia Commons","Photographs with individual creator and licence credits","https://commons.wikimedia.org"],
    ["Openverse","Photo discovery; the original asset record determines its licence","https://openverse.org"],
  ];
  const providerEntries=providers.filter(p=>p.join(' ').toLowerCase().includes(result.q.toLowerCase())).map(([name,description,url])=>`<section><h2><a href="${url}">${name}</a></h2><p>${description}. Provider terms and individual asset licences apply.</p></section>`).join("") || "<section><p>No providers match.</p></section>";
  const navigation = `<nav aria-label="Sources pages">${result.page>1 && family!=="providers"?`<a href="${href({page:result.page-1,creditPage:1})}">Previous</a>`:""}<span>Page ${result.page}</span>${(photos?.hasMore || (family==="articles" && result.hasMore))?`<a href="${href({page:result.page+1,creditPage:1})}">Next</a>`:""}</nav>
    <section><h2>Other attribution</h2><p>Catalogue photographs and provider data retain their credits beside the relevant assets. <a href="/photo-rights">Photo rights</a> · <a href="/terms">Terms</a> · <a href="/support">Correct a credit or discuss promotional permission</a>.</p></section>`;
  return renderPublicPage("/promotion-sources",env,page)
    .replace(/<nav aria-label="Public information">[\s\S]*?<\/nav>/u,`<nav aria-label="Public information"><a href="/promotion-sources" aria-current="page">Sources</a><a href="/photo-rights">Photo rights</a><a href="/support">Support</a><a href="/">Open Mshpit</a></nav>`)
    .replace("</style>",`.note{padding:0;border:0;background:none;border-radius:0;font-size:.9rem}.registry-search{display:flex;flex-wrap:wrap;gap:16px;align-items:end;margin:30px 0}.registry-search label:first-of-type{flex:1;min-width:200px}label{display:grid;gap:6px;color:var(--dim)}input,select,button{font:inherit;max-width:100%;padding:10px;background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:5px}button{background:var(--gold);color:var(--gold-ink);cursor:pointer}input:focus-visible,select:focus-visible,button:focus-visible{outline:3px solid var(--gold);outline-offset:3px}.attribution{white-space:pre-wrap}li{overflow-wrap:anywhere}h3{font-size:1rem;color:var(--dim)}ul{padding-left:20px}section a{overflow-wrap:anywhere}</style>`)
    .replace("  </main>",`${controls}${family==="photos"?photoEntries:family==="providers"?providerEntries:entries}${navigation}  </main>`);
}
