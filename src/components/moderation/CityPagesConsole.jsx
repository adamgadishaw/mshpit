import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, displayFont, focusRing, radius } from "../../theme";
import Button from "../Button";
import SmartImage from "../SmartImage";

function Field({ label, hint, value, onChangeText, multiline = false, disabled = false, limit = 8000 }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} value={String(value || "")} onChangeText={onChangeText} multiline={multiline} editable={!disabled} maxLength={limit} textAlignVertical={multiline ? "top" : "center"} autoCapitalize="sentences" style={[styles.input, multiline && styles.multiline]} placeholderTextColor={colors.textFaint} />{hint ? <Text style={styles.hint}>{hint}</Text> : null}</View>;
}
function Toggle({ label, value, onChange, disabled }) {
  return <Pressable disabled={disabled} accessibilityRole="checkbox" accessibilityState={{ checked: !!value, disabled }} onPress={() => onChange(!value)} style={styles.toggle}><View style={[styles.checkbox, value && styles.checked]} /><Text style={styles.body}>{label}</Text></Pressable>;
}
const readableKey = (value) => value.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
const copyLimit = key => key.endsWith("Url") ? 2000 : key.endsWith("SeoTitle") ? 80 : key.endsWith("SeoDescription") ? 200 : 1200;

export default function CityPagesConsole({ section, onSection, query, onQuery, cities, selected, onSelect, editorial, onEditorial, copy, onCopy, loading, error, notice, saving, dirty, onSave, onDiscard, onReload }) {
  const set = (key, value) => onEditorial({ ...editorial, [key]: value });
  const stock = editorial?.stockImage || {};
  const setStock = (key, value) => set("stockImage", { ...stock, [key]: value });
  const changeArray = (key, index, field, value) => set(key, (editorial[key] || []).map((row, at) => at === index ? { ...row, [field]: value } : row));
  return <View style={styles.wrap}>
    <Text style={styles.title} accessibilityRole="header">City pages</Text><Text style={styles.body}>Edit the city guide, its sources, photos, and welcome message. Saved wording also appears in search page previews.</Text>
    <View style={styles.actions}><Button small title="City content" variant={section === "city" ? "primary" : "secondary"} onPress={() => onSection("city")} disabled={saving} /><Button small title="Shared wording & welcome" variant={section === "copy" ? "primary" : "secondary"} onPress={() => onSection("copy")} disabled={saving} /></View>
    {error ? <View style={styles.alert}><Text accessibilityRole="alert" style={styles.error}>{error}</Text><Button title="Reload saved content" variant="secondary" small onPress={onReload} disabled={saving || dirty} /></View> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
    {section === "city" ? <>
      <Field label="Find a city" value={query} onChangeText={onQuery} limit={100} disabled={saving} />
      <View style={styles.results}>{cities.map((city) => <Pressable key={`${city.countryCode}:${city.citySlug}`} accessibilityRole="button" accessibilityState={{ selected: selected?.citySlug === city.citySlug && selected?.countryCode === city.countryCode }} disabled={saving} onPress={() => onSelect(city)} style={({ focused }) => [styles.city, focused && focusRing, selected?.citySlug === city.citySlug && selected?.countryCode === city.countryCode && styles.citySelected]}><Text style={styles.cityName}>{city.city}</Text><Text style={styles.hint}>{[city.region, city.country].filter(Boolean).join(", ")}</Text></Pressable>)}</View>
      {loading ? <ActivityIndicator color={colors.amber} /> : null}
      {selected && editorial ? <>
        <Text style={styles.subtitle}>{selected.city}</Text>
        <Field label="Page title" value={editorial.title} onChangeText={(value) => set("title", value)} disabled={saving} limit={160} />
        <Field label="Search title" value={editorial.seoTitle} onChangeText={(value) => set("seoTitle", value)} disabled={saving} limit={80} hint="The title offered to search engines. Leave blank to use the shared city search title." />
        <Field label="Search description" value={editorial.seoDescription} onChangeText={(value) => set("seoDescription", value)} disabled={saving} multiline limit={200} hint="A short, accurate summary for search previews. Leave blank to use the introduction. Search engines may choose different wording." />
        <Field label="Introduction" value={editorial.intro} onChangeText={(value) => set("intro", value)} disabled={saving} multiline limit={1200} />
        <Field label="Music history" value={editorial.history} onChangeText={(value) => set("history", value)} disabled={saving} multiline />
        <Field label="Musical influence" value={editorial.influence} onChangeText={(value) => set("influence", value)} disabled={saving} multiline />
        <Field label="Time zone" value={editorial.timeZone} onChangeText={(value) => set("timeZone", value)} disabled={saving} hint="For example, America/Toronto. Leave blank to use the shows' time zone." limit={100} />
        <Text style={styles.subtitle}>Sources</Text><Text style={styles.hint}>Link to sources for history, musical influence, and artist connections.</Text>
        {(editorial.sources || []).map((source, index) => <View key={index} style={styles.group}><Field label={`Source ${index + 1} title`} value={source.title} onChangeText={(value) => changeArray("sources", index, "title", value)} disabled={saving} limit={160} /><Field label="Source link" value={source.url} onChangeText={(value) => changeArray("sources", index, "url", value)} disabled={saving} limit={2000} /><Button small title="Remove source" variant="secondary" onPress={() => set("sources", editorial.sources.filter((_, at) => at !== index))} disabled={saving} /></View>)}
        <Button title="Add source" variant="secondary" small onPress={() => set("sources", [...(editorial.sources || []), { title: "", url: "" }])} disabled={saving || (editorial.sources?.length || 0) >= 20} />
        <Text style={styles.subtitle}>Artists connected to the city</Text>
        {(editorial.artists || []).map((artist, index) => <View key={index} style={styles.group}>{[["name", "Artist name", 120], ["artistKey", "Artist page key", 200], ["description", "Connection to the city", 600], ["sourceUrl", "Source link", 2000]].map(([key, label, limit]) => <Field key={key} label={label} value={artist[key]} onChangeText={(value) => changeArray("artists", index, key, value)} disabled={saving} multiline={key === "description"} limit={limit} />)}<Button small title="Remove artist" variant="secondary" onPress={() => set("artists", editorial.artists.filter((_, at) => at !== index))} disabled={saving} /></View>)}
        <Button title="Add artist" variant="secondary" small onPress={() => set("artists", [...(editorial.artists || []), { name: "", artistKey: "", description: "", sourceUrl: "" }])} disabled={saving || (editorial.artists?.length || 0) >= 20} />
        <Text style={styles.subtitle}>City photo</Text><Text style={styles.hint}>One city image follows public fan photos. Use a photo you own or a licensed photo with its credit and source.</Text>
        {stock.url ? <SmartImage uri={stock.url} style={styles.preview} contain={false} accessibilityLabel={stock.alt || selected.city} previewWidth={800} /> : null}
        {[["url", "Image URL"], ["alt", "Image description"], ["credit", "Photo credit"], ["sourceUrl", "Photo source link"], ["licenseUrl", "Photo license link"]].map(([key, label]) => <Field key={key} label={label} value={stock[key]} onChangeText={(value) => setStock(key, value)} disabled={saving} limit={key === "alt" || key === "credit" ? 300 : 2000} />)}
        <Toggle label="Mshpit owns this photo" value={stock.owned} onChange={(value) => setStock("owned", value)} disabled={saving} />
        <Button small title="Remove city photo" variant="secondary" onPress={() => set("stockImage", null)} disabled={saving || !editorial.stockImage} />
      </> : !loading ? <Text style={styles.hint}>Select a city to edit its page.</Text> : null}
    </> : <>
      <Text style={styles.subtitle}>Page labels and welcome card</Text><Text style={styles.hint}>Use {"{city}"} for the city name and {"{count}"} for a total. Changes apply to all city pages.</Text>
      {!copy && loading ? <ActivityIndicator color={colors.amber} /> : null}
      {Object.entries(copy || {}).map(([key, value]) => typeof value === "boolean" ? <Toggle key={key} label={readableKey(key)} value={value} onChange={(next) => onCopy({ ...copy, [key]: next })} disabled={saving} /> : <Field key={key} label={readableKey(key)} value={value} onChangeText={(next) => onCopy({ ...copy, [key]: next })} disabled={saving} multiline={key.endsWith("Body") || key.endsWith("Description")} limit={copyLimit(key)} />)}
    </>}
    {(section === "city" && editorial || section === "copy" && copy) ? <View style={styles.footer}><Text style={styles.hint}>{dirty ? "Unsaved changes" : "No unsaved changes"}</Text><View style={styles.actions}><Button title={section === "city" ? "Save city page" : "Save shared wording"} onPress={onSave} loading={saving} disabled={!dirty || loading} /><Button title="Discard changes" variant="secondary" onPress={onDiscard} disabled={!dirty || saving} /></View></View> : null}
  </View>;
}
const styles = StyleSheet.create({ wrap: { gap: 16, width: "100%", minWidth: 0 }, title: { fontFamily: displayFont, fontSize: 26, fontWeight: "800", color: colors.text }, subtitle: { fontFamily: displayFont, fontSize: 21, fontWeight: "800", color: colors.text, marginTop: 10 }, body: { color: colors.textDim, fontSize: 14, lineHeight: 22 }, hint: { color: colors.textFaint, fontSize: 12, lineHeight: 19 }, field: { gap: 7 }, label: { color: colors.text, fontSize: 13, fontWeight: "700" }, input: { color: colors.text, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, padding: 12, fontSize: 14, minHeight: 44, width: "100%" }, multiline: { minHeight: 140, lineHeight: 22 }, actions: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, results: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, city: { padding: 12, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, minWidth: 150, backgroundColor: colors.surface }, citySelected: { borderColor: colors.amber }, cityName: { color: colors.text, fontSize: 14, fontWeight: "800" }, group: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 15, gap: 12 }, preview: { width: "100%", maxWidth: 640, aspectRatio: 2, borderRadius: radius.md }, toggle: { flexDirection: "row", alignItems: "center", gap: 10 }, checkbox: { height: 22, width: 22, borderRadius: 5, borderWidth: 2, borderColor: colors.amber }, checked: { backgroundColor: colors.amber }, footer: { borderTopWidth: 1, borderColor: colors.line, paddingTop: 16, gap: 12 }, error: { color: colors.danger, lineHeight: 21 }, alert: { gap: 10 }, notice: { color: colors.amber, lineHeight: 21 } });
