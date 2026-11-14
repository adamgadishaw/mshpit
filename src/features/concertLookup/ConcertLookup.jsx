import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { readConcertMatches } from "./concertLookupApi";
import { colors, radius } from "../../theme";
import { concertLookupDate, concertMatchCanFill, mergeConcertMatches } from "../../domain/concertLookup.mjs";

// Keep transport state here rather than in the authored draft. Choosing a row
// writes the same canonical artist/venue/date fields as existing show prefills.
export default function ConcertLookup({ artist, artistKey, city, date, accountId, venue, disabled = false, onSelect,
  readMatches = readConcertMatches }) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState(null);
  const query = { artist: artist.trim(), artistKey: artistKey || null, city: city.trim(), date };
  const key = JSON.stringify([accountId, query, attempt]);
  const latest = useRef(null);
  latest.current = { key, disabled };
  useEffect(() => {
    latest.current = { key, disabled };
    return () => { latest.current = null; };
  }, []);
  const ready = !!accountId && !!query.artist && !!query.city && !!concertLookupDate(date);
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && latest.current?.key === key;
    const timer = setTimeout(() => {
      setResult({ key, catalog: null, ticketmaster: null });
      for (const source of ["catalog", "ticketmaster"]) {
        Promise.resolve().then(() => current() ? readMatches(query, { source, accountId, signal: controller.signal }) : null)
          .then(value => {
            if (current()) setResult(previous => ({ ...previous, key, [source]: value }));
          }).catch(() => {
            if (current()) setResult(previous => ({ ...previous, key, [source]: { matches: [], status: "unavailable", complete: false } }));
          });
      }
    }, 650);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [key, ready, readMatches]);
  const visible = result?.key === key ? result : null;
  const rows = mergeConcertMatches(visible?.catalog?.matches || [], visible?.ticketmaster?.matches || []);
  const loading = ready && (!visible?.catalog || !visible?.ticketmaster);
  const failed = [visible?.catalog, visible?.ticketmaster].some(value => ["unavailable", "busy"].includes(value?.status));
  return <View style={styles.container}>
    <Text style={styles.title}>Find your concert</Text>
    <Text style={styles.note}>Choose an artist, city and date. Pick a match to fill the venue. You can also enter it below.</Text>
    {loading ? <Text style={styles.note} accessibilityLiveRegion="polite">Finding matching concerts…</Text> : null}
    {rows.map(row => <Pressable key={row.id} style={styles.row} disabled={disabled || !concertMatchCanFill(row)}
      accessibilityRole="button" accessibilityLabel={`Use concert: ${row.artist}, ${row.venue}, ${row.city}, ${row.date}${row.startLocalTime ? `, ${row.startLocalTime}` : ""}`}
      accessibilityState={{ disabled: disabled || !concertMatchCanFill(row), selected: row.venue === venue }}
      onPress={() => { if (latest.current?.key === key && !latest.current.disabled && concertMatchCanFill(row)) onSelect(row); }}>
      <Text style={styles.name}>{row.artist} · {row.venue}</Text>
      <Text style={styles.note}>{row.city} · {row.date}{row.startLocalTime?.includes("T") ? ` · ${row.startLocalTime.split("T")[1]}` : ""}</Text>
      {!!row.officialEventName && <Text style={styles.note}>{row.officialEventName}</Text>}
      <Text style={styles.source}>{row.source === "ticketmaster" ? "Ticketmaster" : row.source === "community" ? "Mshpit concert history" : "Mshpit concert catalog"}{row.venue === venue ? " · Selected" : ""}</Text>
      {!concertMatchCanFill(row) ? <Text style={styles.note}>This listing exceeds the location field limits. Enter a shorter venue or city below; nothing will be shortened automatically.</Text> : null}
    </Pressable>)}
    {ready && !loading && !rows.length ? <Text style={styles.note} accessibilityLiveRegion="polite">No matching concerts found. Add the venue below, or adjust the artist, city or date.</Text> : null}
    {failed ? <Text style={styles.note} accessibilityLiveRegion="polite">Some sources could not refresh. Available matches and your post are safe.</Text> : null}
    {ready && !loading && (failed || !rows.length) ? <Pressable accessibilityRole="button" accessibilityLabel="Retry concert lookup" onPress={() => setAttempt(value => value + 1)}><Text style={styles.source}>Try again</Text></Pressable> : null}
    {ready && !loading && !failed && [visible?.catalog, visible?.ticketmaster].some(value => value?.complete === false)
      ? <Text style={styles.note}>Showing a limited set of matches. Refine the city if yours is missing.</Text> : null}
    <Text style={styles.note}>Ticketmaster may not list older shows. Retained catalog and community history help fill the gaps.</Text>
  </View>;
}
const styles = StyleSheet.create({
  container: { gap: 8, marginVertical: 14, padding: 12, borderWidth: 1, borderColor: colors.lineSoft, borderRadius: radius.md },
  title: { color: colors.text, fontSize: 16, fontWeight: "700" },
  name: { color: colors.text, fontSize: 14, fontWeight: "600" },
  note: { color: colors.textDim, fontSize: 13 },
  source: { color: colors.amber, fontSize: 12 },
  row: { gap: 4, paddingVertical: 10, borderTopWidth: 1, borderColor: colors.lineSoft },
});
