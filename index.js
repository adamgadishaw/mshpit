import { registerRootComponent } from 'expo';

import App from './App';
import { clearInjectedPublicDocument, shouldPreservePublicDocument } from './src/domain/webRootHandoff.mjs';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
const preserveDocument = typeof document !== "undefined"
  && shouldPreservePublicDocument(document, window.location.pathname);
if (preserveDocument) {
  // This server document is the finished page; no React root will mount to
  // release the pre-paint visibility guard. Reveal it now, not at the watchdog.
  globalThis.__MSHPIT_WEB_BOOT__?.complete?.();
} else {
  if (typeof document !== "undefined") clearInjectedPublicDocument(document);
  registerRootComponent(App);
}
