import { isReviewDetail } from './showNavigation.mjs';

// Retain a signed-in native Feed under its media viewer or review visit. Other
// destinations and account transitions keep their existing unmount boundary.
export function retainNativeFeedForMedia({ platform, wide = false, accountId, tab, frames, hasOverlay }) {
  if (!['android', 'ios'].includes(platform) || wide || !accountId || tab !== 'feed') return false;
  if (!Array.isArray(frames) || !frames.length || !frames[0] || Object.keys(frames[0]).length) return false;
  if (frames.length === 1) return !hasOverlay;
  const frame = frames[1];
  if (isReviewDetail(frame?.post) && Object.keys(frame).every(key => key === 'post')) return !!hasOverlay;
  return frames.length === 2 && !!hasOverlay && !!frame?.photos && Object.keys(frame).every(key => key === 'photos');
}

export function nativeFeedCanWork({ platform, appActive, visible }) {
  return !!appActive && (platform === 'web' || !!visible);
}
