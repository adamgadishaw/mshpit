const noop = () => {};
const silent = Object.freeze({ begin: () => null, finish: noop, cancel: noop });

// Android/web retain their existing feedback without native speech imports.
export default function useIOSAuthErrorAnnouncement() { return silent; }
