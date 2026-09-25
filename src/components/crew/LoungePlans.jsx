import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import Avatar from "../Avatar";
import Button from "../Button";
import Icon from "../Icon";
import {
  closePlan,
  fetchLoungePlans,
  fetchPlanMessages,
  joinPlan,
  leavePlan,
  removePlanMember,
  sendPlanMessage,
  startLoungePlan,
} from "../../lib/showPlansApi";
import { PLAN_KINDS, PLAN_MESSAGE_MAX, PLAN_SPOTS_MAX, PLAN_SPOTS_MIN, PLAN_TEXT_MAX, PLAN_TEXT_MIN, planSpotsLabel } from "../../domain/showPlans.mjs";
import { colors, radius, space } from "../../theme";

const KIND_OPTIONS = Object.entries(PLAN_KINDS).map(([id, label]) => ({ id, label }));
const SAFETY = "Meet in public places, keep your address to yourself, and tell a friend your plans. Report anything that feels off.";
const CHAT_POLL_MS = 8_000;
const failure = (error, fallback) => error?.userMessage || fallback;

function PlanCard({ plan, busy, onJoin, onOpen }) {
  const inside = plan.isHost || plan.joined;
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.kindChip}><Text style={styles.kindText}>{plan.kindLabel}</Text></View>
        <Text style={[styles.spots, plan.full && { color: colors.textFaint }]}>{planSpotsLabel(plan.joinedCount, plan.spots)}</Text>
      </View>
      <Text style={styles.cardText}>{plan.text}</Text>
      <View style={styles.cardFoot}>
        <Avatar user={plan.host} size={24} />
        <Text style={styles.host} numberOfLines={1}>{plan.isHost ? "You're hosting" : `Hosted by ${plan.host?.name || "a member"}`}</Text>
        {inside ? (
          <Button small variant="secondary" title="Open" onPress={() => onOpen(plan)} />
        ) : (
          <Button small title={plan.full ? "Full" : "I'm in"} disabled={plan.full || busy} loading={busy} onPress={() => onJoin(plan)} />
        )}
      </View>
    </View>
  );
}

function StartPlan({ onCancel, onSubmit, busy }) {
  const [kind, setKind] = useState("meet_before");
  const [text, setText] = useState("");
  const [spots, setSpots] = useState(3);
  const ready = text.trim().length >= PLAN_TEXT_MIN && !busy;
  return (
    <View style={styles.form}>
      <Text style={styles.formTitle}>Start a plan</Text>
      <View style={styles.chips}>
        {KIND_OPTIONS.map((option) => (
          <Pressable key={option.id} onPress={() => setKind(option.id)} style={[styles.chip, kind === option.id && styles.chipOn]}
            accessibilityRole="radio" accessibilityState={{ checked: kind === option.id }}>
            <Text style={[styles.chipText, kind === option.id && styles.chipTextOn]}>{option.label}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput value={text} onChangeText={(value) => setText(value.slice(0, PLAN_TEXT_MAX))} maxLength={PLAN_TEXT_MAX} multiline
        placeholder="Driving from Hamilton, leaving at 5. Or: drinks at the bar next door before doors."
        placeholderTextColor={colors.textFaint} style={styles.textArea} accessibilityLabel="What's the plan?" />
      <View style={styles.spotsRow}>
        <Text style={styles.spotsLabel}>Spots for others</Text>
        <Pressable onPress={() => setSpots((value) => Math.max(PLAN_SPOTS_MIN, value - 1))} style={styles.stepper} accessibilityRole="button" accessibilityLabel="Fewer spots">
          <Icon name="minus" size={16} color={colors.text} />
        </Pressable>
        <Text style={styles.spotsValue} accessibilityLiveRegion="polite">{spots}</Text>
        <Pressable onPress={() => setSpots((value) => Math.min(PLAN_SPOTS_MAX, value + 1))} style={styles.stepper} accessibilityRole="button" accessibilityLabel="More spots">
          <Icon name="plus" size={16} color={colors.text} />
        </Pressable>
      </View>
      <Text style={styles.fine}>{SAFETY}</Text>
      <View style={styles.row}>
        <Button variant="secondary" title="Cancel" onPress={onCancel} style={{ flex: 1 }} />
        <Button title="Post plan" disabled={!ready} loading={busy} onPress={() => onSubmit({ kind, text: text.trim(), spots })} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

function PlanDetail({ plan, session, onBack, onChange, onReport, onOpenProfile }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const lastAt = useRef(0);

  const load = useCallback(async (signal) => {
    try {
      const result = await fetchPlanMessages(plan.id, { after: lastAt.current, signal });
      const fresh = result?.messages || [];
      if (fresh.length) {
        lastAt.current = fresh[fresh.length - 1].createdAt;
        setMessages((current) => [...current, ...fresh.filter((message) => !current.some((known) => known.id === message.id))]);
      }
    } catch (failed) {
      if (!signal?.aborted) setError(failure(failed, "Messages didn't load."));
    }
  }, [plan.id]);

  useEffect(() => {
    const controller = new AbortController();
    lastAt.current = 0;
    setMessages([]);
    void load(controller.signal);
    const timer = setInterval(() => { void load(controller.signal); }, CHAT_POLL_MS);
    return () => { controller.abort(); clearInterval(timer); };
  }, [load]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await sendPlanMessage(plan.id, text);
      setDraft("");
      await load();
    } catch (failed) {
      setError(failure(failed, "That message didn't send. Try again."));
    } finally {
      setSending(false);
    }
  };

  const act = async (work, fallback) => {
    try { onChange(await work()); } catch (failed) { setError(failure(failed, fallback)); }
  };

  return (
    <View style={styles.detail}>
      <Pressable onPress={onBack} style={styles.back} accessibilityRole="button">
        <Icon name="chevron-left" size={16} color={colors.amber} /><Text style={styles.link}>All plans</Text>
      </Pressable>
      <View style={styles.kindChip}><Text style={styles.kindText}>{plan.kindLabel}</Text></View>
      <Text style={styles.detailText}>{plan.text}</Text>
      <Text style={styles.spots}>{planSpotsLabel(plan.joinedCount, plan.spots)}</Text>

      <Text style={styles.sectionLabel}>WHO'S IN</Text>
      {[plan.host, ...plan.members, ...(plan.joined ? [session] : [])].filter(Boolean).map((person) => (
        <View key={person.id} style={styles.personRow}>
          <Avatar user={person} size={30} onPress={() => onOpenProfile?.(person.id)} />
          <Text style={styles.personName} numberOfLines={1}>
            {person.id === session?.id ? "You" : person.name}{person.id === plan.host?.id ? " · host" : ""}
          </Text>
          {plan.isHost && person.id !== plan.host?.id ? (
            <Pressable onPress={() => act(() => removePlanMember(plan.id, person.id), "Couldn't remove them. Try again.")} hitSlop={8}
              accessibilityRole="button" accessibilityLabel={`Remove ${person.name} from this plan`}>
              <Text style={styles.linkQuiet}>Remove</Text>
            </Pressable>
          ) : null}
        </View>
      ))}

      <Text style={styles.sectionLabel}>PLAN CHAT</Text>
      <View style={styles.chat}>
        {messages.length ? messages.map((message) => {
          const mine = message.userId === session?.id;
          return (
            <View key={message.id} style={[styles.bubble, mine && styles.bubbleMine]}>
              {!mine ? <Text style={styles.bubbleName}>{message.name}</Text> : null}
              <Text style={[styles.bubbleText, mine && { color: "#1A1206" }]}>{message.text}</Text>
            </View>
          );
        }) : <Text style={styles.fine}>Only people in this plan can see this chat. Say hi and sort out the details.</Text>}
      </View>
      <View style={styles.inputRow}>
        <TextInput value={draft} onChangeText={setDraft} maxLength={PLAN_MESSAGE_MAX} placeholder="Message the plan" placeholderTextColor={colors.textFaint}
          style={styles.input} onSubmitEditing={send} returnKeyType="send" accessibilityLabel="Message the plan" />
        <Pressable style={[styles.send, (!draft.trim() || sending) && { opacity: 0.6 }]} onPress={send} disabled={!draft.trim() || sending}
          accessibilityRole="button" accessibilityLabel="Send to the plan">
          <Icon name="chevron-right" size={20} color="#1A1206" />
        </Pressable>
      </View>
      {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}

      <View style={styles.row}>
        {plan.isHost ? (
          <Button variant="danger" small title="Close plan" onPress={() => act(() => closePlan(plan.id), "Couldn't close the plan. Try again.")} />
        ) : (
          <>
            <Button variant="secondary" small title="Leave plan" onPress={() => act(() => leavePlan(plan.id), "Couldn't leave the plan. Try again.")} />
            {onReport && plan.host ? (
              <Button variant="secondary" small icon="flag" title="Report host" onPress={() => onReport({
                targetType: "user", targetId: plan.host.id, ownerId: plan.host.id, targetName: "profile",
                title: `${plan.host.name} (@${plan.host.handle})`, summary: `Report the host of a plan: "${plan.text}"`,
              })} />
            ) : null}
          </>
        )}
      </View>
      <Text style={styles.fine}>{SAFETY}</Text>
    </View>
  );
}

// Group plans for one show's Lounge. Adults with a confirmed email only; the
// Lounge decides who sees this at all.
export default function LoungePlans({ loungeKey, session, onReport, onOpenProfile }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({ status: "idle", plans: [] });
  const [view, setView] = useState({ mode: "list", planId: null });
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async (signal) => {
    setState((current) => ({ ...current, status: current.plans.length ? "refreshing" : "loading" }));
    try {
      const result = await fetchLoungePlans(loungeKey, { signal });
      setState({ status: "ready", plans: result?.plans || [] });
    } catch (failed) {
      if (!signal?.aborted) setState((current) => ({ ...current, status: "error", message: failure(failed, "Plans didn't load.") }));
    }
  }, [loungeKey]);

  useEffect(() => {
    if (!session?.emailVerified) return undefined;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, session?.emailVerified]);

  const applied = (result) => {
    setState({ status: "ready", plans: result?.plans || [] });
    setError("");
  };
  const join = async (plan) => {
    setBusy(plan.id);
    try {
      applied(await joinPlan(plan.id));
      setView({ mode: "detail", planId: plan.id });
    } catch (failed) {
      setError(failure(failed, "Couldn't join that plan."));
      void load();
    } finally {
      setBusy(null);
    }
  };
  const start = async (values) => {
    setBusy("new");
    try {
      applied(await startLoungePlan(loungeKey, values));
      setView({ mode: "list", planId: null });
    } catch (failed) {
      setError(failure(failed, "Couldn't post the plan. Try again."));
    } finally {
      setBusy(null);
    }
  };

  if (!session?.emailVerified) {
    return (
      <View style={styles.bar}>
        <Icon name="user-plus" size={16} color={colors.amber} />
        <Text style={styles.barText}>Confirm your email to see plans for this show.</Text>
      </View>
    );
  }

  const count = state.plans.length;
  const current = state.plans.find((plan) => plan.id === view.planId) || null;

  return (
    <>
      <Pressable style={styles.bar} onPress={() => setOpen(true)} accessibilityRole="button"
        accessibilityLabel={`Plans for this show, ${count} open`}>
        <Icon name="user-plus" size={16} color={colors.amber} />
        <View style={{ flex: 1 }}>
          <Text style={styles.barTitle}>Plans{count ? ` · ${count}` : ""}</Text>
          <Text style={styles.barText} numberOfLines={1}>Carpools, meetups before doors, spare tickets</Text>
        </View>
        <Icon name="chevron-right" size={16} color={colors.amber} />
      </Pressable>

      {open ? (
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Plans for this show</Text>
            <Pressable onPress={() => { setOpen(false); setView({ mode: "list", planId: null }); }} hitSlop={10}
              accessibilityRole="button" accessibilityLabel="Close plans">
              <Icon name="x" size={20} color={colors.textDim} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
            {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
            {view.mode === "detail" && current ? (
              <PlanDetail plan={current} session={session} onBack={() => setView({ mode: "list", planId: null })}
                onChange={(result) => { applied(result); if (!result?.plans?.some((plan) => plan.id === current.id && (plan.isHost || plan.joined))) setView({ mode: "list", planId: null }); }}
                onReport={onReport} onOpenProfile={onOpenProfile} />
            ) : view.mode === "new" ? (
              <StartPlan busy={busy === "new"} onCancel={() => setView({ mode: "list", planId: null })} onSubmit={start} />
            ) : (
              <>
                <Text style={styles.intro}>Group plans for people going to this show. Join one or start your own. Plans are for members 18 and over.</Text>
                <Button icon="plus" title="Start a plan" onPress={() => setView({ mode: "new", planId: null })} />
                {state.status === "loading" ? <ActivityIndicator color={colors.amber} style={{ marginTop: space(6) }} /> : null}
                {state.status === "error" ? (
                  <View style={styles.row}><Text style={styles.error}>{state.message}</Text><Button small variant="secondary" title="Try again" onPress={() => load()} /></View>
                ) : null}
                {state.status !== "loading" && !count ? <Text style={styles.fine}>No plans yet. Start one: a carpool, a meetup before doors, a hotel split.</Text> : null}
                {state.plans.map((plan) => (
                  <PlanCard key={plan.id} plan={plan} busy={busy === plan.id} onJoin={join} onOpen={(item) => setView({ mode: "detail", planId: item.id })} />
                ))}
                <Text style={styles.fine}>{SAFETY}</Text>
              </>
            )}
          </ScrollView>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: space(3), marginHorizontal: 16, marginTop: 10, padding: space(3), borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface },
  barTitle: { color: colors.text, fontSize: 14, fontWeight: "900" },
  barText: { color: colors.textDim, fontSize: 12.5, flexShrink: 1 },
  sheet: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.bg, zIndex: 20 },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  sheetTitle: { color: colors.text, fontSize: 18, fontWeight: "900" },
  sheetBody: { padding: 16, paddingBottom: 48, gap: space(3), width: "100%", maxWidth: 620, alignSelf: "center" },
  intro: { color: colors.textDim, fontSize: 14, lineHeight: 20 },
  card: { padding: space(4), gap: space(2), borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(2) },
  kindChip: { alignSelf: "flex-start", paddingVertical: 4, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt },
  kindText: { color: colors.amber, fontSize: 12, fontWeight: "900" },
  spots: { color: colors.textDim, fontSize: 12, fontWeight: "700" },
  cardText: { color: colors.text, fontSize: 15, lineHeight: 21 },
  cardFoot: { flexDirection: "row", alignItems: "center", gap: space(2), marginTop: space(1) },
  host: { flex: 1, color: colors.textDim, fontSize: 12.5 },
  form: { gap: space(3) },
  formTitle: { color: colors.text, fontSize: 17, fontWeight: "900" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space(2) },
  chip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.amberStrong, borderColor: colors.amber },
  chipText: { color: colors.text, fontSize: 13, fontWeight: "700" },
  chipTextOn: { color: "#1A1206" },
  textArea: { minHeight: 80, color: colors.text, fontSize: 15, padding: space(3), borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, textAlignVertical: "top" },
  spotsRow: { flexDirection: "row", alignItems: "center", gap: space(3) },
  spotsLabel: { flex: 1, color: colors.text, fontSize: 14, fontWeight: "700" },
  stepper: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line },
  spotsValue: { color: colors.text, fontSize: 18, fontWeight: "900", minWidth: 20, textAlign: "center" },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(3) },
  fine: { color: colors.textFaint, fontSize: 12, lineHeight: 17 },
  error: { color: colors.danger, fontSize: 13 },
  detail: { gap: space(3) },
  back: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 32 },
  link: { color: colors.amber, fontWeight: "800", fontSize: 13 },
  linkQuiet: { color: colors.textFaint, fontWeight: "700", fontSize: 12 },
  detailText: { color: colors.text, fontSize: 18, fontWeight: "800", lineHeight: 24 },
  sectionLabel: { color: colors.textFaint, fontSize: 11, fontWeight: "900", letterSpacing: 1.2, marginTop: space(2) },
  personRow: { flexDirection: "row", alignItems: "center", gap: space(3) },
  personName: { flex: 1, color: colors.text, fontSize: 14, fontWeight: "700" },
  chat: { gap: space(2) },
  bubble: { alignSelf: "flex-start", maxWidth: "85%", paddingVertical: 8, paddingHorizontal: 12, borderRadius: 14, borderTopLeftRadius: 4, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft },
  bubbleMine: { alignSelf: "flex-end", backgroundColor: colors.amber, borderColor: colors.amber, borderTopLeftRadius: 14, borderTopRightRadius: 4 },
  bubbleName: { color: colors.amber, fontSize: 11, fontWeight: "800", marginBottom: 2 },
  bubbleText: { color: colors.text, fontSize: 14, lineHeight: 19 },
  inputRow: { flexDirection: "row", alignItems: "center", gap: space(2) },
  input: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, color: colors.text, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15 },
  send: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.amberStrong, alignItems: "center", justifyContent: "center" },
});
