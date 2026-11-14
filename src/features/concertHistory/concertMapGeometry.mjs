// Map projection consumes the prepared history model; it does not load country metadata.
const FRAMES = Object.freeze({
  World: { x: 0, y: 0, width: 360, height: 180 },
  "North America": { x: 5, y: 3, width: 135, height: 102 },
  "South America": { x: 95, y: 70, width: 58, height: 85 },
  Europe: { x: 153, y: 15, width: 77, height: 57 },
  Africa: { x: 155, y: 48, width: 83, height: 84 },
  Asia: { x: 200, y: 3, width: 170, height: 110 },
  Oceania: { x: 280, y: 64, width: 110, height: 90 },
  Antarctica: { x: 0, y: 146, width: 360, height: 34 },
});

export function concertHistoryFrame(model) {
  const single = model.countries.length === 1 ? model.countries[0].continent : null;
  const name = FRAMES[single] ? single : "World";
  return { name, ...FRAMES[name] };
}

export function concertMapViewport(frame, width, height, zoom = 1, center = null) {
  const ratio = Math.max(1, width) / Math.max(1, height);
  let mapWidth = frame.width, mapHeight = frame.height;
  if (mapWidth / mapHeight < ratio) mapWidth = mapHeight * ratio;
  else mapHeight = mapWidth / ratio;
  const scale = Math.max(1, Math.min(8, Number(zoom) || 1));
  const cx = scale > 1 && center ? center.lng + 180 : frame.x + frame.width / 2;
  const cy = scale > 1 && center ? 90 - center.lat : frame.y + frame.height / 2;
  return { x: cx - mapWidth / scale / 2, y: cy - mapHeight / scale / 2, width: mapWidth / scale, height: mapHeight / scale };
}

export function projectConcertPin(coordinates, viewport) {
  if (!coordinates) return null;
  const rawX = coordinates.lng + 180, center = viewport.x + viewport.width / 2;
  const x = rawX + Math.round((center - rawX) / 360) * 360;
  const xPct = (x - viewport.x) / viewport.width, yPct = (90 - coordinates.lat - viewport.y) / viewport.height;
  return { xPct, yPct, visible: xPct >= 0 && xPct <= 1 && yPct >= 0 && yPct <= 1 };
}

export function clusterConcertMapPins(venues, viewport, width, height) {
  const clusters = [];
  for (const venue of venues) {
    const point = projectConcertPin(venue.coordinates, viewport);
    if (!point?.visible) continue;
    const near = clusters.find((cluster) => Math.hypot((cluster.xPct - point.xPct) * width, (cluster.yPct - point.yPct) * height) < 40);
    if (near) near.venues.push(venue);
    else clusters.push({ key: venue.key, ...point, venues: [venue] });
  }
  return clusters;
}
