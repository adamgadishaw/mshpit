import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import Avatar from "../components/Avatar";
import BrandMark from "../components/BrandMark";
import Button from "../components/Button";
import Icon from "../components/Icon";
import WelcomeGuide from "../features/signupOnboarding/WelcomeGuide";
import AccountPasswordForm from "../features/signupOnboarding/AccountPasswordForm";
import CityWelcomeCard from "../features/cities/CityWelcomeCard";
import { cityIdentityForLocation } from "../cityIdentity";
import { cleanHandle, isHandle } from "../domain/validation.mjs";
import { confirmSignupProfile, signupHandleLocked, signupProfilePatch, signupProfileSnapshot } from "../domain/signupProfileDraft.mjs";
import { profileImagePickerOptions } from "../domain/profileImagePolicy.mjs";
import { reportMediaPickerError, uploadMediaAsset } from "../lib/mediaUpload";
import { useStore } from "../store";
import { colors, displayFont, focusRing, mono, radius, shadow, space } from "../theme";

const TOTAL_STEPS = 2;
const message = (error, fallback) => String(typeof error === "string" ? error : error?.userMessage || error?.message || fallback).slice(0, 280);

// Saved photos survive refresh; unfinished changes stay visible until confirmed
// or explicitly discarded. Nothing sensitive is persisted in browser storage.
export default function SignupOnboardingScreen({ session, initialStep = 1, onComplete, onSkip, onSaveProfile }) {
  const { updateProfile, deleteAccount, resendEmailVerification } = useStore();
  const saveProfile = onSaveProfile || updateProfile;
  const insets = useSafeAreaInsets();
  const scrollRef = useRef(null);
  const mounted = useRef(false);
  const owner = useRef(session.id);
  owner.current = session.id;
  const active = useRef(null);
  const initial = signupProfileSnapshot(session);
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [step, setStep] = useState(initialStep === 2 ? 2 : 1);
  const [operation, setOperation] = useState(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [discardPrompt, setDiscardPrompt] = useState(false);
  const [cancelPrompt, setCancelPrompt] = useState(false);
  const [handleLocked, setHandleLocked] = useState(() => signupHandleLocked(session));
  const [destination, setDestination] = useState("shows");
  const [touched, setTouched] = useState(false);
  const busy = !!operation;
  const dirty = Object.keys(signupProfilePatch(draft, saved)).length > 0;
  const handleInvalid = touched && !isHandle(draft.handle);
  const firstName = String(session.name || "there").trim().split(/\s+/)[0];
  const homeCity = session.home?.city?.split(",")[0];
  const city = cityIdentityForLocation(session.home) || homeCity || null;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; active.current?.controller.abort(); active.current = null; };
  }, []);
  useEffect(() => {
    active.current?.controller.abort();
    active.current = null;
    const next = signupProfileSnapshot(session);
    setDraft(next); setSaved(next); setStep(initialStep === 2 ? 2 : 1);
    setHandleLocked(signupHandleLocked(session));
    setOperation(null); setError(""); setStatus(""); setDiscardPrompt(false);
  }, [session.id, initialStep]);
  useEffect(() => {
    if (signupHandleLocked(session)) setHandleLocked(true);
  }, [session.handleChangeAvailableAt]);
  useEffect(() => { scrollRef.current?.scrollTo?.({ y: 0, animated: false }); }, [step]);
  useEffect(() => {
    if (Platform.OS !== "web" || (!dirty && !busy)) return undefined;
    const protect = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty, busy]);

  const begin = (kind) => {
    if (active.current) return null;
    if (!["finishing", "verification"].includes(kind) && session.emailVerified !== true) { setError("Confirm your email to claim your username and upload photos. You can finish setup without photos and add them later."); return null; }
    const task = { accountId: session.id, controller: new AbortController() };
    active.current = task; setOperation(kind); setError(""); setStatus(""); setDiscardPrompt(false);
    return task;
  };
  const current = (task) => mounted.current && active.current === task && owner.current === task.accountId && !task.controller.signal.aborted;
  const end = (task) => { if (current(task)) { active.current = null; setOperation(null); } };
  const persist = async (patch, task) => {
    if (!current(task)) return null;
    const result = await saveProfile(patch, { expectedAccountId: task.accountId, signal: task.controller.signal, optimistic: false });
    if (!current(task)) return null;
    const confirmed = confirmSignupProfile(result, task.accountId, patch);
    // Reconcile only fields in this request; an unsaved username must not be
    // replaced when a photo is saved automatically.
    setSaved((value) => ({ ...value, ...Object.fromEntries(Object.keys(patch).map((key) => [key, confirmed[key]])) }));
    setDraft((value) => ({ ...value, ...Object.fromEntries(Object.keys(patch).map((key) => [key, confirmed[key]])) }));
    if (patch.handle || signupHandleLocked(result.user)) setHandleLocked(true);
    return confirmed;
  };
  const confirmEmail = async () => {
    const task = begin("verification");
    if (!task) return;
    try {
      const result = await resendEmailVerification({ signal: task.controller.signal });
      if (!current(task)) return;
      if (result?.state === "confirmed") {
        const next = signupProfileSnapshot(result.user);
        setDraft(next); setSaved(next);
        setStatus("Email confirmed. Add your profile photo and banner below.");
      } else if (["sent", "recent"].includes(result?.state)) {
        setStatus("Check your inbox for the confirmation link, then return here. Your setup stays open.");
      } else setError("A confirmation link could not be sent. Please try again.");
    } catch (caught) { if (current(task)) setError(message(caught, "Email confirmation could not be checked. Try again.")); }
    finally { end(task); }
  };

  const pickPhoto = async (purpose) => {
    const task = begin(purpose);
    if (!task) return;
    let selecting = true;
    try {
      const result = await ImagePicker.launchImageLibraryAsync(profileImagePickerOptions(purpose, { platform: Platform.OS }));
      selecting = false;
      if (!current(task) || result?.canceled || !result?.assets?.[0]) return;
      const url = await uploadMediaAsset(result.assets[0], purpose, { signal: task.controller.signal, expectedAccountId: task.accountId });
      if (!current(task)) return;
      const key = purpose === "avatar" ? "avatarUri" : "banner";
      setDraft((value) => ({ ...value, [key]: url }));
      // Attach immediately so refresh resumes the saved picture. If attachment
      // fails, retain the uploaded draft and let Continue retry the same URL.
      if (await persist({ [key]: url }, task)) setStatus(purpose === "avatar" ? "Profile photo saved." : "Banner saved.");
    } catch (caught) {
      if (current(task)) {
        const captured = selecting ? reportMediaPickerError(caught, "Opening your profile photo library") : caught;
        setError(message(captured, "Your photo could not be saved. Try again, or continue without it."));
      }
    } finally { end(task); }
  };

  const removePhoto = async (key) => {
    const task = begin(key === "avatarUri" ? "avatar" : "banner");
    if (!task) return;
    setDraft((value) => ({ ...value, [key]: null }));
    try { if (await persist({ [key]: null }, task)) setStatus("Photo removed from your profile."); }
    catch (caught) { if (current(task)) setError(message(caught, "That change could not be saved. Try again.")); }
    finally { end(task); }
  };

  const continueProfile = async () => {
    if (active.current) return;
    setTouched(true);
    if (session.emailVerified !== true) { setStep(2); setError(""); return; }
    if (!isHandle(draft.handle)) { setError("Use 3–20 letters, numbers, or underscores for your @username."); return; }
    const patch = signupProfilePatch(draft, saved);
    if (!Object.keys(patch).length) { setStep(2); setError(""); setStatus(""); setDiscardPrompt(false); return; }
    const task = begin("saving");
    if (!task) return;
    try { if (await persist(patch, task)) { setStep(2); setStatus(""); } }
    catch (caught) { if (current(task)) setError(message(caught, "Your changes are still here. Try saving again.")); }
    finally { end(task); }
  };

  const finish = async (next = destination, discard = false) => {
    if (active.current) return;
    if (dirty && !discard) { setDiscardPrompt(true); return; }
    const task = begin("finishing");
    if (!task) return;
    try {
      const callback = onComplete || onSkip;
      if (typeof callback !== "function") throw new Error("Setup could not finish. Please try again.");
      const result = await callback({ destination: next, expectedAccountId: task.accountId, signal: task.controller.signal });
      if (current(task) && result?.ok !== true) throw result?.error || new Error("Setup could not be confirmed. Please try again.");
    } catch (caught) { if (current(task)) setError(message(caught, "Setup could not finish. Please try again.")); }
    finally { end(task); }
  };

  if (cancelPrompt) return <AccountPasswordForm key={session.id} session={session} deleteAccount={deleteAccount} cancelSetup onClose={() => setCancelPrompt(false)} />;

  return <View style={styles.safe} accessibilityViewIsModal>
    <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.header}><View style={styles.headerInner}>
        <View style={styles.brand}><BrandMark size={30} color={colors.amber} /><View><Text style={styles.brandName}>MSHPIT</Text><Text style={styles.brandLine}>LIVE MUSIC, REMEMBERED</Text></View></View>
        <Pressable onPress={() => setCancelPrompt(true)} disabled={busy} accessibilityRole="button" accessibilityLabel="Cancel signup" style={({ focused }) => [styles.later, focused && focusRing]}><Text style={styles.laterText}>Cancel</Text></Pressable>
      </View></View>
      <View style={styles.progress} accessible accessibilityRole="progressbar" accessibilityLabel="Profile setup progress" accessibilityValue={{ min: 1, max: TOTAL_STEPS, now: step }} aria-valuemin={1} aria-valuemax={TOTAL_STEPS} aria-valuenow={step}>
        <Text style={styles.kicker}>STEP {step} OF {TOTAL_STEPS} · {step === 1 ? "YOUR PROFILE" : "YOUR FIRST NIGHT"}</Text>
        <View style={styles.progressBars}>{[1, 2].map((value) => <View key={value} style={[styles.progressBar, value <= step && styles.progressOn]} />)}</View>
      </View>
      <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"} automaticallyAdjustKeyboardInsets showsVerticalScrollIndicator={false}>
        {step === 1 ? <>
          <Text style={styles.title} accessibilityRole="header">Make it yours, {firstName}.</Text>
          <Text style={styles.subtitle}>A face for the crowd. A banner for your kind of night. Both are optional.</Text>
          {session.emailVerified !== true && <Text selectable style={styles.hint}>Confirm your email to claim your chosen @username and add photos. You can finish setup now and add photos later in Edit profile.</Text>}
          {session.emailVerified !== true && <Button title={operation === "verification" ? "Checking…" : "Confirm email to add photos"} variant="secondary" onPress={() => void confirmEmail()} disabled={busy} style={{ marginBottom: space(3) }} />}
          <View style={styles.profileCard}>
            <View style={styles.trim}><View style={styles.trimAmber} /><View style={styles.trimPink} /><View style={styles.trimBlue} /></View>
            <Pressable onPress={() => void pickPhoto("banner")} disabled={busy} accessibilityRole="button" accessibilityLabel={draft.banner ? "Change profile banner" : "Add profile banner"} style={({ focused }) => [styles.banner, focused && focusRing]}>
              {draft.banner ? <Image source={{ uri: draft.banner }} style={StyleSheet.absoluteFillObject} resizeMode="cover" /> : <View style={styles.bannerArt}><BrandMark size={108} color={colors.line} /><Text style={styles.bannerSlogan}>YOUR NIGHTS. YOUR PEOPLE.</Text></View>}
              <View style={styles.bannerAction}>{operation === "banner" ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Icon name="camera" size={17} color="#FFFFFF" />}<Text style={styles.bannerActionText}>{operation === "banner" ? "Saving banner…" : draft.banner ? "Change banner" : "Add a banner"}</Text></View>
            </Pressable>
            <View style={styles.identity}>
              <Pressable onPress={() => void pickPhoto("avatar")} disabled={busy} accessibilityRole="button" accessibilityLabel={draft.avatarUri ? "Change profile photo" : "Add profile photo"} style={({ focused }) => [styles.avatarButton, focused && focusRing]}>
                <Avatar user={{ ...session, avatarUri: draft.avatarUri }} size={72} priority="high" />
                <View style={styles.camera}>{operation === "avatar" ? <ActivityIndicator size="small" color={colors.text} /> : <Icon name="camera" size={14} color={colors.text} />}</View>
              </Pressable>
              <View style={styles.identityText}><Text style={styles.name} numberOfLines={1}>{session.name}</Text><Text style={styles.handlePreview} numberOfLines={1}>@{draft.handle || "yourname"}</Text><Text style={styles.photoHint}>{operation === "avatar" ? "Saving photo…" : "Tap your photo to change it"}</Text></View>
            </View>
            {(draft.avatarUri || draft.banner) && <View style={styles.removeRow}>
              {draft.avatarUri ? <PhotoRemove title="Remove profile photo" onPress={() => void removePhoto("avatarUri")} disabled={busy} /> : null}
              {draft.banner ? <PhotoRemove title="Remove banner" onPress={() => void removePhoto("banner")} disabled={busy} /> : null}
            </View>}
          </View>
          <Text style={styles.label}>YOUR @USERNAME</Text>
          <View style={[styles.handleRow, handleInvalid && styles.invalid]}><Text style={styles.at}>@</Text><TextInput value={draft.handle} onChangeText={(value) => { setDraft((current) => ({ ...current, handle: cleanHandle(value) })); setTouched(true); setError(""); setStatus(""); }} onBlur={() => setTouched(true)} onSubmitEditing={() => void continueProfile()} editable={!busy && !handleLocked} autoCapitalize="none" autoCorrect={false} spellCheck={false} maxLength={20} textContentType="username" accessibilityLabel="Username" aria-invalid={handleInvalid} placeholder="yourname" placeholderTextColor={colors.textFaint} style={styles.input} />{handleLocked && <Icon name="check" size={18} color={colors.good} />}</View>
          <Text style={styles.hint}>{handleLocked ? "Username saved. You can change it again later in Edit profile." : "This is how people find and tag you. If your signup choice was taken before confirmation, choose another here. Changes are checked when saved."}</Text>
          {!handleLocked && dirty && draft.handle !== saved.handle && <Text style={styles.hint}>After this change, you’ll wait 10 business days before changing your @ again.</Text>}
          <View style={styles.privacy}><Icon name="shield" size={18} color={colors.textDim} /><Text style={styles.privacyText}>Your profile photo and banner follow your profile’s audience settings. Use photos you’re happy to share.</Text></View>
        </> : <>
          <Text style={styles.title} accessibilityRole="header">You’re on the list.</Text>
          <Text style={styles.subtitle}>{homeCity ? "Make " + homeCity + " your next night out. " : "Your next great night starts somewhere. "}Where do you want to start?</Text>
          {city && <View style={{ marginBottom: space(4) }}><CityWelcomeCard city={city} compact hideActions /></View>}
          <WelcomeGuide selected={destination} onChoose={setDestination} busy={busy} />
          <Text style={styles.savedNote}>Finish setup keeps your account. Cancel deletes the unfinished account and its uploads. Interrupted setup stays available with no expiry. Email confirmation is separate; nothing gets posted or followed here.</Text>
        </>}
        {discardPrompt && <View style={styles.discard} accessibilityRole="alert"><Text style={styles.discardTitle}>Keep your changes?</Text><Text style={styles.hint}>Some profile changes aren’t saved yet.</Text><Button title="Save and continue" onPress={() => void continueProfile()} /><Button title="Finish setup without these changes" variant="secondary" onPress={() => void finish("feed", true)} /><Button title="Cancel signup" variant="secondary" onPress={() => setCancelPrompt(true)} /></View>}
        {!!error && <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive" role="alert">{error}</Text>}
        {!!status && <Text style={styles.status} accessibilityLiveRegion="polite" role="status">{status}</Text>}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}><View style={styles.footerInner}>
        {step === 2 && <Button title="Back" variant="secondary" onPress={() => { setStep(1); setError(""); }} disabled={busy} style={styles.back} />}
        <Button title={operation === "saving" ? "Saving…" : operation === "finishing" ? "Finishing…" : step === 1 ? dirty ? "Save and continue" : "Continue" : "Finish setup"} onPress={() => step === 1 ? void continueProfile() : void finish()} disabled={busy} loading={busy} icon="chevron-right" style={styles.next} />
      </View></View>
    </KeyboardAvoidingView>
  </View>;
}

function PhotoRemove({ title, onPress, disabled }) {
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" style={({ focused }) => [styles.remove, focused && focusRing]}><Text style={styles.removeText}>{title}</Text></Pressable>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg }, keyboard: { flex: 1 }, scroll: { flex: 1 },
  header: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  headerInner: { width: "100%", maxWidth: 720, alignSelf: "center", minHeight: 62, paddingHorizontal: space(4), flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(2) },
  brand: { flexDirection: "row", alignItems: "center", gap: space(2) },
  brandName: { color: colors.text, fontFamily: mono, fontSize: 13, fontWeight: "900", letterSpacing: 2.8 },
  brandLine: { color: colors.textFaint, fontFamily: mono, fontSize: 7, letterSpacing: 1.3, marginTop: 3 },
  later: { minHeight: 44, minWidth: 56, alignItems: "center", justifyContent: "center", borderRadius: radius.sm }, laterText: { color: colors.textDim, fontWeight: "700", fontSize: 13 },
  progress: { width: "100%", maxWidth: 648, alignSelf: "center", paddingHorizontal: space(4), paddingTop: space(4), paddingBottom: space(2) },
  kicker: { fontFamily: mono, fontSize: 10, color: colors.amber, fontWeight: "800", letterSpacing: 1.5 }, progressBars: { flexDirection: "row", gap: 6, marginTop: space(2) }, progressBar: { flex: 1, height: 3, backgroundColor: colors.line, borderRadius: radius.pill }, progressOn: { backgroundColor: colors.amber },
  content: { width: "100%", maxWidth: 648, alignSelf: "center", paddingHorizontal: space(4), paddingTop: space(3), paddingBottom: space(6) },
  title: { fontFamily: displayFont, fontSize: 30, lineHeight: 36, color: colors.text, fontWeight: "900", letterSpacing: -0.7 }, subtitle: { fontSize: 14, lineHeight: 21, color: colors.textDim, marginTop: space(2), marginBottom: space(4) },
  profileCard: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: "hidden", ...shadow.card },
  trim: { height: 4, flexDirection: "row" }, trimAmber: { flex: 2, backgroundColor: colors.amberStrong }, trimPink: { flex: 1, backgroundColor: colors.magenta }, trimBlue: { flex: 1, backgroundColor: colors.cool },
  banner: { height: 156, backgroundColor: colors.surfaceAlt, justifyContent: "flex-end", alignItems: "flex-end", padding: space(3) },
  bannerArt: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", overflow: "hidden" }, bannerSlogan: { position: "absolute", left: 14, top: 16, fontFamily: mono, color: colors.textFaint, fontSize: 9, letterSpacing: 1.3 },
  bannerAction: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: "rgba(7,9,15,0.85)" }, bannerActionText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  identity: { flexDirection: "row", alignItems: "center", gap: space(3), padding: space(4), borderTopWidth: 1, borderTopColor: colors.line }, avatarButton: { width: 76, height: 78, borderRadius: 38 }, camera: { position: "absolute", right: 0, bottom: 0, width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: colors.surface, backgroundColor: colors.bgElev, alignItems: "center", justifyContent: "center" },
  identityText: { flex: 1, minWidth: 0 }, name: { fontFamily: displayFont, fontSize: 20, color: colors.text, fontWeight: "900" }, handlePreview: { color: colors.textDim, fontSize: 13, marginTop: 2 }, photoHint: { color: colors.textFaint, fontSize: 10, marginTop: 7 },
  removeRow: { paddingHorizontal: space(4), paddingBottom: space(2), flexDirection: "row", flexWrap: "wrap", gap: space(2) }, remove: { minHeight: 44, justifyContent: "center" }, removeText: { color: colors.textDim, fontSize: 12, textDecorationLine: "underline" },
  label: { fontFamily: mono, color: colors.textFaint, fontSize: 10, letterSpacing: 1.4, marginTop: space(5), marginBottom: space(2) }, handleRow: { flexDirection: "row", alignItems: "center", minHeight: 52, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, paddingHorizontal: 14 }, at: { color: colors.textDim, fontSize: 16 }, input: { flex: 1, minWidth: 0, color: colors.text, fontSize: 16, paddingVertical: 13 }, invalid: { borderColor: colors.danger },
  hint: { fontSize: 12, lineHeight: 18, color: colors.textFaint, marginTop: space(2) }, privacy: { flexDirection: "row", gap: space(2), marginTop: space(4) }, privacyText: { flex: 1, color: colors.textFaint, fontSize: 12, lineHeight: 18 }, savedNote: { fontSize: 12, lineHeight: 18, color: colors.textDim, marginTop: space(5) },
  discard: { marginTop: space(4), padding: space(4), borderRadius: radius.md, borderWidth: 1, borderColor: colors.amber, backgroundColor: colors.surface, gap: space(3) }, discardTitle: { fontFamily: displayFont, fontSize: 18, fontWeight: "900", color: colors.text },
  error: { color: colors.danger, borderColor: colors.danger, borderWidth: 1, borderRadius: radius.sm, padding: space(3), fontSize: 13, lineHeight: 19, marginTop: space(3) }, status: { color: colors.good, fontSize: 13, lineHeight: 19, marginTop: space(3) },
  footer: { borderTopWidth: 1, borderTopColor: colors.lineSoft, backgroundColor: colors.bg }, footerInner: { width: "100%", maxWidth: 648, alignSelf: "center", paddingHorizontal: space(4), paddingTop: space(3), flexDirection: "row", gap: space(3) }, back: { flex: 1 }, next: { flex: 2 },
});
