// Every venue enters the worker index. Only viewport features become buttons.
export function venueFeatureCollection(rows) {
  const groups = new Map();
  for (const row of rows) {
    const { lat, lng } = row.coord || {};
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 85 || Math.abs(lng) > 180) continue;
    const key = `${lng},${lat}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return { groups, data: { type: "FeatureCollection", features: [...groups].map(([key, members]) => ({
    type: "Feature", id: key, geometry: { type: "Point", coordinates: [members[0].coord.lng, members[0].coord.lat] },
    properties: { key, venueCount: members.length },
  })) } };
}
export function nextGroupVenue(members, selected) {
  return members[(members.findIndex(row => row.id === selected) + 1) % members.length]?.id;
}
export function viewportFeatureKey(feature) {
  return feature.properties?.cluster ? `cluster:${feature.properties.cluster_id}` : `venue:${feature.properties?.key}`;
}
