import { lineupSections } from "./lineup.mjs";

// A card reserves space only for content it actually has. The canonical domain
// helpers still own data normalization; this is a presentation-only projection.
export function postCardPresentation(post, { showHref, compareHref, online = false, width = 390, fontScale = 1 } = {}) {
  const sections = online ? [] : lineupSections(post);
  const acts = sections.reduce((total, section) => total + section.acts.length, 0);
  const songs = online || !Array.isArray(post?.setlist) ? 0 : post.setlist.length;
  const detailsSummary = [acts ? `${acts} ${acts === 1 ? "act" : "acts"}` : "", songs ? `${songs} ${songs === 1 ? "song" : "songs"}` : ""].filter(Boolean).join(" · ");
  const availableWidth = Number.isFinite(width) && width > 0 ? width : 390;
  const textScale = Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1;
  return {
    hasDetails: !online && !!(showHref || compareHref || post?.eventAddress || post?.seen > 1 || acts || songs),
    detailsSummary,
    // A 44-point score should not squeeze the title to a sliver at large text.
    stackContext: (availableWidth - 56) / textScale < 280,
  };
}
