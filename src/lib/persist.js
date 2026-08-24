// Non-Metro fallback (Node tests and unsupported runtimes). Metro resolves
// persist.web.js in browsers and persist.native.js on iOS/Android.
import { createJsonPersistence } from "./persistenceAdapter.mjs";

const persistence = createJsonPersistence();

export const load = persistence.load;
export const save = persistence.save;
export const remove = persistence.remove;
export const setPersistErrorHandler = persistence.setErrorHandler;
