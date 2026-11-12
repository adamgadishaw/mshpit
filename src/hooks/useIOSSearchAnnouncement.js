const noop = () => {};
const silent = Object.freeze({ isCurrent: () => true, request: noop, update: noop });

// Android/web keep their existing live regions without native speech imports.
export default function useIOSSearchAnnouncement() { return silent; }
