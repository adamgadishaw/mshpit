import { useState, useEffect, useMemo } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput } from "react-native";
import { colors, mono, radius } from "../theme";
import { useStore, isStaff, isMod } from "../store";
import { api } from "../lib/api";
import Icon from "../components/Icon";
import Avatar from "../components/Avatar";
import SheetHeader from "../components/SheetHeader";
import Badge from "../components/Badge";

// Audience & ads: the activity data we collect (see Privacy policy) surfaced for
// the operator — top artists/venues/searches are the ad-interest signals you'd
// target campaigns against, plus raw volume and a live activity tail.
function AdInsights() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => { api("/api/admin/analytics").then(setData).catch(() => setErr(true)); }, []);

  if (err) return <Text style={styles.empty}>Audience data needs the backend running.</Text>;
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
        <Stat n={t.knownUsers} label="tracked" />
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

const ROLES = ["fan", "artist", "moderator", "admin"];
const roleColor = (r) => (r === "admin" ? colors.magenta : r === "moderator" ? colors.good : r === "artist" ? colors.amber : colors.textDim);

// A single member row with inline Discord-style moderation: role, timeout, ban.
function MemberRow({ u, self, status, canRole, onRole, onTimeout, onLift, onBan, onUnban, onVerify }) {
  const banned = status === "banned";
  const timed = status === "suspended";
  return (
    <View style={[styles.member, banned && styles.removedCard]}>
      <View style={styles.memberTop}>
        <Avatar user={u} size={38} />
        <View style={{ flex: 1 }}>
          <View style={styles.memberNameRow}>
            <Text style={styles.memberName} numberOfLines={1}>{u.name}</Text>
            {u.verified && <Badge type="verified" size={16} />}
            <View style={[styles.roleTag, { borderColor: roleColor(u.role) }]}>
              <Text style={[styles.roleTagTxt, { color: roleColor(u.role) }]}>{u.role}</Text>
            </View>
            {self && <Text style={styles.youTag}>you</Text>}
          </View>
          <Text style={styles.memberSub} numberOfLines={1}>
            @{u.handle}{u.home?.city ? ` · ${u.home.city}` : ""}
            {banned ? " · BANNED" : timed ? " · TIMED OUT" : ""}
          </Text>
        </View>
      </View>

      {/* role pills — admins only (Discord-style role administration) */}
      {canRole && (
        <View style={styles.pillRow}>
          <Text style={styles.pillLabel}>Role</Text>
          {ROLES.map((r) => (
            <Pressable
              key={r}
              style={[styles.rolePill, u.role === r && styles.rolePillOn, self && styles.pillDisabled]}
              onPress={() => !self && onRole(r)}
              disabled={self}
            >
              <Text style={[styles.rolePillTxt, u.role === r && { color: roleColor(r) }]}>{r}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* verification — admin-granted blue check, independent of role */}
      {canRole && (
        <View style={styles.pillRow}>
          <Text style={styles.pillLabel}>Verify</Text>
          <Pressable
            style={[styles.verifyBtn, u.verified && styles.verifyBtnOn]}
            onPress={() => onVerify(!u.verified)}
          >
            <Badge type="verified" size={15} />
            <Text style={[styles.verifyTxt, u.verified && styles.verifyTxtOn]}>{u.verified ? "Verified — tap to remove" : "Grant verification"}</Text>
          </Pressable>
        </View>
      )}

      {/* moderation actions */}
      {!self && (
        <View style={styles.pillRow}>
          <Text style={styles.pillLabel}>Mod</Text>
          {!banned && !timed && (
            <>
              <Pressable style={[styles.modBtn, styles.warn]} onPress={() => onTimeout(1)}><Icon name="clock" size={13} color={colors.gold} /><Text style={styles.warnTxt}>1d</Text></Pressable>
              <Pressable style={[styles.modBtn, styles.warn]} onPress={() => onTimeout(7)}><Icon name="clock" size={13} color={colors.gold} /><Text style={styles.warnTxt}>7d</Text></Pressable>
            </>
          )}
          {timed && (
            <Pressable style={[styles.modBtn, styles.ok]} onPress={onLift}><Icon name="check" size={13} color={colors.good} /><Text style={styles.okTxt}>Lift timeout</Text></Pressable>
          )}
          {banned ? (
            <Pressable style={[styles.modBtn, styles.ok]} onPress={onUnban}><Icon name="check" size={13} color={colors.good} /><Text style={styles.okTxt}>Unban</Text></Pressable>
          ) : (
            <Pressable style={[styles.modBtn, styles.danger]} onPress={onBan}><Icon name="x" size={13} color={colors.danger} /><Text style={styles.dangerTxt}>Ban</Text></Pressable>
          )}
        </View>
      )}
    </View>
  );
}

export default function AdminScreen({ onClose }) {
  const {
    requests, users, feed, removedIds, reports, session,
    comments, fanClubMsgs, lounge,
    approveArtist, rejectArtist, removeContent, restoreContent, actionReport, dismissReport,
    suspendUser, banUser, unbanUser, setUserRole, setVerified, accountStatus,
    removeComment, removeFanClubMessage, removeLoungeMessage,
    loadAdminMembers, adminStats,
  } = useStore();

  const iAmAdmin = isStaff(session?.role); // full access; mods get a subset
  const [tab, setTab] = useState(iAmAdmin ? "overview" : "reports");
  const [q, setQ] = useState("");

  // Pull EVERY signup (incl. banned) from the server so the console shows real
  // members — not just the seed + whoever happens to be cached locally.
  useEffect(() => { loadAdminMembers(); }, []);

  const pending = requests.filter((r) => r.status === "pending");
  const openReports = reports.filter((r) => r.status === "open");
  const userFor = (id) => users.find((u) => u.id === id);
  const logFor = (id) => feed.find((l) => l.id === id);
  const bannedCount = users.filter((u) => u.isBanned).length;

  const query = q.trim().toLowerCase();
  const members = useMemo(() => {
    const list = query
      ? users.filter((u) => u.name.toLowerCase().includes(query) || u.handle.toLowerCase().includes(query))
      : users;
    // Staff first, then flagged (banned/suspended), then everyone.
    const rank = (u) => (u.role === "admin" ? 0 : u.isBanned || u.suspendedUntil ? 1 : u.role === "artist" ? 2 : 3);
    return [...list].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [users, query]);

  const allComments = useMemo(() => Object.entries(comments).flatMap(([logId, arr]) => arr.map((c) => ({ logId, ...c }))), [comments]);
  const allFanMsgs = useMemo(() => Object.entries(fanClubMsgs).flatMap(([artist, arr]) => arr.map((m) => ({ artist, ...m }))), [fanClubMsgs]);
  const allLounge = useMemo(() => Object.entries(lounge).flatMap(([key, arr]) => arr.map((m) => ({ key, ...m }))), [lounge]);

  const TABS = [
    { key: "overview", label: "Overview", icon: "discover", admin: true },
    { key: "reports", label: "Reports", icon: "flag", badge: openReports.length },
    { key: "members", label: "Members", icon: "you", badge: bannedCount || undefined },
    { key: "content", label: "Content", icon: "feed" },
    { key: "requests", label: "Requests", icon: "shield", badge: pending.length, admin: true },
  ].filter((t) => iAmAdmin || !t.admin);

  if (!isMod(session?.role)) {
    return (
      <View style={styles.wrap}>
        <SheetHeader title="Moderation" onBack={onClose} />
        <Text style={[styles.empty, { padding: 20 }]}>You don't have access to moderation.</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <SheetHeader title="Moderation" onBack={onClose} />

      <View style={styles.h1Row}>
        <Icon name="shield" size={20} color={colors.amber} />
        <Text style={styles.h1}>Moderation console</Text>
        <View style={[styles.roleTag, { borderColor: roleColor(session?.role) }]}>
          <Text style={[styles.roleTagTxt, { color: roleColor(session?.role) }]}>{session?.role}</Text>
        </View>
      </View>

      {/* tab bar — a clean segmented control (no more stretched ovals) */}
      <View style={styles.tabbar}>
        {TABS.map((t) => (
          <Pressable key={t.key} style={[styles.tab, tab === t.key && styles.tabOn]} onPress={() => setTab(t.key)}>
            <Icon name={t.icon} size={15} color={tab === t.key ? "#1A1206" : colors.textDim} />
            <Text style={[styles.tabTxt, tab === t.key && styles.tabTxtOn]}>{t.label}</Text>
            {t.badge ? <View style={styles.tabBadge}><Text style={styles.tabBadgeTxt}>{t.badge}</Text></View> : null}
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* ---- OVERVIEW ---- */}
        {tab === "overview" && (
          <>
            <View style={styles.statRow}>
              <View style={styles.stat}><Text style={styles.statN}>{users.length}</Text><Text style={styles.statL}>members</Text></View>
              <View style={styles.stat}><Text style={styles.statN}>{feed.length}</Text><Text style={styles.statL}>posts</Text></View>
              <View style={styles.stat}><Text style={[styles.statN, openReports.length ? { color: colors.danger } : null]}>{openReports.length}</Text><Text style={styles.statL}>reports</Text></View>
              <View style={styles.stat}><Text style={[styles.statN, bannedCount ? { color: colors.danger } : null]}>{bannedCount}</Text><Text style={styles.statL}>banned</Text></View>
            </View>
            <Text style={styles.sectionLabel}>AUDIENCE &amp; ADS</Text>
            <AdInsights />
          </>
        )}

        {/* ---- REPORTS ---- */}
        {tab === "reports" && (
          <>
            <Text style={styles.policy}>Content is public on post; the community reports it and you act here. Removing hides it from everyone but staff.</Text>
            {openReports.length === 0 && <Text style={styles.empty}>No open reports. 🎉</Text>}
            {openReports.map((r) => {
              const log = logFor(r.targetId);
              const reporter = userFor(r.reporterId);
              return (
                <View key={r.id} style={styles.card}>
                  <View style={styles.reasonRow}>
                    <Icon name="flag" size={14} color={colors.danger} />
                    <Text style={styles.reason}>{r.reason || "reported"}</Text>
                  </View>
                  <Text style={styles.artist}>{log ? `${log.artist} — by ${log.user?.name}` : "content removed"}</Text>
                  <Text style={styles.sub}>reported by {reporter ? `@${reporter.handle}` : "a user"}</Text>
                  <View style={styles.actions}>
                    <Pressable style={[styles.btn, styles.remove]} onPress={() => actionReport(r.id)}>
                      <Icon name="trash" size={15} color={colors.danger} /><Text style={styles.rejectTxt}>Remove content</Text>
                    </Pressable>
                    <Pressable style={[styles.btn, styles.reject]} onPress={() => dismissReport(r.id)}>
                      <Icon name="check" size={15} color={colors.textDim} /><Text style={styles.dismissTxt}>Dismiss</Text>
                    </Pressable>
                  </View>
                  {log?.userId && log.userId !== session?.id && (
                    <View style={styles.actions}>
                      <Pressable style={[styles.btn, styles.suspend]} onPress={() => { suspendUser(log.userId, 7); dismissReport(r.id); }}>
                        <Icon name="clock" size={14} color={colors.gold} /><Text style={[styles.dismissTxt, { color: colors.gold }]}>Timeout 7d</Text>
                      </Pressable>
                      <Pressable style={[styles.btn, styles.remove]} onPress={() => { banUser(log.userId); actionReport(r.id); }}>
                        <Icon name="x" size={14} color={colors.danger} /><Text style={styles.rejectTxt}>Ban user</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              );
            })}
          </>
        )}

        {/* ---- MEMBERS ---- */}
        {tab === "members" && (
          <>
            <View style={styles.memberStats}>
              <View style={styles.mStat}><Text style={styles.mStatN}>{(adminStats.total || users.length).toLocaleString()}</Text><Text style={styles.mStatL}>members</Text></View>
              <View style={styles.mStatDiv} />
              <View style={styles.mStat}><Text style={[styles.mStatN, { color: colors.gold }]}>{adminStats.verified || users.filter((u) => u.verified).length}</Text><Text style={styles.mStatL}>verified</Text></View>
              <View style={styles.mStatDiv} />
              <View style={styles.mStat}><Text style={[styles.mStatN, { color: colors.danger }]}>{adminStats.banned || bannedCount}</Text><Text style={styles.mStatL}>banned</Text></View>
            </View>
            {adminStats.regions?.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.regionRow}>
                {adminStats.regions.map((r) => (
                  <View key={r.city} style={styles.regionChip}>
                    <Icon name="pin" size={11} color={colors.cool} />
                    <Text style={styles.regionCity} numberOfLines={1}>{r.city}</Text>
                    <Text style={styles.regionN}>{r.count}</Text>
                  </View>
                ))}
              </ScrollView>
            )}
            <View style={styles.search}>
              <Icon name="search" size={16} color={colors.textDim} />
              <TextInput
                style={styles.searchInput}
                placeholder={`Search ${(adminStats.total || users.length)} members…`}
                placeholderTextColor={colors.textFaint}
                value={q}
                onChangeText={setQ}
                autoCapitalize="none"
              />
            </View>
            {members.map((u) => (
              <MemberRow
                key={u.id}
                u={u}
                self={u.id === session?.id}
                status={accountStatus(u)}
                canRole={iAmAdmin}
                onRole={(r) => setUserRole(u.id, r)}
                onTimeout={(days) => suspendUser(u.id, days)}
                onLift={() => unbanUser(u.id)}
                onBan={() => banUser(u.id)}
                onUnban={() => unbanUser(u.id)}
                onVerify={(val) => setVerified(u.id, val)}
              />
            ))}
            {members.length === 0 && <Text style={styles.empty}>No members match “{q}”.</Text>}
          </>
        )}

        {/* ---- CONTENT ---- */}
        {tab === "content" && (
          <>
            <Text style={styles.sectionLabel}>POSTS · {feed.length}</Text>
            {feed.map((l) => {
              const removed = removedIds.includes(l.id);
              return (
                <View key={l.id} style={[styles.card, removed && styles.removedCard]}>
                  <View style={styles.contentRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.artist}>{l.artist}</Text>
                      <Text style={styles.sub}>by {l.user?.name || "a fan"} · {l.venue}</Text>
                      {removed && <Text style={styles.removedTag}>REMOVED — hidden from public</Text>}
                    </View>
                    {removed ? (
                      <Pressable style={[styles.btn, styles.reject]} onPress={() => restoreContent(l.id)}><Text style={styles.dismissTxt}>Restore</Text></Pressable>
                    ) : (
                      <Pressable style={[styles.btn, styles.remove]} onPress={() => removeContent(l.id)}><Icon name="trash" size={14} color={colors.danger} /><Text style={styles.rejectTxt}>Remove</Text></Pressable>
                    )}
                  </View>
                </View>
              );
            })}

            <Text style={styles.sectionLabel}>AFTERPARTY COMMENTS · {allComments.length}</Text>
            {allComments.length === 0 && <Text style={styles.empty}>No comments.</Text>}
            {allComments.map((c) => (
              <View key={c.id} style={styles.msgRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.msgWho}>{c.name}</Text>
                  <Text style={styles.msgTxt}>{c.text}</Text>
                </View>
                <Pressable style={styles.msgDel} onPress={() => removeComment(c.logId, c.id)} hitSlop={8}><Icon name="trash" size={14} color={colors.danger} /></Pressable>
              </View>
            ))}

            <Text style={styles.sectionLabel}>FAN CLUB MESSAGES · {allFanMsgs.length}</Text>
            {allFanMsgs.length === 0 && <Text style={styles.empty}>No messages.</Text>}
            {allFanMsgs.map((m) => (
              <View key={m.id} style={styles.msgRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.msgWho}>{m.name} <Text style={styles.msgWhere}>· {m.artist}</Text></Text>
                  <Text style={styles.msgTxt}>{m.text}</Text>
                </View>
                <Pressable style={styles.msgDel} onPress={() => removeFanClubMessage(m.artist, m.id)} hitSlop={8}><Icon name="trash" size={14} color={colors.danger} /></Pressable>
              </View>
            ))}

            <Text style={styles.sectionLabel}>CONCERT LOUNGE · {allLounge.length}</Text>
            {allLounge.length === 0 && <Text style={styles.empty}>No messages.</Text>}
            {allLounge.map((m) => (
              <View key={m.id} style={styles.msgRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.msgWho}>{m.name}</Text>
                  <Text style={styles.msgTxt}>{m.text}</Text>
                </View>
                <Pressable style={styles.msgDel} onPress={() => removeLoungeMessage(m.key, m.id)} hitSlop={8}><Icon name="trash" size={14} color={colors.danger} /></Pressable>
              </View>
            ))}
          </>
        )}

        {/* ---- REQUESTS ---- */}
        {tab === "requests" && (
          <>
            <Text style={styles.policy}>Fans requesting an official artist account. Approve to let them post tour dates for their artist.</Text>
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
                      <Icon name="check" size={15} color="#0C1A0F" /><Text style={styles.approveTxt}>Approve</Text>
                    </Pressable>
                    <Pressable style={[styles.btn, styles.reject]} onPress={() => rejectArtist(r.id)}>
                      <Icon name="x" size={15} color={colors.danger} /><Text style={styles.rejectTxt}>Reject</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  h1Row: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 6 },
  h1: { color: colors.text, fontSize: 20, fontWeight: "800" },
  tabbar: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  tab: { flexDirection: "row", alignItems: "center", gap: 7, height: 38, paddingHorizontal: 15, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  tabOn: { backgroundColor: colors.amberStrong, borderColor: colors.amberStrong },
  tabTxt: { color: colors.textDim, fontSize: 13, fontWeight: "700" },
  tabTxtOn: { color: "#1A1206" },
  tabBadge: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: colors.danger, alignItems: "center", justifyContent: "center" },
  tabBadgeTxt: { color: "#fff", fontSize: 10, fontWeight: "800" },
  content: { paddingHorizontal: 16, paddingBottom: 60 },
  sectionLabel: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "700", marginTop: 22, marginBottom: 8 },
  policy: { color: colors.textDim, fontSize: 12, lineHeight: 18, marginBottom: 12, marginTop: 4, fontStyle: "italic" },
  empty: { color: colors.textDim, fontSize: 13, fontStyle: "italic", marginTop: 4 },

  // stats
  statRow: { flexDirection: "row", gap: 8, marginTop: 4, marginBottom: 4 },
  stat: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, paddingVertical: 12, alignItems: "center" },
  statN: { color: colors.amber, fontFamily: mono, fontSize: 20, fontWeight: "800" },
  statL: { color: colors.textDim, fontSize: 10, letterSpacing: 0.5, marginTop: 2 },

  // ad insights
  insightGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12 },
  insightCol: { flexGrow: 1, flexBasis: "46%", minWidth: 150, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 12 },
  insightH: { color: colors.textFaint, fontSize: 10, letterSpacing: 1, fontWeight: "800", marginTop: 14, marginBottom: 8 },
  insightRow: { flexDirection: "row", justifyContent: "space-between", gap: 8, paddingVertical: 3 },
  insightLabel: { color: colors.text, fontSize: 13, flex: 1 },
  insightCount: { color: colors.amber, fontFamily: mono, fontSize: 13, fontWeight: "700" },
  activityLine: { color: colors.textDim, fontSize: 12, fontFamily: mono, paddingVertical: 2 },
  activityWho: { color: colors.cool },

  // cards + report/request actions
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 14, marginBottom: 10 },
  removedCard: { opacity: 0.6, borderColor: colors.danger },
  reasonRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  reason: { color: colors.danger, fontSize: 11, letterSpacing: 1, fontWeight: "700", textTransform: "uppercase" },
  artist: { color: colors.text, fontSize: 15, fontWeight: "800" },
  sub: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  note: { color: colors.textDim, fontSize: 13, fontStyle: "italic", marginTop: 6 },
  removedTag: { color: colors.danger, fontSize: 10, letterSpacing: 1, fontWeight: "700", marginTop: 4 },
  contentRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  actions: { flexDirection: "row", gap: 8, marginTop: 10 },
  btn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: radius.sm, borderWidth: 1 },
  remove: { borderColor: colors.danger, backgroundColor: "rgba(224,69,123,0.08)" },
  reject: { borderColor: colors.line },
  suspend: { borderColor: colors.gold, backgroundColor: "rgba(232,182,90,0.08)" },
  approve: { borderColor: colors.good, backgroundColor: colors.good },
  approveTxt: { color: "#0C1A0F", fontSize: 13, fontWeight: "800" },
  rejectTxt: { color: colors.danger, fontSize: 13, fontWeight: "700" },
  dismissTxt: { color: colors.textDim, fontSize: 13, fontWeight: "700" },

  // members
  memberStats: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, paddingVertical: 12, marginTop: 4, marginBottom: 10 },
  mStat: { flex: 1, alignItems: "center" },
  mStatN: { color: colors.text, fontSize: 20, fontWeight: "900", fontFamily: mono },
  mStatL: { color: colors.textFaint, fontSize: 10, letterSpacing: 1, fontWeight: "800", marginTop: 2, textTransform: "uppercase" },
  mStatDiv: { width: 1, alignSelf: "stretch", backgroundColor: colors.lineSoft, marginVertical: 4 },
  regionRow: { flexDirection: "row", gap: 8, paddingBottom: 12 },
  regionChip: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.bgElev, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.lineSoft, paddingHorizontal: 11, paddingVertical: 6 },
  regionCity: { color: colors.text, fontSize: 12, fontWeight: "700" },
  regionN: { color: colors.cool, fontSize: 11, fontFamily: mono, fontWeight: "800" },
  search: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, paddingVertical: 10, marginTop: 6, marginBottom: 12 },
  searchInput: { flex: 1, color: colors.text, fontSize: 14 },
  member: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 12, marginBottom: 10 },
  memberTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  memberNameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  memberName: { color: colors.text, fontSize: 15, fontWeight: "800", flexShrink: 1 },
  roleTag: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 1 },
  roleTagTxt: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase" },
  youTag: { color: colors.textFaint, fontSize: 11, fontStyle: "italic" },
  memberSub: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  pillRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 10 },
  pillLabel: { color: colors.textFaint, fontSize: 10, letterSpacing: 1, fontWeight: "700", width: 34 },
  rolePill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line },
  rolePillOn: { backgroundColor: colors.surfaceAlt, borderColor: colors.amber },
  rolePillTxt: { color: colors.textDim, fontSize: 12, fontWeight: "700", textTransform: "capitalize" },
  verifyBtn: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line },
  verifyBtnOn: { borderColor: colors.cool, backgroundColor: colors.surfaceAlt },
  verifyTxt: { color: colors.textDim, fontSize: 12, fontWeight: "700" },
  verifyTxtOn: { color: colors.cool },
  rolePillTxtOn: { color: colors.amber },
  pillDisabled: { opacity: 0.4 },
  modBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1 },
  warn: { borderColor: colors.gold },
  warnTxt: { color: colors.gold, fontSize: 12, fontWeight: "700" },
  danger: { borderColor: colors.danger },
  dangerTxt: { color: colors.danger, fontSize: 12, fontWeight: "700" },
  ok: { borderColor: colors.good },
  okTxt: { color: colors.good, fontSize: 12, fontWeight: "700" },

  // content messages
  msgRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.lineSoft, padding: 11, marginBottom: 7 },
  msgWho: { color: colors.text, fontSize: 13, fontWeight: "700" },
  msgWhere: { color: colors.textFaint, fontWeight: "400" },
  msgTxt: { color: colors.textDim, fontSize: 13, lineHeight: 19, marginTop: 2 },
  msgDel: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
});
