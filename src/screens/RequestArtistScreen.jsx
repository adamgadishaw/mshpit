import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, View, Text, StyleSheet, ScrollView, TextInput, Pressable } from "react-native";
import { colors, radius } from "../theme";
import { useStore } from "../store";
import Icon from "../components/Icon";
import SheetHeader from "../components/SheetHeader";
import { artistSetupFailure, artistVerificationNotice } from "../domain/artistAccountSetup.mjs";

export default function RequestArtistScreen(props) {
  const { session } = useStore();
  // A different signed-in account must never inherit a name, verification note,
  // pending response or success screen from the previous account.
  return <ArtistPageSetup key={session?.id || "guest"} {...props} />;
}

function ArtistPageSetup({ onClose, onCreated }) {
  const { session, requestArtist, createArtistPage, loadArtistAccount, resendEmailVerification } = useStore();
  const ownsPage = session?.role === "artist" && !!session?.artistName;
  const [mode, setMode] = useState(ownsPage ? "claim" : "create");
  const [artistName, setArtistName] = useState(session?.artistName || session?.pendingArtistIntent?.artistName || "");
  const [bio, setBio] = useState("");
  const [note, setNote] = useState("");
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [existingPage, setExistingPage] = useState(false);
  const [emailStatus, setEmailStatus] = useState("");
  const [account, setAccount] = useState({ status: "loading", value: null, error: "" });
  const [retry, setRetry] = useState(0);
  const operation = useRef(null);
  const mounted = useRef(true);
  const loadAccountRef = useRef(loadArtistAccount);
  loadAccountRef.current = loadArtistAccount;

  useEffect(() => {
    // A refreshed account can confirm a create whose response was lost. Do not
    // offer another creation attempt or lock an unsaved name onto that page.
    if (!ownsPage || done) return;
    setMode("claim");
    setArtistName(session.artistName);
    setExistingPage(false);
  }, [ownsPage, session?.artistName, done]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; operation.current?.abort(); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setAccount({ status: "loading", value: null, error: "" });
    void (async () => {
      try {
        const result = await loadAccountRef.current({ signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!result?.ok) throw new Error(artistSetupFailure(result).message);
        setAccount({ status: "ready", value: result, error: "" });
        const savedName = result.artist?.name || result.pendingArtistIntent?.artistName;
        if (savedName) setArtistName((current) => current || savedName);
      } catch (failure) {
        if (!controller.signal.aborted) setAccount({ status: "error", value: null, error: failure.message || "Your artist account could not be loaded." });
      }
    })();
    return () => controller.abort();
  }, [retry]);

  const verification = artistVerificationNotice(account.value?.verification?.status, ownsPage);
  const verificationScreen = ownsPage && done?.mode !== "create";
  const valid = session?.emailVerified === true && account.status === "ready" && artistName.trim().length >= 2
    && !(mode === "claim" && verification.locked);
  const chooseMode = (nextMode) => {
    if (busy || ownsPage) return;
    setMode(nextMode);
    setError("");
    setExistingPage(false);
  };
  const submit = async () => {
    if (!valid || busy || operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    setExistingPage(false);
    try {
      const result = mode === "create"
        ? await createArtistPage(artistName.trim(), bio.trim(), { signal: controller.signal })
        : await requestArtist(artistName.trim(), note.trim(), { signal: controller.signal });
      if (!mounted.current || controller.signal.aborted || operation.current !== controller) return;
      if (result?.ok) setDone({ mode, result });
      else {
        const failure = artistSetupFailure(result);
        setError(failure.message);
        setExistingPage(failure.existingPage);
      }
    } catch (failure) {
      if (mounted.current && !controller.signal.aborted) setError(artistSetupFailure(failure).message);
    } finally {
      if (operation.current === controller) operation.current = null;
      if (mounted.current && !controller.signal.aborted) setBusy(false);
    }
  };
  const confirmEmail = async () => {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    try {
      const result = await resendEmailVerification({ signal: controller.signal });
      if (!mounted.current || controller.signal.aborted) return;
      if (result?.state === "confirmed") { setEmailStatus("Email confirmed. Your artist page details are ready to save."); setRetry((value) => value + 1); }
      else if (["sent", "recent"].includes(result?.state)) setEmailStatus("Check your inbox for the confirmation link, then return here and tap this button again. Your details stay on this page.");
      else setError("The confirmation email could not be sent. Please try again.");
    } catch (failure) {
      if (mounted.current && !controller.signal.aborted) setError(artistSetupFailure(failure).message);
    } finally {
      if (operation.current === controller) operation.current = null;
      if (mounted.current && !controller.signal.aborted) setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <SheetHeader title={verificationScreen ? "Artist verification" : "Set up artist page"} onBack={onClose} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.h1Row}>
          <Icon name={verificationScreen ? "shield" : "music"} size={24} color={colors.amber} />
          <Text style={styles.h1}>{verificationScreen ? "Your artist identity" : "Your music. Your page."}</Text>
        </View>
        <Text style={styles.intro}>Free artist pages, live photos and videos, promotion, and upcoming concerts. All with this account—no separate login or subscription.</Text>
        <Text style={styles.noticeText}>Your artist page can be public. Your account privacy settings still apply; choose photo and video visibility when posting.</Text>

        {done ? (
          <View style={styles.doneBox}>
            <Icon name="check" size={28} color={colors.good} />
            <Text style={styles.doneTitle}>{done.mode === "create" ? "Your artist page is ready" : "Request sent for review"}</Text>
            <Text style={styles.doneTxt} accessibilityLiveRegion="polite" role="status">{done.mode === "create"
              ? "Add your photos, bio, live clips, and upcoming shows in Artist HQ. Your page does not have a verified check yet; you can request that separately."
              : "The Mshpit owner will review your evidence before granting the artist check or access to an existing page. Your private verification details are not published."}</Text>
            <Pressable style={styles.primary} onPress={() => done.mode === "create" && onCreated ? onCreated(done.result) : onClose?.()} accessibilityRole="button">
              <Text style={styles.primaryTxt}>{done.mode === "create" ? "OPEN ARTIST HQ" : "DONE"}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {session?.emailVerified !== true && <View style={styles.notice}>
              <Text style={styles.choiceTitle}>Confirm your email to publish</Text>
              <Text style={styles.noticeText}>You can fill in your artist details now. Confirm your account email before creating a page or sending a claim. This is separate from the public artist check.</Text>
              <Pressable style={styles.secondary} onPress={confirmEmail} disabled={busy} accessibilityRole="button" accessibilityState={{ disabled: busy, busy }}><Text style={styles.secondaryTxt}>{busy ? "Checking…" : "Send or check confirmation email"}</Text></Pressable>
            </View>}
            {!!emailStatus && <Text selectable style={styles.noticeText} accessibilityLiveRegion="polite">{emailStatus}</Text>}
            {!ownsPage && <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel="Artist page setup">
              {[{ key: "create", title: "Create a new artist page", detail: "For an artist or band not already on Mshpit." }, { key: "claim", title: "Claim an existing page", detail: "Already listed? Ask for access without creating a duplicate." }].map((choice) => (
                <Pressable key={choice.key} onPress={() => chooseMode(choice.key)} disabled={busy} accessibilityRole="radio" accessibilityLabel={choice.title} accessibilityState={{ checked: mode === choice.key, disabled: busy }} {...(Platform.OS === "web" ? { "aria-checked": mode === choice.key } : {})} style={[styles.choice, mode === choice.key && styles.choiceSelected]}>
                  <Icon name={mode === choice.key ? "check" : "plus"} size={18} color={mode === choice.key ? colors.amber : colors.textFaint} />
                  <View style={styles.choiceCopy}><Text style={styles.choiceTitle}>{choice.title}</Text><Text style={styles.choiceDetail}>{choice.detail}</Text></View>
                </Pressable>
              ))}
            </View>}
            {account.status === "loading" && <View style={styles.notice} accessibilityRole="progressbar" accessibilityLabel="Checking artist account"><ActivityIndicator color={colors.amber} /><Text style={styles.noticeText}>Checking your artist account…</Text></View>}
            {account.status === "error" && <View style={styles.notice}><Text selectable style={styles.error} accessibilityRole="alert">{account.error}</Text><Pressable style={styles.secondary} onPress={() => setRetry((value) => value + 1)} accessibilityRole="button"><Text style={styles.secondaryTxt}>Try again</Text></Pressable></View>}
            {account.status === "ready" && mode === "claim" && verification.message ? <View style={styles.notice}><Text selectable style={styles.noticeText}>{verification.message}</Text></View> : null}
            <Text style={styles.label}>ARTIST / BAND NAME</Text>
            <TextInput style={styles.input} value={artistName} onChangeText={(value) => { setArtistName(value); setError(""); setExistingPage(false); }} placeholder="Your artist or band name" placeholderTextColor={colors.textFaint} maxLength={80} editable={!busy && !ownsPage} returnKeyType="next" accessibilityLabel="Artist or band name" accessibilityState={{ disabled: busy || ownsPage }} />
            {mode === "create" ? <>
              <Text style={styles.label}>SHORT BIO · OPTIONAL</Text>
              <TextInput style={[styles.input, styles.multiline]} value={bio} onChangeText={setBio} placeholder="Introduce your music and live shows. You can edit this later." placeholderTextColor={colors.textFaint} maxLength={240} multiline editable={!busy} accessibilityLabel="Artist biography, optional" />
              <Text style={styles.noticeText}>You can publish from your new page before requesting verification. The artist check is granted only after Mshpit reviews your identity. Normal upload and community safety limits apply.</Text>
            </> : <>
              <Text style={styles.label}>HOW WE CAN VERIFY YOU</Text>
              <TextInput style={[styles.input, styles.multiline]} value={note} onChangeText={(value) => { setNote(value); setError(""); }} placeholder="Official website, artist social account, label, or manager contact we can check" placeholderTextColor={colors.textFaint} maxLength={500} multiline editable={!busy && !verification.locked} accessibilityLabel="Artist verification details" accessibilityHint="Private evidence of your relationship to this artist. Do not include passwords or identity documents." accessibilityState={{ disabled: busy || verification.locked }} />
              <Text style={styles.noticeText}>These details are private to the review team. Never include passwords or identity documents. An existing page stays unchanged until your claim is approved.</Text>
            </>}
            {!!error && <Text selectable style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">{error}</Text>}
            {existingPage && !ownsPage && <Pressable style={styles.secondary} onPress={() => chooseMode("claim")} accessibilityRole="button"><Text style={styles.secondaryTxt}>Claim this existing page instead</Text></Pressable>}
            <Pressable style={[styles.primary, (!valid || busy) && styles.disabled]} onPress={submit} disabled={!valid || busy} accessibilityRole="button" accessibilityState={{ disabled: !valid || busy, busy }}>
              <Text style={styles.primaryTxt}>{busy ? "SAVING…" : mode === "create" ? "CREATE FREE ARTIST PAGE" : verification.locked ? verification.button : "SEND FOR REVIEW"}</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 64, width: "100%", maxWidth: 760, alignSelf: "center" },
  h1Row: { flexDirection: "row", alignItems: "center", gap: 10 },
  h1: { color: colors.text, fontSize: 26, fontWeight: "800", flex: 1 },
  intro: { color: colors.textDim, fontSize: 15, lineHeight: 23, marginTop: 14 },
  choices: { gap: 10, marginTop: 22 },
  choice: { flexDirection: "row", gap: 12, alignItems: "center", minHeight: 80, padding: 16, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  choiceSelected: { borderColor: colors.amber, backgroundColor: colors.surfaceAlt },
  choiceCopy: { flex: 1 },
  choiceTitle: { color: colors.text, fontSize: 15, fontWeight: "800" },
  choiceDetail: { color: colors.textDim, fontSize: 13, lineHeight: 19, marginTop: 4 },
  label: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "700", marginBottom: 8, marginTop: 22 },
  input: { backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, color: colors.text, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  multiline: { minHeight: 106, textAlignVertical: "top" },
  primary: { backgroundColor: colors.amberStrong, borderRadius: radius.md, minHeight: 50, paddingHorizontal: 16, paddingVertical: 15, alignItems: "center", marginTop: 24 },
  primaryTxt: { color: "#1A1206", fontSize: 14, fontWeight: "800", letterSpacing: 0.5 },
  secondary: { minHeight: 46, justifyContent: "center", alignSelf: "flex-start", paddingVertical: 10, paddingHorizontal: 2, marginTop: 8 },
  secondaryTxt: { color: colors.amber, fontSize: 14, fontWeight: "800" },
  disabled: { opacity: 0.4 },
  notice: { gap: 8, marginTop: 20, padding: 14, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  noticeText: { color: colors.textDim, fontSize: 13, lineHeight: 20, marginTop: 10 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 21, marginTop: 12 },
  doneBox: { alignItems: "center", marginTop: 36, gap: 16 },
  doneTitle: { color: colors.text, fontSize: 22, fontWeight: "800", textAlign: "center" },
  doneTxt: { color: colors.textDim, fontSize: 15, lineHeight: 23, textAlign: "center" },
});
