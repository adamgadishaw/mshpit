// Admin email console: edit the app's own copy, compose and send broadcasts,
// and read the log of every message the platform attempted. Lives in its own
// file because AdminScreen is already long, and this is self-contained.
import { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ScrollView } from "react-native";
import { colors, mono, radius, space } from "../theme";
import { api } from "../lib/api";
import { emailTemplateEditable } from "../domain/emailTemplateAccess.mjs";
import Icon from "./Icon";

const SECTIONS = [
  { key: "templates", label: "Templates" },
  { key: "campaigns", label: "Broadcasts" },
  { key: "log", label: "Log" },
];

const REASON_COPY = {
  "missing-api-key": "RESEND_API_KEY is not set on the server.",
  "missing-from": "MAIL_FROM is not set on the server.",
  "invalid-from": "MAIL_FROM is set but is not a usable address.",
  "missing-api-key-and-from": "Neither RESEND_API_KEY nor MAIL_FROM is set.",
  "invalid-reply-to": "MAIL_REPLY_TO is set but is not a usable address; replies will not be routed there.",
  "sender-not-verified": "Resend rejected the sender. The domain is probably not verified.",
  "opted-out": "This person turned off announcements.",
  banned: "This account is banned.",
  "send-failed": "Resend rejected the request.",
  error: "The request to Resend did not complete.",
};

const TEMPLATE_LABELS = {
  error_alert: "Server error digest",
  owner_approval_requested: "Owner approval request",
  owner_approval_receipt: "Owner security receipt",
  site_health_digest: "Site health digest",
  verify_email: "Email confirmation",
  welcome: "Welcome",
  password_reset: "Password reset",
};

function timeAgo(ms) {
  if (!ms) return "never";
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function Field({ label, hint, ...props }) {
  const readOnly = props.editable === false;
  return (
    <View style={{ marginBottom: space(3) }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...props}
        placeholderTextColor={colors.textFaint}
        style={[styles.input, props.multiline && styles.inputTall, readOnly && styles.inputReadOnly, props.style]}
        accessibilityState={{ ...props.accessibilityState, disabled: readOnly }}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

function Btn({ label, onPress, tone = "default", disabled, busy }) {
  const toneStyle = tone === "primary" ? styles.btnPrimary : tone === "danger" ? styles.btnDanger : null;
  return (
    <Pressable
      onPress={disabled || busy ? undefined : onPress}
      style={[styles.btn, toneStyle, (disabled || busy) && styles.btnOff]}
    >
      <Text style={[styles.btnTxt, tone === "primary" && styles.btnTxtPrimary]}>{busy ? "Working…" : label}</Text>
    </Pressable>
  );
}

export default function EmailConsole() {
  const [section, setSection] = useState("templates");
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const refresh = useCallback(async () => {
    try { setOverview(await api("/api/admin/email/overview")); setError(null); }
    catch (e) { setError(e?.message || "Could not load the email console."); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const run = useCallback(async (fn, successMessage) => {
    setBusy(true); setNotice(null);
    try {
      const result = await fn();
      if (successMessage) setNotice({ ok: true, text: typeof successMessage === "function" ? successMessage(result) : successMessage });
      await refresh();
      return result;
    } catch (e) {
      setNotice({ ok: false, text: e?.message || "That did not work." });
      return null;
    } finally { setBusy(false); }
  }, [refresh]);

  if (error) return <Text style={styles.empty}>{error}</Text>;
  if (!overview) return <Text style={styles.empty}>Loading the email console…</Text>;

  const mail = overview.mail || {};
  const budget = overview.budget || {};

  return (
    // Width is capped by AdminScreen's `column`, which constrains the whole
    // console as one unit. Nesting a second cap here would make this tab
    // narrower than its own tab bar.
    <View>
      {/* Configuration state first: nothing else here works until this is green. */}
      <View style={[styles.statusCard, mail.configured ? styles.statusOk : styles.statusBad]}>
        <View style={styles.statusRow}>
          <Icon name={mail.configured ? "check" : "flag"} size={15} color={mail.configured ? colors.good : colors.danger} />
          <Text style={styles.statusTitle}>
            {mail.configured ? `Configured to send from ${mail.fromDomain}` : "Email is not configured, nothing can send"}
          </Text>
        </View>
        {!mail.configured && (
          <Text style={styles.statusBody}>
            {REASON_COPY[mail.reason] || mail.reason || "Mail is not configured."} See RESEND_SETUP.md.
          </Text>
        )}
        {mail.configured && (
          <Text style={styles.statusBody}>
            {mail.warning
              ? REASON_COPY[mail.warning]
              : mail.replyToValid
                ? `Replies route to the monitored ${mail.replyToDomain} inbox.`
                : "No reply inbox is configured. Set MAIL_REPLY_TO to the monitored Workspace address."}
          </Text>
        )}
        {overview.verification && (
          <Text style={styles.statusBody}>
            {overview.verification.enabled
              ? `New signups are asked to confirm their email. ${overview.verification.verified} confirmed, ${overview.verification.unverified} not yet.`
              : `Verification is SWITCHED OFF (EMAIL_VERIFICATION_ENABLED). New accounts are treated as confirmed. ${overview.verification.unverified} accounts were never confirmed.`}
          </Text>
        )}
        <Text style={styles.statusMeta}>
          {budget.sentToday ?? 0} of {budget.dailyLimit ?? 0} sent in the last 24h, {budget.remainingToday ?? 0} left.
          {"  "}Last 7 days: {overview.last7Days?.sent ?? 0} sent, {overview.last7Days?.failed ?? 0} failed, {overview.last7Days?.skipped ?? 0} skipped.
        </Text>
      </View>

      {notice ? (
        <Text style={[styles.notice, notice.ok ? styles.noticeOk : styles.noticeBad]}>{notice.text}</Text>
      ) : null}

      <View style={styles.segment}>
        {SECTIONS.map((s) => (
          <Pressable key={s.key} onPress={() => { setSection(s.key); setNotice(null); }} style={[styles.segBtn, section === s.key && styles.segOn]}>
            <Text style={[styles.segTxt, section === s.key && styles.segTxtOn]}>{s.label}</Text>
          </Pressable>
        ))}
      </View>

      {section === "templates" && <Templates overview={overview} run={run} busy={busy} />}
      {section === "campaigns" && <Campaigns overview={overview} run={run} busy={busy} />}
      {section === "log" && <LogView />}
    </View>
  );
}

function Templates({ overview, run, busy }) {
  const [openKey, setOpenKey] = useState(null);
  const [draft, setDraft] = useState(null);

  const open = async (key) => {
    if (openKey === key) { setOpenKey(null); setDraft(null); return; }
    const data = await api(`/api/admin/email/templates/${key}`);
    const summary = (overview.templates || []).find((template) => template.key === key);
    setOpenKey(key);
    setDraft({
      subject: data.template.subject, body: data.template.body,
      ctaLabel: data.template.cta_label || "", ctaUrl: data.template.cta_url || "",
      customized: data.template.customized,
      editable: emailTemplateEditable(summary, data.template),
    });
  };

  return (
    <View>
      <Text style={styles.sectionHint}>
        This is the mail Pit sends on its own. Security and account templates are code-owned and view-only here. Placeholders in {"{{curly braces}}"} get filled in per person:
        {" "}{(overview.tokens || []).map((t) => `{{${t}}}`).join(", ")}.
      </Text>
      {(overview.templates || []).map((t) => (
        <View key={t.key} style={styles.card}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: openKey === t.key }} style={styles.cardHead} onPress={() => open(t.key)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{TEMPLATE_LABELS[t.key] || t.key}</Text>
              <Text style={styles.cardSub}>{t.subject}</Text>
            </View>
            <Text style={[styles.tag, t.editable === false && styles.tagLocked]}>{t.editable === false ? "code-owned" : t.customized ? `edited ${timeAgo(t.updatedAt)}` : "default"}</Text>
          </Pressable>

          {openKey === t.key && draft && (
            <View style={styles.cardBody}>
              {!draft.editable ? <View style={styles.readOnlyNotice}><Icon name="lock" size={14} color={colors.gold} /><Text style={styles.readOnlyText}>This copy and its button destination protect an account or security boundary. Changes require reviewed source code and a deployment.</Text></View> : null}
              <Field label="Subject" value={draft.subject} editable={draft.editable && !busy} onChangeText={(v) => setDraft({ ...draft, subject: v })} />
              <Field label="Body" value={draft.body} editable={draft.editable && !busy} multiline onChangeText={(v) => setDraft({ ...draft, body: v })}
                hint="Plain text. Leave a blank line between paragraphs." />
              <Field label="Button label" value={draft.ctaLabel} editable={draft.editable && !busy} onChangeText={(v) => setDraft({ ...draft, ctaLabel: v })} />
              <Field label="Button link" value={draft.ctaUrl} editable={draft.editable && !busy} onChangeText={(v) => setDraft({ ...draft, ctaUrl: v })}
                hint="Must be http/https, or a placeholder like {{origin}}." />
              <View style={styles.btnRow}>
                {draft.editable ? <Btn label="Save" tone="primary" busy={busy} onPress={() => run(
                  () => api(`/api/admin/email/templates/${t.key}`, { method: "PUT", body: { subject: draft.subject, body: draft.body, ctaLabel: draft.ctaLabel, ctaUrl: draft.ctaUrl }, context: "Saving email copy" }),
                  "Saved.",
                )} /> : null}
                <Btn label="Send me a test" busy={busy} onPress={() => run(
                  () => api(`/api/admin/email/templates/${t.key}/test`, { method: "POST", context: "Sending a test email" }),
                  (r) => (r?.sent ? `Test sent to ${r.to}.` : `Not sent: ${REASON_COPY[r?.reason] || r?.reason}`),
                )} />
                {draft.editable && draft.customized && (
                  <Btn label="Restore default" tone="danger" busy={busy} onPress={() => run(
                    async () => { const r = await api(`/api/admin/email/templates/${t.key}`, { method: "DELETE", context: "Restoring default copy" }); setOpenKey(null); setDraft(null); return r; },
                    "Restored the built-in copy.",
                  )} />
                )}
              </View>
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

const EMPTY_CAMPAIGN = { name: "", subject: "", body: "", ctaLabel: "", ctaUrl: "", audience: "all" };

function Campaigns({ overview, run, busy }) {
  const [draft, setDraft] = useState(EMPTY_CAMPAIGN);
  const [composing, setComposing] = useState(false);
  const [confirmId, setConfirmId] = useState(null);

  const audiences = overview.audiences || [];
  const selected = useMemo(() => audiences.find((a) => a.key === draft.audience), [audiences, draft.audience]);

  return (
    <View>
      {!composing ? (
        <Btn label="New broadcast" tone="primary" onPress={() => { setComposing(true); setDraft(EMPTY_CAMPAIGN); }} />
      ) : (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>New broadcast</Text>
          <View style={styles.cardBody}>
            <Field label="Internal name" value={draft.name} onChangeText={(v) => setDraft({ ...draft, name: v })}
              hint="Only you see this." />
            <Field label="Subject" value={draft.subject} onChangeText={(v) => setDraft({ ...draft, subject: v })} />
            <Field label="Body" value={draft.body} multiline onChangeText={(v) => setDraft({ ...draft, body: v })} />
            <Field label="Button label" value={draft.ctaLabel} onChangeText={(v) => setDraft({ ...draft, ctaLabel: v })} />
            <Field label="Button link" value={draft.ctaUrl} onChangeText={(v) => setDraft({ ...draft, ctaUrl: v })} />
            <Text style={styles.label}>Who gets it</Text>
            <View style={styles.chipRow}>
              {audiences.map((a) => (
                <Pressable key={a.key} onPress={() => setDraft({ ...draft, audience: a.key })}
                  style={[styles.chip, draft.audience === a.key && styles.chipOn]}>
                  <Text style={[styles.chipTxt, draft.audience === a.key && styles.chipTxtOn]}>{a.label} ({a.size})</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.hint}>
              {selected ? `${selected.size} people will get this. ` : ""}
              Anyone who turned off announcements is already excluded.
            </Text>
            <View style={styles.btnRow}>
              <Btn label="Save draft" tone="primary" busy={busy} onPress={() => run(
                async () => { const r = await api("/api/admin/email/campaigns", { method: "POST", body: draft, context: "Creating a broadcast" }); setComposing(false); return r; },
                "Draft saved. Send yourself a test before it goes out.",
              )} />
              <Btn label="Cancel" onPress={() => setComposing(false)} />
            </View>
          </View>
        </View>
      )}

      {(overview.campaigns || []).map((c) => {
        const done = c.sent_count + c.failed_count + c.skipped_count;
        return (
          <View key={c.id} style={styles.card}>
            <View style={styles.cardHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{c.name}</Text>
                <Text style={styles.cardSub}>{c.subject}</Text>
              </View>
              <Text style={[styles.tag, c.status === "sent" && styles.tagOk, c.status === "paused" && styles.tagWarn]}>{c.status}</Text>
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.meta}>
                Audience: {c.audience}. {c.total ? `${done} of ${c.total} processed. ` : ""}
                {c.sent_count} sent, {c.failed_count} failed, {c.skipped_count} skipped.
              </Text>
              <Text style={styles.meta}>
                {c.test_sent_at ? `Test sent ${timeAgo(c.test_sent_at)}.` : "No test sent yet."}
              </Text>
              <View style={styles.btnRow}>
                {c.status !== "sent" && (
                  <Btn label="Send me a test" busy={busy} onPress={() => run(
                    () => api(`/api/admin/email/campaigns/${c.id}/test`, { method: "POST", context: "Sending a test email" }),
                    (r) => (r?.sent ? `Test sent to ${r.to}.` : `Not sent: ${REASON_COPY[r?.reason] || r?.reason}`),
                  )} />
                )}
                {c.status === "draft" && c.test_sent_at && confirmId !== c.id && (
                  <Btn label="Send to everyone" tone="danger" onPress={() => setConfirmId(c.id)} />
                )}
                {c.status === "draft" && confirmId === c.id && (
                  <>
                    <Btn label={`Yes, email ${audiences.find((a) => a.key === c.audience)?.size ?? 0} people`} tone="danger" busy={busy}
                      onPress={() => run(
                        async () => { const r = await api(`/api/admin/email/campaigns/${c.id}/send`, { method: "POST", body: { confirm: true }, context: "Sending a broadcast" }); setConfirmId(null); return r; },
                        (r) => `Sent ${r?.drained?.sent ?? 0}. ${r?.drained?.remainingInQueue ? `${r.drained.remainingInQueue} still queued.` : "Queue empty."}`,
                      )} />
                    <Btn label="Cancel" onPress={() => setConfirmId(null)} />
                  </>
                )}
                {(c.status === "sending" || c.status === "paused") && (
                  <Btn label="Send next batch" tone="primary" busy={busy} onPress={() => run(
                    () => api(`/api/admin/email/campaigns/${c.id}/resume`, { method: "POST", body: {}, context: "Resuming a broadcast" }),
                    (r) => `Sent ${r?.drained?.sent ?? 0}. ${r?.drained?.remainingInQueue ?? 0} still queued.`,
                  )} />
                )}
                {c.status === "sending" && (
                  <Btn label="Pause" busy={busy} onPress={() => run(
                    () => api(`/api/admin/email/campaigns/${c.id}/pause`, { method: "POST", body: {}, context: "Pausing a broadcast" }),
                    "Paused.",
                  )} />
                )}
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function LogView() {
  const [entries, setEntries] = useState(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let live = true;
    api(`/api/admin/email/log?limit=100${filter ? `&status=${filter}` : ""}`)
      .then((d) => { if (live) setEntries(d.entries || []); })
      .catch(() => { if (live) setEntries([]); });
    return () => { live = false; };
  }, [filter]);

  return (
    <View>
      <View style={styles.chipRow}>
        {[["", "Everything"], ["sent", "Sent"], ["failed", "Failed"], ["skipped", "Not sent"]].map(([key, label]) => (
          <Pressable key={key || "all"} onPress={() => setFilter(key)} style={[styles.chip, filter === key && styles.chipOn]}>
            <Text style={[styles.chipTxt, filter === key && styles.chipTxtOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {!entries ? <Text style={styles.empty}>Loading…</Text> : entries.length === 0 ? (
        <Text style={styles.empty}>Nothing here yet.</Text>
      ) : (
        <ScrollView style={styles.logBox} nestedScrollEnabled>
          {entries.map((e) => (
            <View key={e.id} style={styles.logRow}>
              <Text style={[styles.logStatus, e.status === "sent" ? styles.logOk : e.status === "failed" ? styles.logBad : styles.logWarn]}>
                {e.status}
              </Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.logSubject} numberOfLines={1}>{e.subject}</Text>
                <Text style={styles.logMeta} numberOfLines={1}>
                  {e.to_email} · {e.kind}{e.template_key ? ` · ${e.template_key}` : ""} · {timeAgo(e.created_at)}
                  {e.reason ? ` · ${REASON_COPY[e.reason] || e.reason}` : ""}
                </Text>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { color: colors.textDim, fontSize: 13, padding: space(4), textAlign: "center" },
  sectionHint: { color: colors.textDim, fontSize: 12, marginBottom: space(3), lineHeight: 17 },
  statusCard: { borderWidth: 1, borderRadius: radius.md, padding: space(3), marginBottom: space(3) },
  statusOk: { borderColor: colors.good, backgroundColor: colors.surface },
  statusBad: { borderColor: colors.danger, backgroundColor: colors.surface },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusTitle: { color: colors.text, fontWeight: "700", fontSize: 13, flex: 1 },
  statusBody: { color: colors.textDim, fontSize: 12, marginTop: 4, lineHeight: 17 },
  statusMeta: { color: colors.textFaint, fontSize: 11, marginTop: 6, fontFamily: mono, lineHeight: 16 },
  notice: { fontSize: 12, padding: space(3), borderRadius: radius.sm, marginBottom: space(3), overflow: "hidden" },
  noticeOk: { color: colors.good, backgroundColor: colors.surfaceAlt },
  noticeBad: { color: colors.danger, backgroundColor: colors.surfaceAlt },
  segment: { flexDirection: "row", gap: 6, marginBottom: space(3) },
  segBtn: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: colors.line },
  segOn: { backgroundColor: colors.amberStrong, borderColor: colors.amberStrong },
  segTxt: { color: colors.textDim, fontSize: 12, fontWeight: "600" },
  segTxtOn: { color: "#1A1206" },
  card: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, marginBottom: space(3), backgroundColor: colors.surface },
  cardHead: { flexDirection: "row", alignItems: "center", padding: space(3), gap: 8 },
  cardTitle: { color: colors.text, fontWeight: "700", fontSize: 13 },
  cardSub: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  cardBody: { padding: space(3), borderTopWidth: 1, borderTopColor: colors.lineSoft },
  // Matches AdminScreen's roleTag so a status here reads as the same kind of
  // badge it does on the Members tab, rather than as stray uppercase text.
  tag: { color: colors.textFaint, fontSize: 10, fontFamily: mono, textTransform: "uppercase", borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden" },
  tagOk: { color: colors.good, borderColor: colors.good },
  tagWarn: { color: colors.gold, borderColor: colors.gold },
  tagLocked: { color: colors.gold, borderColor: colors.gold },
  meta: { color: colors.textDim, fontSize: 12, marginBottom: 4 },
  label: { color: colors.textDim, fontSize: 11, fontWeight: "700", marginBottom: 4, textTransform: "uppercase" },
  hint: { color: colors.textFaint, fontSize: 11, marginTop: 4, lineHeight: 15 },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, color: colors.text, padding: 10, fontSize: 13, backgroundColor: colors.bgElev },
  inputReadOnly: { color: colors.textDim, backgroundColor: colors.surface, opacity: 0.82 },
  inputTall: { minHeight: 120, textAlignVertical: "top" },
  readOnlyNotice: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderWidth: 1, borderColor: colors.gold + "66", borderRadius: radius.sm, backgroundColor: colors.gold + "0D", padding: space(3), marginBottom: space(3) },
  readOnlyText: { flex: 1, color: colors.gold, fontSize: 11, lineHeight: 17, fontWeight: "700" },
  btnRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: space(3) },
  btn: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: colors.line },
  btnPrimary: { backgroundColor: colors.amberStrong, borderColor: colors.amberStrong },
  btnDanger: { borderColor: colors.danger },
  btnOff: { opacity: 0.5 },
  btnTxt: { color: colors.text, fontSize: 12, fontWeight: "700" },
  btnTxtPrimary: { color: "#1A1206" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: space(3) },
  chip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: colors.line },
  chipOn: { backgroundColor: colors.surfaceAlt, borderColor: colors.amberStrong },
  chipTxt: { color: colors.textDim, fontSize: 11 },
  chipTxtOn: { color: colors.text, fontWeight: "700" },
  logBox: { maxHeight: 420 },
  logRow: { flexDirection: "row", gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  logStatus: { fontSize: 10, fontFamily: mono, width: 52, textTransform: "uppercase" },
  logOk: { color: colors.good },
  logBad: { color: colors.danger },
  logWarn: { color: colors.gold },
  logSubject: { color: colors.text, fontSize: 12 },
  logMeta: { color: colors.textFaint, fontSize: 11, marginTop: 1 },
});
