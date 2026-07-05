import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { colors, mono, radius } from "../theme";
import { GOOGLE_KEY } from "../mapConfig";

// A REAL, interactive Google map (pan / zoom / clickable pins) — the "actual map
// embedded in the program." Renders on web when a Google key is present; on
// native (or without a key) callers fall back to the drawn/static map. Styled to
// match the stage-light theme but far cleaner than the static snapshot: subtle
// dark roads, muted warm highways, quiet labels — no garish amber grid.
const web = Platform.OS === "web" && typeof window !== "undefined";

// Cleaner, quieter dark theme. Highways are a muted tungsten (not neon amber),
// POIs are hushed so they don't fight the venue pins, water reads deep blue-black.
const DARK_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#0e1119" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#727a8c" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0b0e16" }] },
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
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#2a4a68" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#28303f" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#8891a5" }] },
  { featureType: "administrative.land_parcel", stylers: [{ visibility: "off" }] },
];

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

// points: [{ name, lat, lng, kind? }]  — kind "spot" renders a small dot with no
// venue navigation (afterparty spots). highlight: the focal point (venue).
export default function LiveMap({ points = [], highlight, focalName, label, onOpenVenue, onPressPoint, height, onFail }) {
  const hostRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const infoRef = useRef(null);
  const [failed, setFailed] = useState(false);

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
          infoRef.current = new maps.InfoWindow();
        }

        // Reset markers.
        markersRef.current.forEach((m) => m.setMap(null));
        markersRef.current = [];

        const dot = (color, r, ring = "#0B0E16") => ({
          path: maps.SymbolPath.CIRCLE,
          scale: r,
          fillColor: color,
          fillOpacity: 1,
          strokeColor: ring,
          strokeWeight: 2,
        });

        const bounds = new maps.LatLngBounds();
        all.forEach((p) => {
          const focal = !!p.focal;
          const spot = p.kind === "spot";
          const marker = new maps.Marker({
            position: { lat: p.lat, lng: p.lng },
            map,
            title: p.name || "",
            icon: focal ? dot(colors.amberStrong, 8) : spot ? dot(colors.magenta || "#c65cff", 5.5) : dot(colors.cool, 6),
            zIndex: focal ? 3 : spot ? 1 : 2,
          });
          marker.addListener("click", () => {
            if (onPressPoint) return onPressPoint(p);
            if (p.name && (focal || !spot)) onOpenVenue && onOpenVenue(p.name);
          });
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
        <View style={styles.labelPill} pointerEvents="none">
          <Text style={styles.labelTxt}>{label}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%", aspectRatio: 320 / 206, borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: "#0e1119" },
  labelPill: { position: "absolute", left: 10, top: 10, backgroundColor: "rgba(7,9,15,0.72)", paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  labelTxt: { color: colors.text, fontFamily: mono, fontSize: 12, fontWeight: "800", letterSpacing: 0.5 },
});
