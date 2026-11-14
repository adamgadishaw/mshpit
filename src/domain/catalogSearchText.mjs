// Search spelling only; never use this to bind artist or venue identity.
export function normalizeCatalogSearchText(value) {
  return String(value ?? "").slice(0, 8000).replace(/[\u0000-\u001f\u007f]/gu, " ")
    .normalize("NFKD").replace(/\p{Mark}+/gu, "").toLowerCase()
    .replace(/\s+/gu, " ").trim().slice(0, 8000);
}
