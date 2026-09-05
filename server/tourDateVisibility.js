import { db } from "./db.js";
import { visibleTourDateRowsFrom } from "./tourDateVisibilityQuery.js";

export { visibleTourDateRowsFrom } from "./tourDateVisibilityQuery.js";

export function visibleTourDateRows(viewer, options = {}) {
  return visibleTourDateRowsFrom(db, viewer, options);
}
