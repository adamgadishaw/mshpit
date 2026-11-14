// Web auth intent already has independent cookie/localStorage fallbacks.
// Native overrides this module because SQLite is its only durable intent store.
export function confirmAuthIntent() {}
