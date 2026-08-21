import { createMediaEditCapabilities } from "./mediaEditCapabilities.mjs";

export const mediaEditImageCapabilities = createMediaEditCapabilities({ platform: "unsupported" });

export async function exportEditedImage() {
  throw new Error("PIT Studio does not have a photo renderer for this platform.");
}
