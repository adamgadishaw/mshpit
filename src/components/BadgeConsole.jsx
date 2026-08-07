// Admin badge maker: create tiers and event badges, edit their art, retire them.
// Granting to a person lives on the Members tab, next to the other per-account
// actions, so this screen stays about the badges themselves.
import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput } from "react-native";
import { colors, radius, space } from "../theme";
import { BADGE_COLORS, BADGE_GLYPHS, BADGE_KINDS } from "../domain/badgeArt.mjs";
import { api } from "../lib/api";
import Badge from "./Badge";

const EMPTY = { slug: "", label: "", description: "", kind: "tier", color: "gold", glyph: "char", glyphChar: "V" };

function Field({ label, hint, ...props }) {
  return (
    <View style={{ marginBottom: space(3) }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={styles.input} placeholderTextColor={colors.textFaint} {...props} />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

function Btn({ label, onPress, tone, busy }) {
  return (
    <Pressable style={[styles.btn, tone === "primary" && styles.btnPrimary, tone === "danger" && styles.btnDanger, busy && styles.btnOff]}
      disabled={busy} onPress={onPress}>
      <Text style={[styles.btnTxt, tone === "primary" && styles.btnTxtPrimary]}>{label}</Text>
    </Pressable>
  );
}

// Chooser rows render a live seal rather than a colour swatch, so what you pick
// is what the badge will actually look like.
function Chooser({ label, options, value, onPick, preview }) {
  return (
    <View style={{ marginBottom: space(3) }}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.chipRow}>
        {options.map(([key, text]) => (
          <Pressable key={key} onPress={() => onPick(key)} style={[styles.chip, value === key && styles.chipOn]}>
            {preview ? preview(key) : null}
            <Text style={[styles.chipTxt, value === key && styles.chipTxtOn]}>{text}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function BadgeConsole() {
  const [badges, setBadges] = useState([]);
  const [draft, setDraft] = useState(null);
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api("/api/admin/badges");
      setBadges(r.badges || []);
    } catch { setNotice({ ok: false, text: "Couldn't load badges." }); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (fn, okText) => {
    setBusy(true);
    try {
      await fn();
      setNotice({ ok: true, text: okText });
      await load();
    } catch (e) {
      setNotice({ ok: false, text: e?.message || "That didn't work." });
    } finally { setBusy(false); }
  };

  const form = draft || editing;
  const setForm = draft ? setDraft : setEditing;

  return (
    <View>
      <Text style={styles.sectionHint}>
        Badges you make here are separate from the built-in ones. They never grant the
        Verified check. Retiring a badge hides it from the grant list but leaves it on
        everyone who already has it.
      </Text>

      {notice ? (
        <Text style={[styles.notice, notice.ok ? styles.noticeOk : styles.noticeBad]}>{notice.text}</Text>
      ) : null}

      {!form && <Btn label="New badge" tone="primary" onPress={() => { setDraft(EMPTY); setNotice(null); }} />}

      {form && (
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Badge badge={form} size={22} tooltip={false} />
            <Text style={styles.cardTitle}>{draft ? "New badge" : `Editing ${form.slug}`}</Text>
          </View>
          <View style={styles.cardBody}>
            {draft && (
              <Field label="Slug" value={form.slug} autoCapitalize="none"
                onChangeText={(v) => setForm({ ...form, slug: v.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
                placeholder="vip-2026"
                hint="Permanent identity for this badge. Can't be changed later, because renaming it would rename it for everyone holding it." />
            )}
            <Field label="Label" value={form.label} onChangeText={(v) => setForm({ ...form, label: v })} placeholder="VIP" />
            <Field label="Description" value={form.description} multiline
              onChangeText={(v) => setForm({ ...form, description: v })}
              hint="Shown in the tooltip when someone hovers the badge." />

            <Chooser label="Kind" value={form.kind} onPick={(k) => setForm({ ...form, kind: k })}
              options={Object.entries(BADGE_KINDS)} />
            <Chooser label="Colour" value={form.color} onPick={(c) => setForm({ ...form, color: c })}
              options={Object.entries(BADGE_COLORS).map(([k, v]) => [k, v.label])}
              preview={(k) => <Badge badge={{ ...form, color: k }} size={16} tooltip={false} />} />
            <Chooser label="Glyph" value={form.glyph} onPick={(g) => setForm({ ...form, glyph: g })}
              options={Object.entries(BADGE_GLYPHS)}
              preview={(k) => <Badge badge={{ ...form, glyph: k }} size={16} tooltip={false} />} />
            {form.glyph === "char" && (
              <Field label="Character" value={form.glyphChar} maxLength={1}
                onChangeText={(v) => setForm({ ...form, glyphChar: v.toUpperCase() })}
                hint="One letter or number." />
            )}

            <View style={styles.btnRow}>
              <Btn label={draft ? "Create" : "Save"} tone="primary" busy={busy} onPress={() => run(async () => {
                if (draft) await api("/api/admin/badges", { method: "POST", body: form, context: "Creating a badge" });
                else await api(`/api/admin/badges/${form.id}`, { method: "PUT", body: form, context: "Saving a badge" });
                setDraft(null); setEditing(null);
              }, draft ? "Badge created." : "Saved.")} />
              <Btn label="Cancel" onPress={() => { setDraft(null); setEditing(null); setNotice(null); }} />
            </View>
          </View>
        </View>
      )}

      {badges.map((b) => (
        <View key={b.id} style={[styles.card, b.archived && styles.cardOff]}>
          <View style={styles.cardHead}>
            <Badge badge={b} size={22} tooltip={false} />
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{b.label}</Text>
              <Text style={styles.cardSub}>
                {b.slug} · {BADGE_KINDS[b.kind] || b.kind} · {b.holders} {b.holders === 1 ? "holder" : "holders"}
                {b.archived ? " · retired" : ""}
              </Text>
            </View>
          </View>
          <View style={styles.cardBody}>
            {b.description ? <Text style={styles.meta}>{b.description}</Text> : null}
            <View style={styles.btnRow}>
              <Btn label="Edit" busy={busy} onPress={() => { setEditing({ ...b, glyphChar: b.glyphChar || "V" }); setDraft(null); setNotice(null); }} />
              <Btn label={b.archived ? "Restore" : "Retire"} tone={b.archived ? undefined : "danger"} busy={busy}
                onPress={() => run(
                  () => api(`/api/admin/badges/${b.id}/archive`, { method: "POST", body: { archived: !b.archived }, context: "Updating a badge" }),
                  b.archived ? "Restored." : "Retired. Everyone holding it keeps it.",
                )} />
            </View>
          </View>
        </View>
      ))}

      {badges.length === 0 && !form && <Text style={styles.empty}>No badges yet.</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { color: colors.textDim, fontSize: 13, padding: space(4), textAlign: "center" },
  sectionHint: { color: colors.textDim, fontSize: 12, marginBottom: space(3), lineHeight: 17 },
  notice: { fontSize: 12, padding: space(3), borderRadius: radius.sm, marginBottom: space(3), overflow: "hidden" },
  noticeOk: { color: colors.good, backgroundColor: colors.surfaceAlt },
  noticeBad: { color: colors.danger, backgroundColor: colors.surfaceAlt },
  card: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, marginBottom: space(3), backgroundColor: colors.surface },
  cardOff: { opacity: 0.6 },
  cardHead: { flexDirection: "row", alignItems: "center", padding: space(3), gap: 9 },
  cardTitle: { color: colors.text, fontWeight: "700", fontSize: 13 },
  cardSub: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  cardBody: { padding: space(3), borderTopWidth: 1, borderTopColor: colors.lineSoft },
  meta: { color: colors.textDim, fontSize: 12, marginBottom: 4 },
  label: { color: colors.textDim, fontSize: 11, fontWeight: "700", marginBottom: 4, textTransform: "uppercase" },
  hint: { color: colors.textFaint, fontSize: 11, marginTop: 4, lineHeight: 15 },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, color: colors.text, padding: 10, fontSize: 13, backgroundColor: colors.bgElev },
  btnRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: space(3) },
  btn: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: colors.line },
  btnPrimary: { backgroundColor: colors.amberStrong, borderColor: colors.amberStrong },
  btnDanger: { borderColor: colors.danger },
  btnOff: { opacity: 0.5 },
  btnTxt: { color: colors.text, fontSize: 12, fontWeight: "700" },
  btnTxtPrimary: { color: "#1A1206" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: colors.line },
  chipOn: { backgroundColor: colors.surfaceAlt, borderColor: colors.amberStrong },
  chipTxt: { color: colors.textDim, fontSize: 11 },
  chipTxtOn: { color: colors.text, fontWeight: "700" },
});
