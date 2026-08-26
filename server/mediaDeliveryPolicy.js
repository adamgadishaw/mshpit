// Public derivatives have deterministic, create-only keys, but their
// publication can still be revoked by deletion or moderation. The same exact
// short revalidation policy is signed by the web control plane, verifier, and
// recovery tools so no worker can silently extend retention in browser/CDN
// caches after the authoritative object is removed.
export const PUBLIC_MEDIA_CACHE_CONTROL = "public, max-age=300, must-revalidate";
