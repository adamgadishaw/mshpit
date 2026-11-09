// Native retained-card ownership must not add lifecycle work on web/Android.
const ordinary = { current: () => true, guard: callback => callback, cardVisible: true, actionProps: {}, campaignImageProps: {} };
export default function useTicketPresentation() { return ordinary; }
