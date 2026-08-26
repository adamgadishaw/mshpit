export function artistPageEditReady(resource) {
  return resource?.updatedAt != null
    && !!resource?.data
    && typeof resource.data.profile === "object"
    && resource.data.profile !== null
    && !Array.isArray(resource.data.profile);
}
