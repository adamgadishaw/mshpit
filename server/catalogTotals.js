import { db } from "./db.js";
import { createCatalogTotalsReader } from "./catalogTotalsRepository.js";

export const catalogTotals = createCatalogTotalsReader(db);
