import { useState, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { colors, mono, radius } from "../theme";
import { useStore } from "../store";
import { api } from "../lib/api";
import Icon from "../components/Icon";
import SheetHeader from "../components/SheetHeader";

// Audience & ads: the activity data we collect (see Privacy policy) surfaced for
// the operator — top artists/venues/searches are the ad-interest signals you'd
// target campaigns against, plus raw volume and a live activity tail.
function AdInsights() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    api("/api/admin/analytics").then(setData).catch(() => setErr(true));
  }, []);

  if (err) return null;
  if (!data) return <Text style={styles.empty}>Loading audience data…</Text>;

  const t = data.totals || {};
  const Stat = ({ n, label }) => (
    <View style={styles.stat}><Text style={styles.statN}>{n ?? 0}</Text><Text style={styles.statL}>{label}</Text></View>
  );
  const List = ({ title, rows }) =>
    rows && rows.length ? (
      <View style={styles.insightCol}>
        <Text style={styles.insightH}>{title}</Text>
        {rows.slice(0, 8).map((r, i) => (
          <View key={i} style={styles.insightRow}>
            <Text style={styles.insightLabel} numberOfLines={1}>{r.label}</Text>
            <Text style={styles.insightCount}>{r.count}</Text>
          </View>
        ))}
      </View>
    ) : null;

  return (
    <View>
      <View style={styles.statRow}>
        <Stat n={t.events} label="events" />
        <Stat n={t.events24h} label="last 24h" />
        <Stat n={t.knownUsers} label="tracked users" />
        <Stat n={t.guestHits} label="guest hits" />
      </View>
      <View style={styles.insightGrid}>
        <List title="TOP ARTISTS (AD INTEREST)" rows={data.topArtists} />
        <List title="TOP VENUES" rows={data.topVenues} />
        <List title="TOP SEARCHES" rows={data.topSearches} />
        <List title="EVENTS BY TYPE" rows={data.byName} />
      </View>
      {data.recent && data.recent.length > 0 && (
        <>
          <Text style={styles.insightH}>LIVE ACTIVITY</Text>
          {data.recent.slice(0, 12).map((e, i) => (
            <Text key={i} style={styles.activityLine} numberOfLines={1}>
              <Text style={styles.activityWho}>@{e.handle}</Text> {e.name}
              {e.props && Object.keys(e.props).length ? ` · ${Object.values(e.props).join(" ")}` : ""}
            </Text>
          ))}
        </>
      )}
    </View>
  );
}

export default function AdminScreen({ onClose }) {
  const { requests, users, feed, removedIds, reports, approveArtist, rejectArtist, removeContent, restoreContent, actionReport, dismissReport, suspendUser, banUser } = useStore();
  const pending = requests.filter((r) => r.status === "pending");
  const openReports = reports.filter((r) => r.status === "open");

  const userFor = (id) => users.find((u) => u.id === id);
  const logFor = (id) => feed.find((l) => l.id === id);

  return (
    <View style={styles.wrap}>
      <SheetHeader title="Admin" onBack={onClose} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.h1Row}>
          <Icon name="shield" size={22} color={colors.amber} />
          <Text style={styles.h1}>Admin</Text>
        </View>
        <Text style={styles.subtitle}>Report triage · verification · site upkeep. Content is public on post; reports drive removal.</Text>

        <Text style={styles.sectionLabel}>AUDIENCE &amp; ADS</Text>
        <AdInsights />

        <Text style={styles.sectionLabel}>REPORT QUEUE · {openReports.length}</Text>
        {openReports.length === 0 && <Text style={styles.empty}>No open reports.</Text>}
        {openReports.map((r) => {
          const log = logFor(r.targetId);
          const reporter = userFor(r.reporterId);
          return (
            <View key={r.id} style={styles.card}>
              <View style={styles.reasonRow}>
                <Icon name="flag" size={14} color={colors.danger} />
                <Text style={styles.reason}>{r.reason}</Text>
              </View>
              <Text style={styles.artist}>{log ? `${log.artist} - by ${log.user?.name}` : "content removed"}</Text>
              <Text style={styles.sub}>reported by {reporter ? `@${reporter.handle}` : "a user"}</Text>
              <View style={styles.actions}>
                <Pressable style={[styles.btn, styles.remove]} onPress={() => actionReport(r.id)}>
                  <Icon name="trash" size={15} color={colors.danger} />
                  <Text style={styles.rejectTxt}>Remove content</Text>
                </Pressable>
                <Pressable style={[styles.btn, styles.reject]} onPress={() => dismissReport(r.id)}>
                  <Icon name="check" size={15} color={colors.textDim} />
                  <Text style={styles.dismissTxt}>Dismiss</Text>
                </Pressable>
              </View>
              {log?.userId && (
                <View style={styles.actions}>
                  <Pressable style={[styles.btn, styles.suspend]} onPress={() => { suspendUser(log.userId, 7); dismissReport(r.id); }}>
                    <Icon name="clock" size={14} color={colors.gold} />
                    <Text style={[styles.dismissTxt, { color: colors.gold }]}>Suspend 7d</Text>
                  </Pressable>
                  <Pressable style={[styles.btn, styles.remove]} onPress={() => { banUser(log.userId); actionReport(r.id); }}>
                    <Icon name="x" size={14} color={colors.danger} />
                    <Text style={styles.rejectTxt}>Ban user</Text>
                  </Pressable>
                </View>
              )}
            </View>
          );
        })}

        <Text style={styles.sectionLabel}>ARTIST ACCOUNT REQUESTS · {pending.length}</Text>
        {pending.length === 0 && <Text style={styles.empty}>No pending requests.</Text>}
        {pending.map((r) => {
          const u = userFor(r.userId);
          return (
            <View key={r.id} style={styles.card}>
              <Text style={styles.artist}>{r.artistName}</Text>
              <Text style={styles.sub}>requested by {u ? `${u.name} (@${u.handle})` : "unknown"}</Text>
              {!!r.note && <Text style={styles.note}>"{r.note}"</Text>}
              <View style={styles.actions}>
                <Pressable style={[styles.btn, styles.approve]} onPress={() => approveArtist(r.id)}>
                  <Icon name="check" size={15} color="#0C1A0F" />
                  <Text style={styles.approveTxt}>Approve</Text>
                </Pressable>
                <Pressable style={[styles.btn, styles.reject]} onPress={() => rejectArtist(r.id)}>
                  <Icon name="x" size={15} color={colors.danger} />
                  <Text style={styles.rejectTxt}>Reject</Text>
                </Pressable>
              </View>
            </View>
          );
        })}

        <Text style={styles.sectionLabel}>ALL CONTENT · {feed.length} LOGS</Text>
        <Text style={styles.policy}>Manual override for inappropriate, illegal, or copyright-infringing posts (most removals come through the report queue above). Removed posts are hidden from everyone but staff.</Text>
        {feed.map((l) => {
          const removed = removedIds.includes(l.id);
          return (
            <View key={l.id} style={[styles.card, removed && styles.removedCard]}>
              <View style={styles.contentRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.artist}>{l.artist}</Text>
                  <Text style={styles.sub}>by {l.user.name} · {l.venue}</Text>
                  {removed && <Text style={styles.removedTag}>REMOVED - hidden from public</Text>}
                </View>
                {removed ? (
                  <Pressable style={[styles.btn, styles.reject]} onPress={() => restoreContent(l.id)}>
                    <Text style={styles.rejectTxt}>Restore</Text>
                  </Pressable>
                ) : (
                  <Pressable style={[styles.btn, styles.remove]} onPress={() => removeContent(l.id)}>
                    <Icon name="trash" size={15} color={colors.danger} />
                    <Text style={styles.rejectTxt}>Remove</Text>
                  </Pressable>
                )}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 10 },
  backBtn: { flexDirection: "row", alignItems: "center", width: 56 },
  back: { color: colors.amber, fontSize: 15 },
  topTitle: { color: colors.textFaint, fontSize: 11, letterSpacing: 2, fontWeight: "700" },
  content: { padding: 16, paddingBottom: 48 },
  h1Row: { flexDirection: "row", alignItems: "center", gap: 10 },
  h1: { color: colors.text, fontSize: 26, fontWeight: "800" },
  subtitle: { color: colors.textDim, fontSize: 13, lineHeight: 19, marginTop: 8 },
  reasonRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  reason: { color: colors.danger, fontSize: 11, letterSpacing: 1, fontWeight: "700", textTransform: "uppercase" },
  dismissTxt: { color: colors.textDim, fontWeight: "700", fontSize: 13 },
  sectionLabel: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "700", marginTop: 24, marginBottom: 8 },
  policy: { color: colors.textDim, fontSize: 12, lineHeight: 18, marginBottom: 12, fontStyle: "italic" },
  empty: { color: colors.textDim, fontSize: 13, fontStyle: "italic" },
  // audience & ads panel
  statRow: { flexDirection: "row", gap: 8, marginBottom: 4 },
  stat: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, paddingVertical: 12, alignItems: "center" },
  statN: { color: colors.amber, fontFamily: mono, fontSize: 20, fontWeight: "800" },
  statL: { color: colors.textDim, fontSize: 10, letterSpacing: 0.5, marginTop: 2 },
  insightGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12 },
  insightCol: { flexGrow: 1, flexBasis: "46%", minWidth: 150, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 12 },
  insightH: { color: colors.textFaint, fontSize: 10, letterSpacing: 1, fontWeight: "800", marginTop: 14, marginBottom: 8 },
  insightRow: { flexDirection: "row", justifyContent: "space-between", gap: 8, paddingVertical: 3 },
  insightLabel: { color: colors.text, fontSize: 13, flex: 1 },
  insightCount: { color: colors.amber, fontFamily: mono, fontSize: 13, fontWeight: "700" },
  activityLine: { color: colors.textDim, fontSize: 12, fontFamily: mono, paddingVertical: 2 },
  activityWho: { color: colors.cool },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 14, marginBottom: 10 },
  removedCard: { borderColor: colors.danger, opacity: 0.8 },
  artist: { color: colors.text, fontSize: 16, fontWeight: "700" },
  sub: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  note: { color: colors.textDim, fontSize: 13, marginTop: 8, fontStyle: "italic" },
  removedTag: { color: colors.danger, fontFamily: mono, fontSize: 11, marginTop: 6, letterSpacing: 0.5 },
  contentRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  actions: { flexDirection: "row", gap: 10, marginTop: 12 },
  btn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill, borderWidth: 1 },
  approve: { backgroundColor: colors.good, borderColor: colors.good },
  approveTxt: { color: "#0C1A0F", fontWeight: "800", fontSize: 13 },
  reject: { backgroundColor: "transparent", borderColor: colors.line },
  rejectTxt: { color: colors.danger, fontWeight: "700", fontSize: 13 },
  remove: { backgroundColor: "transparent", borderColor: colors.line },
  suspend: { backgroundColor: "transparent", borderColor: colors.line },
});
