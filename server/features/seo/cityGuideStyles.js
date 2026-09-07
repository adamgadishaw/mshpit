// Scoped crawler/no-JavaScript presentation. The interactive screen uses the
// existing Mshpit theme; these styles leave every other public page unchanged.
export const CITY_GUIDE_STYLES = `
  .city-guide{--city-accent:#f2a65a;--city-panel:#10151f;--city-line:#293149;overflow-wrap:anywhere}
  .city-guide .city-marquee{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);margin-top:1.5rem;border:1px solid var(--city-line);border-radius:1.4rem;overflow:hidden;background:var(--city-panel);position:relative}
  .city-marquee::before{content:"";position:absolute;top:0;left:0;right:0;height:5px;background:linear-gradient(90deg,#f2a65a 0 50%,#ed5b8d 50% 75%,#5b8def 75%)}
  .city-marquee-copy{padding:clamp(1.4rem,4vw,3rem);min-width:0}
  .city-marquee h1{margin:0;font:900 clamp(2.5rem,5vw,4.4rem)/1.04 ui-rounded,"Arial Rounded MT Bold",system-ui,sans-serif;letter-spacing:-.045em}
  .city-marquee .hero-copy{margin-top:1rem;font-size:1rem;color:var(--ink);line-height:1.65}
  .city-marquee .hero-copy p{margin:0 0 .8rem}
  .city-marquee .eyebrow{color:var(--city-accent);line-height:1.5}
  .city-guide .city-hero-photo{border-radius:0;display:flex;flex-direction:column;min-width:0;background:#0c1018}
  .city-hero-photo>a{display:flex;flex:1;min-height:0}
  .city-guide .city-hero-photo img{width:100%;height:100%;min-height:18rem;max-height:32rem;object-fit:cover;flex:1}
  .city-guide .city-hero-photo figcaption{font-size:.7rem;padding:.6rem .9rem}
  .city-ticket-stub{grid-column:1/-1;display:flex;flex-wrap:wrap;justify-content:space-between;gap:.8rem;padding:1rem 1.4rem;border-top:1px dashed var(--city-line);background:#1a2030;color:var(--city-accent);font:700 .8rem/1.5 ui-monospace,monospace}
  .city-guide .city-section-links{display:flex;flex-wrap:wrap;gap:.55rem;margin:1rem 0 0}
  .city-guide .city-section-links a{display:flex;align-items:center;min-height:44px;padding:.55rem .85rem;border:1px solid var(--city-line);border-radius:.65rem;background:var(--city-panel);font-size:.82rem;text-decoration:none;font-weight:700}
  .city-guide .city-section-links a:hover,.city-guide a:focus-visible{outline:2px solid var(--city-accent);outline-offset:3px}
  .city-guide .city-section{padding:2rem 0;scroll-margin-top:1rem}
  .city-guide .city-section h2{margin:0 0 1.2rem;font:900 clamp(1.5rem,3vw,2.3rem)/1.1 ui-rounded,"Arial Rounded MT Bold",system-ui,sans-serif;letter-spacing:-.02em}
  .city-guide .city-show-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem}
  .city-guide .city-show-list li{grid-template-columns:5rem minmax(0,1fr);gap:1rem;padding:1rem;border:1px solid var(--city-line);border-radius:1rem;background:var(--city-panel)}
  .city-show-list time{align-self:stretch;place-content:center;border-right:1px dashed var(--city-line);padding-right:.75rem;color:var(--city-accent);font:700 .82rem/1.6 ui-monospace,monospace}
  .city-show-list h3{font-size:1.1rem;line-height:1.25}
  .city-show-list h3 a{text-decoration:none}
  .city-show-list p{color:var(--muted);font-size:.8rem;line-height:1.6}
  .city-guide .city-photo-strip{display:grid;grid-auto-flow:column;grid-auto-columns:clamp(15rem,35vw,24rem);grid-template-columns:none;overflow-x:auto;gap:.8rem;scroll-snap-type:x proximity;padding-bottom:.7rem}
  .city-photo-strip figure{scroll-snap-align:start}
  .city-guide .city-photo-strip img{width:100%;height:15rem;object-fit:contain;background:#07090f}
  .city-guide .city-programme{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem;margin-top:1rem}
  .city-programme:empty{display:none}
  .city-guide .city-programme .city-section{padding:1.4rem;border:1px solid var(--city-line);border-top:4px solid var(--city-accent);border-radius:1rem;background:var(--city-panel);content-visibility:visible}
  .city-programme p{color:var(--ink);line-height:1.8;font-size:.95rem}
  .city-guide .artist-grid>li{padding:1.1rem;border:1px solid var(--city-line);border-radius:1rem;background:var(--city-panel);min-width:0}
  .city-guide .artist-grid h3{margin:0 0 .5rem;font-size:1.15rem}
  .city-guide .artist-grid p{color:var(--muted);font-size:.85rem}
  .city-guide .breadcrumbs li,.city-guide .breadcrumbs ol a{display:inline-flex;align-items:center;min-height:44px}
  .city-directory .hero{padding:3rem 0}
  .city-directory .hero h1{font:900 clamp(2.5rem,5vw,4rem)/1.05 ui-rounded,"Arial Rounded MT Bold",system-ui,sans-serif;letter-spacing:-.03em}
  @media(max-width:760px){.city-guide .city-marquee{grid-template-columns:1fr}.city-marquee-copy{order:1}.city-guide .city-hero-photo{order:0;max-height:18rem}.city-guide .city-hero-photo img{min-height:0;height:14rem}.city-ticket-stub{order:2}.city-guide .city-show-list,.city-guide .city-programme{grid-template-columns:1fr}.city-guide .city-section-links a:nth-child(n){display:flex}.city-guide .city-section{padding:1.5rem 0}.city-guide .breadcrumbs ol a:nth-child(n){display:inline-flex}.city-directory .hero h1{font-size:2.5rem}}
`;
