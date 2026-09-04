export const DEFAULT_CONTENT_PREVIEW_LIMIT = 100;

const whitespace = (value) => /\s/u.test(value || "");
const protectedToken = (value) => /^(?:@[\p{L}\p{N}_]+|(?:https?:\/\/|www\.)\S+)$/iu.test(value);

const previewLimit = (value) => {
  const requested = Number(value);
  return Number.isSafeInteger(requested) && requested > 1
    ? requested
    : DEFAULT_CONTENT_PREVIEW_LIMIT;
};

// Produces a display-only excerpt. The source string is never normalized, so
// expanding restores the exact original content, including its line breaks.
export function contentPreview(value, { limit = DEFAULT_CONTENT_PREVIEW_LIMIT, expanded = false } = {}) {
  const original = value == null ? "" : String(value);
  const characters = [...original];
  const take = previewLimit(limit);
  const expandable = characters.length > take;

  if (!expandable || expanded) {
    return Object.freeze({ text: original, truncated: false, expandable });
  }

  let end = take;
  const cutsToken = !whitespace(characters[end - 1]) && !whitespace(characters[end]);

  if (cutsToken) {
    let tokenStart = end;
    while (tokenStart > 0 && !whitespace(characters[tokenStart - 1])) tokenStart -= 1;

    let tokenEnd = end;
    while (tokenEnd < characters.length && !whitespace(characters[tokenEnd])) tokenEnd += 1;

    const token = characters.slice(tokenStart, tokenEnd).join("");
    if (protectedToken(token)) {
      // Never turn a tappable mention or URL into a misleading partial token.
      // If it starts the text, show that one token even when it exceeds the
      // preferred limit; otherwise end the excerpt before it.
      end = tokenStart > 0 ? tokenStart : tokenEnd;
    } else if (tokenStart >= Math.floor(take * 0.6)) {
      // Prefer a nearby word boundary. A single extremely long unbroken word
      // still receives a bounded fallback rather than defeating the preview.
      end = tokenStart;
    }
  }

  while (end > 0 && whitespace(characters[end - 1])) end -= 1;
  if (end <= 0) end = take;

  if (end >= characters.length) {
    return Object.freeze({ text: original, truncated: false, expandable: false });
  }

  return Object.freeze({
    text: `${characters.slice(0, end).join("").trimEnd()}…`,
    truncated: true,
    expandable: true,
  });
}
