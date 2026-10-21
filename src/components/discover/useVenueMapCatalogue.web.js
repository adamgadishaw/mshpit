import { useEffect, useMemo, useState } from "react";
import { buildVenueMapCatalogue, venueMapCatalogueCities } from "../../domain/venueMapCatalogue.mjs";
import { loadVenueMapEvents, venueMapFeedResultState } from "../../lib/venueMapCatalogue.web.mjs";
import { loadVenueMapCatalogueAsset } from "../../lib/venueMapCatalogueAsset.web.mjs";

const ENABLED = process.env.EXPO_PUBLIC_WEB_MAP_RENDERER === "maplibre";
const EMPTY = Object.freeze([]);

export function useVenueMapCatalogue({ venueDirectoryIndex, tourDates }) {
  const [payload, setPayload] = useState(null);
  const [status, setStatus] = useState("loading");
  const [attempt, setAttempt] = useState(0);
  const [feed, setFeed] = useState({ remoteEvents: EMPTY, feedStatus: "loading", feedLoaded: 0, providerFetchedAt: null, feedRefreshing: false });
  const { remoteEvents, feedStatus, feedLoaded, providerFetchedAt, feedRefreshing } = feed;
  const [feedAttempt, setFeedAttempt] = useState(0);
  useEffect(() => {
    if (!ENABLED) return;
    const controller = new AbortController();
    let current = true;
    setStatus("loading");
    const timeout = setTimeout(() => controller.abort(), 12000);
    loadVenueMapCatalogueAsset({ signal: controller.signal })
      .then(value => {
        if (!Array.isArray(value?.venues)) throw new Error("venue-catalogue-invalid");
        if (current) { setPayload(value); setStatus("ready"); }
      })
      .catch(() => { if (current) setStatus("error"); })
      .finally(() => clearTimeout(timeout));
    return () => { current = false; clearTimeout(timeout); controller.abort(); };
  }, [attempt]);
  useEffect(() => {
    if (!ENABLED) return;
    const controller = new AbortController();
    let current = true;
    setFeed(previous => ({ ...previous, feedStatus: "loading", feedLoaded: 0, feedRefreshing: false }));
    loadVenueMapEvents({ signal: controller.signal, refresh: feedAttempt > 0,
      onRefresh: () => { if (current) setFeed(previous => ({ ...previous, feedRefreshing: true })); },
      onPage: value => { if (current) setFeed(previous => ({ ...previous, feedLoaded: value.loaded })); } })
      .then(value => { if (current) setFeed(previous => ({ ...venueMapFeedResultState(value, previous), feedRefreshing: false })); })
      .catch(() => { if (current) setFeed(previous => ({ ...previous, feedStatus: "error", feedRefreshing: false })); });
    return () => { current = false; controller.abort(); };
  }, [feedAttempt]);
  useEffect(() => {
    if (!providerFetchedAt) return;
    const delay = Date.parse(providerFetchedAt) + 3600000 - Date.now();
    const timeout = setTimeout(() => setFeed(previous => ({ ...previous, providerFetchedAt: null,
      feedStatus: ["error", "loading"].includes(previous.feedStatus) ? previous.feedStatus : "stale" })), Math.max(0, delay));
    return () => clearTimeout(timeout);
  }, [providerFetchedAt]);
  const sourceRows = payload?.venues || EMPTY;
  const rows = useMemo(() => ENABLED ? buildVenueMapCatalogue({ catalogueVenues: sourceRows, venueDirectoryIndex, tourDates: [...remoteEvents, ...tourDates] }) : EMPTY,
    [sourceRows, venueDirectoryIndex, tourDates, remoteEvents]);
  const cities = useMemo(() => ENABLED ? venueMapCatalogueCities(rows) : EMPTY, [rows]);
  return ENABLED ? { rows, cities, sourceRows, status, retry: () => setAttempt(value => value + 1), catalogueCount: sourceRows.length,
    providerEvents: remoteEvents, providerFetchedAt, feedStatus, feedLoaded, feedRefreshing, retryFeed: () => setFeedAttempt(value => value + 1) } : null;
}
