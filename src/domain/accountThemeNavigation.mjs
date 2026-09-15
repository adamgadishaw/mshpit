// Account appearance can reload the StyleSheet-based web app. The confirmed
// destination must own the URL first: authentication Back is asynchronous and
// public routes may still be hydrating. Never use a timer to guess completion.
export function accountThemeNavigationReady({ authReady, accountId, frame, sensitiveFlow = false } = {}) {
  return authReady === true && !!accountId && !sensitiveFlow
    && !frame?.auth && !frame?.routeLoading;
}
