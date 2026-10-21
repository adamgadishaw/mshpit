import { ApiError } from '../../errors.js';

// Exact route family: no general staff overview, generated drafts, member data,
// arbitrary source fetching, variants, video, live coverage or administration.
export const NEWSROOM_BROWSER_ROUTES = Object.freeze([
  ['GET', /^\/api\/newsroom-session\/status$/u],
  ['POST', /^\/api\/newsroom-session\/logout(?:-all)?$/u],
  ['GET', /^\/api\/newsroom-session\/drafts$/u],
  ['POST', /^\/api\/newsroom-session\/drafts$/u],
  ['GET', /^\/api\/newsroom-session\/drafts\/[A-Za-z0-9-]{8,64}$/u],
  ['POST', /^\/api\/newsroom-session\/drafts\/[A-Za-z0-9-]{8,64}\/(?:publish|discard)$/u],
  ['POST', /^\/api\/newsroom-session\/media$/u],
  ['GET', /^\/api\/newsroom-session\/media\/[A-Za-z0-9_-]{1,100}$/u],
  ['POST', /^\/api\/newsroom-session\/media\/[A-Za-z0-9_-]{1,100}\/finalize$/u],
]);
export function assertNewsroomRoute(method, pathname) {
  if (!NEWSROOM_BROWSER_ROUTES.some(([verb, pattern]) => verb === method && pattern.test(pathname))) {
    throw new ApiError(403, 'This remembered session is limited to self-written Newsroom articles.', 'FORBIDDEN');
  }
}
