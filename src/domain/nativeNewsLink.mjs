// Only owned news routes; arbitrary external URLs and dev-client URLs are ignored.
export function nativeNewsLinkFrame(value) {
  try {
    const url = new URL(value);
    let path;
    if (url.protocol === "https:" && ["www.mshpit.com", "mshpit.com"].includes(url.hostname) && !url.username && !url.password) path = url.pathname;
    else if (["mshpit:", "mshpit-dev:"].includes(url.protocol) && url.hostname === "news") path = "/news" + url.pathname;
    else return null;
    if (path === "/news" || path === "/news/") return { news: true };
    const live = /^\/news\/live\/([a-z0-9-]{1,80})$/u.exec(path);
    return live ? { news: true, liveSlug: live[1] } : null;
  } catch { return null; }
}
