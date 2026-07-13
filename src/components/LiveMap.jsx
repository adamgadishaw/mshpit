import { useEffect, useRef, useState } from "react";
import { View, Text, Image, StyleSheet, Platform } from "react-native";
import { colors, mono, radius, shadow } from "../theme";
import { GOOGLE_KEY } from "../mapConfig";
import { proxied, isHttp } from "../lib/img";
import Stars from "./Stars";

// A REAL, interactive Google map (pan / zoom / clickable pins), the "actual map
// embedded in the program." Renders on web when a Google key is present; on
// native (or without a key) callers fall back to the drawn/static map. Styled to
// match the stage-light theme but far cleaner than the static snapshot: subtle
// dark roads, muted warm highways, quiet labels, no garish amber grid.
const web = Platform.OS === "web" && typeof window !== "undefined";

// Cleaner, quieter dark theme. Highways are a muted tungsten (not neon amber),
// POIs are hushed so they don't fight the venue pins, water reads deep blue-black.
const DARK_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#0e1119" }] },
  // Labels: bright fill + a heavy near-black stroke/halo so city + neighborhood
  // names stay legible over the dark land and water (the old dim grey washed out).
  { elementType: "labels.text.fill", stylers: [{ color: "#c3cad8" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#05070c" }, { weight: 3 }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#152018" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1b2030" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#141926" }] },
  { featureType: "road", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#2a3145" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#3d3520" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#241d12" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0a1626" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#5b83a8" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#28303f" }] },
  // City/town names, the important ones, brightest of all.
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#eef1f6" }] },
  { featureType: "administrative.neighborhood", elementType: "labels.text.fill", stylers: [{ color: "#aab2c2" }] },
  { featureType: "administrative.land_parcel", stylers: [{ visibility: "off" }] },
];

// --- Custom pin art. Real teardrop map pins with a drop shadow, a glossy
// highlight and a white core, reads as a proper location marker instead of the
// flat MS-Paint circle that clashed with the polished map tiles.
function pinDataUri(color, { glow } = {}) {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='36' height='46' viewBox='0 0 36 46'>` +
    `<defs><filter id='s' x='-40%' y='-30%' width='180%' height='175%'>` +
    `<feDropShadow dx='0' dy='1.4' stdDeviation='1.6' flood-color='#05070c' flood-opacity='0.55'/></filter></defs>` +
    (glow ? `<circle cx='18' cy='17' r='16.5' fill='${color}' opacity='0.16'/>` : "") +
    `<path filter='url(#s)' d='M18 3C10.8 3 5 8.8 5 16c0 10 13 26 13 26s13-16 13-26C31 8.8 25.2 3 18 3z' fill='${color}' stroke='#0B0E16' stroke-width='1.6'/>` +
    `<ellipse cx='18' cy='11.5' rx='8' ry='5' fill='#ffffff' opacity='0.20'/>` +
    `<circle cx='18' cy='16' r='5' fill='#ffffff' opacity='0.95'/>` +
    `</svg>`;
  return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
}
function dotDataUri(color) {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20'>` +
    `<circle cx='10' cy='10' r='6' fill='${color}' stroke='#0B0E16' stroke-width='2'/>` +
    `<circle cx='10' cy='10' r='2.3' fill='#ffffff' opacity='0.85'/></svg>`;
  return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
}

// If the key isn't authorized for the Maps JS API, Google loads the script fine
// but calls gm_authFailure and paints a broken grey map. Trap that globally so
// every LiveMap can drop to the drawn/static fallback instead.
const AUTH_FAIL_EVENT = "pit-maps-authfail";
if (web && !window.__pitMapsAuthHook) {
  window.__pitMapsAuthHook = true;
  window.gm_authFailure = () => {
    window.__pitMapsAuthFailed = true;
    window.dispatchEvent(new Event(AUTH_FAIL_EVENT));
  };
}

// Load the Maps JS API exactly once, shared across every map on the page.
let mapsPromise = null;
function loadMaps() {
  if (!web) return Promise.reject(new Error("no-dom"));
  if (window.google && window.google.maps) return Promise.resolve(window.google.maps);
  if (mapsPromise) return mapsPromise;
  mapsPromise = new Promise((resolve, reject) => {
    const cb = "__pitMapsReady";
    window[cb] = () => resolve(window.google.maps);
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_KEY}&callback=${cb}&loading=async`;
    s.async = true;
    s.onerror = () => reject(new Error("maps-load-failed"));
    document.head.appendChild(s);
  });
  return mapsPromise;
}

// points: [{ name, lat, lng, kind?, photo?, sub?, rating?, reviews?, capacity? }]
// kind "spot" renders a small dot with no venue navigation (afterparty spots).
// highlight: the focal point (venue). Extra fields (photo/rating/sub) drive the
// hover card, Google-Maps-style, but themed dark.
export default function LiveMap({ points = [], highlight, focalName, label, onOpenVenue, onPressPoint, height, onFail }) {
  const hostRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const overlayRef = useRef(null);
  const projRef = useRef(null);
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState(null); // { x, y, point }

  const clean = points.filter((p) => p && p.lat != null && p.lng != null);
  const all = highlight && highlight.lat != null ? [...clean, { ...highlight, name: focalName, focal: true }] : clean;
  // A signature that changes when the plotted set changes, so we re-fit.
  const sig = all.map((p) => `${p.name}:${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join("|");

  // A bad-key / unauthorized-API failure can happen after the map inits, so also
  // listen for the global auth-failure signal and fall back when it fires.
  useEffect(() => {
    if (!web) return;
    if (window.__pitMapsAuthFailed) { setFailed(true); onFail && onFail(); return; }
    const h = () => { setFailed(true); onFail && onFail(); };
    window.addEventListener(AUTH_FAIL_EVENT, h);
    return () => window.removeEventListener(AUTH_FAIL_EVENT, h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!web || all.length === 0) return;
    let cancelled = false;
    loadMaps()
      .then((maps) => {
        if (cancelled || !hostRef.current) return;
        let map = mapRef.current;
        if (!map) {
          map = new maps.Map(hostRef.current, {
            styles: DARK_STYLE,
            disableDefaultUI: true,
            zoomControl: true,
            gestureHandling: "cooperative", // page keeps scrolling; ctrl/2-finger to zoom
            backgroundColor: "#0e1119",
            clickableIcons: false,
            maxZoom: 17,
          });
          mapRef.current = map;
          // A hidden overlay just to borrow its projection: it lets us convert a
          // marker's lat/lng into container pixels so the themed hover card can be
          // absolutely positioned right above the pin.
          const ov = new maps.OverlayView();
          ov.onAdd = () => {};
          ov.draw = function () { projRef.current = this.getProjection(); };
          ov.onRemove = () => {};
          ov.setMap(map);
          overlayRef.current = ov;
          // Any camera move invalidates a shown card's pixel position, hide it.
          map.addListener("bounds_changed", () => setHover(null));
        }

        // Reset markers.
        markersRef.current.forEach((m) => m.setMap(null));
        markersRef.current = [];

        const iconFor = (p) => {
          if (p.focal) return { url: pinDataUri(colors.amberStrong, { glow: true }), scaledSize: new maps.Size(46, 46), anchor: new maps.Point(23, 42) };
          if (p.kind === "spot") return { url: dotDataUri(colors.magenta || "#c65cff"), scaledSize: new maps.Size(18, 18), anchor: new maps.Point(9, 9) };
          return { url: pinDataUri(colors.cool), scaledSize: new maps.Size(36, 36), anchor: new maps.Point(18, 33) };
        };

        const showCard = (p, marker) => {
          const proj = projRef.current;
          if (!proj || !p.name || p.kind === "spot") return;
          const px = proj.fromLatLngToContainerPixel(marker.getPosition());
          if (px) setHover({ x: px.x, y: px.y, point: p });
        };

        const bounds = new maps.LatLngBounds();
        all.forEach((p) => {
          const marker = new maps.Marker({
            position: { lat: p.lat, lng: p.lng },
            map,
            title: p.name || "",
            icon: iconFor(p),
            optimized: false, // let the SVG data-URI render crisply
            zIndex: p.focal ? 3 : p.kind === "spot" ? 1 : 2,
          });
          marker.addListener("click", () => {
            if (onPressPoint) return onPressPoint(p);
            if (p.name && (p.focal || p.kind !== "spot")) onOpenVenue && onOpenVenue(p.name);
          });
          marker.addListener("mouseover", () => showCard(p, marker));
          marker.addListener("mouseout", () => setHover(null));
          markersRef.current.push(marker);
          bounds.extend({ lat: p.lat, lng: p.lng });
        });

        if (all.length === 1) {
          map.setCenter({ lat: all[0].lat, lng: all[0].lng });
          map.setZoom(14);
        } else {
          map.fitBounds(bounds, 44);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        onFail && onFail();
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  if (!web || failed) return null;

  return (
    <View style={[styles.wrap, height ? { aspectRatio: undefined, height } : null]}>
      {/* react-native-web forwards this ref to the underlying <div>, which the
          Maps API mounts into. */}
      <View ref={hostRef} style={StyleSheet.absoluteFill} />
      {label ? (
        <View style={[styles.labelPill, styles.noPointerEvents]}>
          <Text style={styles.labelTxt}>{label}</Text>
        </View>
      ) : null}
      {hover ? <HoverCard hover={hover} /> : null}
    </View>
  );
}

// A little floating place-card, positioned so its bottom tail sits just above the
// pin tip. Purely presentational (pointerEvents none) so it never eats a click.
function HoverCard({ hover }) {
  const { x, y, point: p } = hover;
  const photo = p.photo && isHttp(p.photo) ? proxied(p.photo, 320) : p.photo;
  const rating = typeof p.rating === "number" && p.rating > 0 ? p.rating : null;
  return (
    <View style={[styles.cardAnchor, { left: x, top: y }, styles.noPointerEvents]}>
      <View style={styles.card}>
        {photo ? (
          <Image source={{ uri: photo }} style={styles.cardPhoto} resizeMode="cover" />
        ) : (
          <View style={[styles.cardPhoto, styles.cardPhotoEmpty]} />
        )}
        <View style={styles.cardBody}>
          <Text style={styles.cardName} numberOfLines={1}>{p.name}</Text>
          {p.sub ? <Text style={styles.cardSub} numberOfLines={1}>{p.sub}{p.capacity ? ` · ${Number(p.capacity).toLocaleString()} cap` : ""}</Text> : null}
          {rating ? (
            <View style={styles.cardRating}>
              <Stars value={rating} size={12} gap={1.5} />
              <Text style={styles.cardScore}>{rating.toFixed(1)}</Text>
              {p.reviews ? <Text style={styles.cardMuted}>· {p.reviews} log{p.reviews === 1 ? "" : "s"}</Text> : null}
            </View>
          ) : (
            <Text style={styles.cardMuted}>No reviews yet</Text>
          )}
        </View>
      </View>
      <View style={styles.cardTail} />
    </View>
  );
}

const styles = StyleSheet.create({
  noPointerEvents: { pointerEvents: "none" },
  wrap: { width: "100%", aspectRatio: 320 / 206, borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: "#0e1119" },
  labelPill: { position: "absolute", left: 10, top: 10, backgroundColor: "rgba(7,9,15,0.72)", paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  labelTxt: { color: colors.text, fontFamily: mono, fontSize: 12, fontWeight: "800", letterSpacing: 0.5 },

  // Hover place-card. Anchored at the pin's container pixel; the card floats above
  // it (bottom edge ~46px over the tip) with a small pointer tail.
  cardAnchor: { position: "absolute", width: 0, height: 0 },
  card: { position: "absolute", left: -114, bottom: 44, width: 228, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.line, overflow: "hidden", ...shadow.sheet },
  cardPhoto: { width: "100%", height: 108, backgroundColor: colors.bgElev },
  cardPhotoEmpty: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  cardBody: { paddingHorizontal: 12, paddingTop: 9, paddingBottom: 11 },
  cardName: { color: colors.text, fontSize: 14.5, fontWeight: "800" },
  cardSub: { color: colors.textDim, fontSize: 11.5, marginTop: 2 },
  cardRating: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 7 },
  cardScore: { color: colors.gold, fontFamily: mono, fontSize: 12, fontWeight: "800" },
  cardMuted: { color: colors.textFaint, fontSize: 11, marginTop: 7 },
  cardTail: { position: "absolute", left: -7, bottom: 33, width: 14, height: 14, backgroundColor: colors.surface, borderRightWidth: 1, borderBottomWidth: 1, borderColor: colors.line, transform: [{ rotate: "45deg" }] },
});
