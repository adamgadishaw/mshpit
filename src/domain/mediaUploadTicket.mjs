const HTTP_URL = /^https?:\/\/[^\s]+$/i;
const PRIVATE_LOCATOR = /^pit-private:users\/[A-Za-z0-9_-]{1,128}\/[a-z0-9-]{1,40}\/[A-Za-z0-9_-]{1,160}\.(?:jpe?g|png|webp|gif|heic|heif|avif|mp4|webm|mov)$/;

function headersAreBound(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  if (!entries.length || entries.some(([key, item]) => !key || typeof item !== "string" || !item)) return false;
  const normalized = Object.fromEntries(entries.map(([key, item]) => [key.toLowerCase(), item]));
  return typeof normalized["content-type"] === "string"
    && normalized["if-none-match"] === "*";
}

export function isPrivateMediaLocator(value) {
  return PRIVATE_LOCATOR.test(String(value || ""));
}

// Public and private tickets have deliberately different completion
// capabilities. Requiring an explicit scope prevents a malformed response from
// silently weakening a private source into a public URL (or vice versa).
export function validMediaUploadTicket(ticket) {
  if (!ticket || typeof ticket !== "object") return false;
  if (!HTTP_URL.test(String(ticket.uploadUrl || "")) || !headersAreBound(ticket.requiredHeaders)) return false;
  if (ticket.method && String(ticket.method).toUpperCase() !== "PUT") return false;

  if (ticket.storageScope === "private") {
    return (ticket.publicUrl == null || ticket.publicUrl === "")
      && isPrivateMediaLocator(ticket.storageLocator);
  }
  if (ticket.storageScope === "public") {
    return HTTP_URL.test(String(ticket.publicUrl || ""))
      && ticket.storageLocator === ticket.publicUrl;
  }
  return false;
}
