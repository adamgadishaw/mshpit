import { createRoot } from "react-dom/client";
import ProfileImageCropDialog from "./ProfileImageCropDialog";
import { reportMediaPickerError } from "../lib/mediaUpload";

let active = null;

// The dialog has no store context: the initiating account owns its signal and
// upload callback. Load and mount it only after a photo is selected.
export function uploadWithProfileCrop(asset, purpose, { signal, upload }) {
  active?.();
  if (signal?.aborted) return Promise.resolve(null);
  return new Promise(resolve => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let finished = false;
    const finish = value => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener("abort", cancel);
      if (active === cancel) active = null;
      queueMicrotask(() => { root.unmount(); container.remove(); });
      resolve(value);
    };
    const cancel = () => finish(null);
    const root = createRoot(container, { onUncaughtError: error => {
      if (!signal?.aborted) reportMediaPickerError(error, "Opening the profile photo preview");
      finish(null);
    } });
    active = cancel;
    signal?.addEventListener("abort", cancel, { once: true });
    root.render(<ProfileImageCropDialog asset={asset} purpose={purpose} signal={signal} upload={upload} onFinish={finish} />);
  });
}
