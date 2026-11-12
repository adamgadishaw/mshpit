// Web and Android keep their existing Feed action and refresh lifetimes.
const current = () => true;
const INERT = Object.freeze({ current, currentRef: { current } });
export default function useFeedPresentation() { return INERT; }
