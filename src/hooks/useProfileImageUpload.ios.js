import { useCallback, useLayoutEffect, useRef, useState } from "react";
import ProfileImageCropDialog from "../components/ProfileImageCropDialog";

// One modal belongs to one editor/account-scoped operation. Closing, hiding or
// changing accounts cancels the picker and retires all upload callbacks.
export function useProfileImageUpload() {
  const active = useRef(null), live = useRef(false), serial = useRef(0);
  const [request, setRequest] = useState(null);
  useLayoutEffect(() => {
    live.current = true;
    return () => { live.current = false; active.current?.finish(null); };
  }, []);
  const uploadProfileImage = useCallback((asset, purpose, options) => {
    if (options.signal?.aborted || !live.current) return Promise.resolve(null);
    // The iOS system's square editor already handles avatars.
    if (purpose !== "banner") return options.upload(asset, { signal: options.signal });
    active.current?.finish(null);
    return new Promise(resolve => {
      const controller = new AbortController();
      const item = { key: ++serial.current, asset, purpose, upload: options.upload, signal: controller.signal, finished: false };
      const cancel = () => item.finish(null);
      item.finish = value => {
        if (item.finished) return;
        item.finished = true;
        controller.abort();
        options.signal?.removeEventListener("abort", cancel);
        if (active.current === item) {
          active.current = null;
          if (live.current) setRequest(null);
        }
        resolve(value);
      };
      options.signal?.addEventListener("abort", cancel, { once: true });
      active.current = item;
      setRequest(item);
    });
  }, []);
  return { uploadProfileImage, imageCropDialog: request ? <ProfileImageCropDialog key={request.key} request={request} /> : null };
}
