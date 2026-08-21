import { createMediaEditCapabilities } from "./mediaEditCapabilities.mjs";

export const mediaEditVideoCapabilities = createMediaEditCapabilities({ platform: "unsupported" });

export async function generateVideoCover() {
  throw new Error("PIT Studio does not have a video-cover renderer for this platform.");
}
