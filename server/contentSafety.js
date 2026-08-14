import { ApiError } from "./errors.js";

export const CONTENT_REJECTED_CODE = "CONTENT_REJECTED";

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>{}\[\]]+/giu;
const BARE_DOMAIN_PATTERN = /\b(?:[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\.)+(?:app|biz|ca|co|com|dev|gg|info|io|ly|me|net|org|test|tv|xyz)(?:\/[^\s<>{}\[\]]*)?/giu;
const UNSAFE_SCHEME_PATTERN = /\b(?:javascript|vbscript)\s*:|\bdata\s*:\s*text\/html|\bfile\s*:\s*\/\//iu;

function normalizedText(value) {
  if (typeof value !== "string") return "";
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

function repeatedTokenFlood(text) {
  const tokens = text.match(/[\p{L}\p{N}]{2,}/gu) || [];
  let previous = "";
  let run = 0;
  for (const token of tokens) {
    if (token === previous) run += 1;
    else { previous = token; run = 1; }
    if (run >= 15) return true;
  }
  return false;
}

// Conservative, deterministic first-line filtering, not a comprehensive
// moderation system. It intentionally blocks only high-confidence direct
// abuse/exploitation phrases and mechanical spam; ambiguous or quoted language
// remains publishable and can still be user-reported.
export function contentSafetyDecision(value) {
  const text = normalizedText(value);
  if (!text) return { safe: true, category: null };
  const deobfuscatedText = text
    .replace(/[013457@$]/gu, (character) => ({ "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s" }[character]))
    .replace(/[аеікӏοоѕу]/gu, (character) => ({ "а": "a", "е": "e", "і": "i", "к": "k", "ӏ": "l", "ο": "o", "о": "o", "ѕ": "s", "у": "y" }[character]));
  const obfuscatedCompact = deobfuscatedText.replace(/[^\p{L}\p{N}]+/gu, "");

  const directAbuse = [
    /^(?:please\s+)?(?:(?:go|just|you (?:should|need to))\s+)?(?:fucking\s+)?kill yourself(?:\s+now)?[.!]*$/u,
    /^(?:(?:go|just|you (?:should|need to))\s+)(?:fucking\s+)?die(?:\s+now)?[.!]*$/u,
    /^i hope you die[.!]*$/u,
    /^(?:please\s+)?kys(?:\s+now)?[.!]*$/u,
    /^(?:i(?:'m| am) going to|we(?:'re| are) going to|i(?:'ll| will)|we(?:'ll| will)|i(?:'m| am) gonna|we(?:'re| are) gonna)\s+(?:find\s+you\s+and\s+)?(?:kill|murder|shoot|stab|rape)\s+you(?:\s+(?:tonight|tomorrow|when i see you|at your (?:home|house|work)))?[.!]*$/u,
    /^(?:i(?:'m| am) going to|we(?:'re| are) going to|i(?:'ll| will)|we(?:'ll| will)|i(?:'m| am) gonna|we(?:'re| are) gonna)\s+(?:find\s+you\s+and\s+)?beat\s+you\s+to\s+death[.!]*$/u,
    /^i(?:'ll| will| am going to|'m going to)\s+burn\s+your\s+(?:home|house)\s+down[.!]*$/u,
    /^i(?:'m| am)\s+coming\s+to\s+(?:find\s+and\s+)?hurt\s+you[.!]*$/u,
    /\ball\s+(?:people|men|women|boys|girls|fans|users|immigrants|refugees|jews|muslims|christians|hindus|sikhs|gays|lesbians|trans people|black people|white people|asians)\s+(?:should|must|need to)\s+(?:die|be killed)\b/u,
    /^(?:please\s+|hey\s+)?(?:send|trade|share)\s+(?:me\s+)?(?:porn|nudes|naked (?:pics|photos))[.!]*$/u,
    /^(?:please\s+)?(?:send|share|trade|buy|sell)\s+(?:me\s+)?(?:csam|child sexual abuse material|child pornography|child porn|sexual images? of minors?|nudes? of minors?)[.!]*$/u,
    /^(?:nudes?|naked (?:pics|photos)|sexual images?)\s+(?:from|of)\s+(?:an?\s+)?(?:minor|child|(?:1[0-7]|[0-9])\s*[- ]?year[- ]old)[.!]*$/u,
    /\bi\s+(?:have|want|am looking for|'m looking for)\s+(?:csam|child sexual abuse material|child pornography|child porn|sexual images? of minors?|nudes? of minors?)\b/u,
    /\b(?:heil hitler|white power|nazis were right)\b/u,
  ];
  // Compact signatures catch limited leet/punctuation/spaced-letter evasions
  // while remaining anchored to the whole submission. That boundary is what
  // keeps quoted threats, lyrics, song titles, and supportive safety discussion
  // publishable: their surrounding context makes the compact value different.
  const compactDirectAbuse = /^(?:(?:hey|listen|look)(?:you)?)?(?:please)?(?:(?:go|just|youshould|youneedto))?(?:fucking)?killyourself(?:rightnow|now|loser|youloser)?$|^(?:please)?kys(?:rightnow|now)?$|^(?:youneedto|gofucking|go)die(?:rightnow|now)?$|^ihopeyoudie$|^(?:whitepower|heilhitler|naziswereright|childporn|childpornography|childsexualabusematerial|csam)$/u;
  const compactDirectThreat = /^(?:(?:hey|listen|look)(?:you)?)?(?:(?:iwill|ill|iamgoingto|imgoingto|imgonna|wewill|well|wearegoingto|weregoingto|weregonna))(?:findyouand)?(?:kill|murder|shoot|stab|rape)you(?:rightnow|now|tonight|tomorrow|wheniseeyou|atyourhome|atyourhouse|atyourwork|andlaugh|andlaughatyou|loser|youloser)?$|^(?:(?:hey|listen|look)(?:you)?)?i(?:will|ll|amgoingto|mgoingto)burnyour(?:home|house)down(?:rightnow|now|tonight)?$|^(?:(?:hey|listen|look)(?:you)?)?i(?:am|m)comingto(?:findand)?hurtyou(?:rightnow|now|tonight)?$/u;
  const compactExploitationSolicitation = /^(?:(?:hey|please)(?:you)?)?(?:send|share|trade)(?:me)?(?:porn|nudes|nakedpics|nakedphotos)(?:rightnow|now|tonight|asap|immediately)?$|^(?:(?:hey|please)(?:you)?)?(?:send|share|trade|buy|sell)(?:me)?(?:csam|childporn|childpornography|childsexualabusematerial|sexualimagesofminors|nudesofminors)(?:rightnow|now|tonight|asap|immediately)?$/u;
  if (directAbuse.some((pattern) => pattern.test(text) || pattern.test(deobfuscatedText))
    || compactDirectAbuse.test(obfuscatedCompact)
    || compactDirectThreat.test(obfuscatedCompact)
    || compactExploitationSolicitation.test(obfuscatedCompact)) {
    return { safe: false, category: "high_confidence_abuse" };
  }

  if (UNSAFE_SCHEME_PATTERN.test(text)) return { safe: false, category: "unsafe_link" };
  const urls = [
    ...(text.match(URL_PATTERN) || []),
    ...(text.replace(URL_PATTERN, " ").match(BARE_DOMAIN_PATTERN) || []),
  ];
  const normalizedUrls = urls.map((url) => url.replace(/[),.!?]+$/u, ""));
  if (normalizedUrls.length >= 4) return { safe: false, category: "link_flood" };
  if (normalizedUrls.length >= 2 && new Set(normalizedUrls).size < normalizedUrls.length) {
    return { safe: false, category: "repeated_link" };
  }
  if (normalizedUrls.length && /\b(?:guaranteed returns?|double your money|risk[- ]free crypto|instant payout)\b/u.test(text)) {
    return { safe: false, category: "scam_spam" };
  }

  const mentions = text.match(/(^|\s)@[a-z0-9_]{2,}/gu) || [];
  if (mentions.length >= 9 || repeatedTokenFlood(text) || /(.)\1{39,}/u.test(text)) {
    return { safe: false, category: "message_flood" };
  }
  return { safe: true, category: null };
}

export function assertSafeAuthoredText(value, { field = "content" } = {}) {
  const decision = contentSafetyDecision(value);
  if (decision.safe) return value;
  // Never echo, attach, or log rejected text. The stable code lets every client
  // render one recoverable composer error without receiving policy internals.
  throw new ApiError(
    422,
    `This ${field} cannot be published. Remove threats, exploitation, or spam links and try again.`,
    CONTENT_REJECTED_CODE,
  );
}

export function assertSafeAuthoredFields(fields) {
  for (const [field, value] of Object.entries(fields || {})) {
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (typeof item === "string" && item) assertSafeAuthoredText(item, { field });
    }
  }
}
