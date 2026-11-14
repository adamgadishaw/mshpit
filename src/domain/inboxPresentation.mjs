import { chatDeliverySnippetPrefix } from "./chatDeliveryPresentation.mjs";

const folded = (value) => String(value || "").normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();

// These are conversation summaries, not a full-history message search.
export function filterInboxConversations(threads, query) {
  const words = folded(query).trim().split(/\s+/u).filter(Boolean);
  if (!words.length) return threads;
  return threads.filter(thread => {
    const haystack = folded([thread.otherUser?.name, thread.otherUser?.handle ? `@${thread.otherUser.handle.replace(/^@/u, "")}` : "", thread.last?.text].filter(Boolean).join(" "));
    return words.every(word => haystack.includes(word));
  });
}

export function inboxPreview(thread, accountId) {
  const message = thread.last;
  if (!message) return "Start a conversation";
  const prefix = message.failed ? chatDeliverySnippetPrefix(message)
    : message.pending ? "Sending: " : message.from === accountId ? "You: " : "";
  return `${prefix}${message.text || ""}`.replace(/\s+/gu, " ").trim();
}

export function inboxUnreadLabel(count) {
  const unread = Math.max(0, Math.floor(Number(count) || 0));
  return unread > 99 ? "99+" : String(unread);
}
