const current = () => true;
const ordinary = Object.freeze({ managed: false, active: true, preview: false,
  current, canAct: current, privacyCurrent: current, guard: callback => callback,
  token: null, commandToken: null, scope: null, privacyScope: null });
export default function useIOSDetailPresentation() { return ordinary; }
