const silent = Object.freeze({ begin: () => null, finish: () => {} });

// Android and web retain their existing refresh behavior without native speech.
export default function useIOSThreadRefreshAnnouncement() { return silent; }
