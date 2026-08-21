// `If-None-Match: *` turns each signed object key into create-only storage.
// A retry after a lost successful response receives 412 because the exact key
// already exists; finalization then verifies that existing object. No other
// non-2xx storage response is success.
export function mediaPutStatusAccepted(status) {
  const value = Number(status);
  return (value >= 200 && value < 300) || value === 412;
}
