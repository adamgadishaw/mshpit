const noop = () => {};
const silent = Object.freeze({ begin: () => null, finish: noop, cancel: noop, cancelValidation: noop });

// Android and web retain their existing feedback without native speech imports.
export default function useIOSCommentAnnouncement() { return silent; }
