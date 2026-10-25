export const CATALOG_PAGE_SIZE = 24;
export const CATALOG_MAX_PAGES = 5;
export function mergeCatalogEvents(...pages) {
  const result = new Map();
  for (const row of pages.flat()) {
    if (!row?.id || result.has(row.id)) continue;
    result.set(row.id, row);
    if (result.size >= CATALOG_PAGE_SIZE * CATALOG_MAX_PAGES) break;
  }
  return [...result.values()];
}
export async function readCatalogSearchPage(apiClient, query, { signal, after = null } = {}) {
  const params = new URLSearchParams({ q: String(query || "").trim().slice(0, 80), limit: String(CATALOG_PAGE_SIZE) });
  if (after) params.set("after", after);
  const response = await apiClient(`/api/search/events?${params}`, { signal, silent: true, context: "Searching concerts" });
  if (!Array.isArray(response?.events) || response.events.length > CATALOG_PAGE_SIZE
    || (response.nextCursor != null && (typeof response.nextCursor !== "string" || response.nextCursor.length > 1000 || response.nextCursor === after))) {
    throw new Error("Concert search returned an invalid page. Try again.");
  }
  return { rows: mergeCatalogEvents(response.events), nextCursor: response.nextCursor || null };
}
export async function readCatalogSearchPages(apiClient, query, { signal, pages = 1 } = {}) {
  let rows = [], nextCursor = null, loaded = 0;
  do {
    try {
      const page = await readCatalogSearchPage(apiClient, query, { signal, after: nextCursor });
      rows = mergeCatalogEvents(rows, page.rows);
      nextCursor = page.nextCursor;
      loaded += 1;
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") throw error;
      return { rows, nextCursor, pages: loaded, error };
    }
  } while (nextCursor && loaded < Math.min(CATALOG_MAX_PAGES, Math.max(1, pages)));
  return { rows, nextCursor, pages: loaded, error: null };
}
