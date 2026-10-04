import { api } from "./api";

export function readCatalogPageText({ type, key, signal }) {
  return api(`/api/catalog-text/${type}/${encodeURIComponent(key)}`, {
    signal, silent: true, context: "Loading sourced page text",
  });
}
