import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import Avatar from "../components/Avatar";
import BrandMark from "../components/BrandMark";
import Button from "../components/Button";
import Icon from "../components/Icon";
import { cleanHandle, isHandle } from "../domain/validation.mjs";
import { profileImagePickerOptions, profileImageSelectionHint } from "../domain/profileImagePolicy.mjs";
import { isDurableMediaUrl, reportMediaPickerError, uploadMediaAsset } from "../lib/mediaUpload";
import { useStore } from "../store";
import { colors, displayFont, focusRing, mono, radius, shadow, space } from "../theme";

const TOTAL_STEPS = 3;
const BANNER_PICKER_HINT = profileImageSelectionHint("banner");

function normalizeStep(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.max(1, Math.min(TOTAL_STEPS, parsed)) : 1;
}

function readableError(error, fallback) {
  const message = typeof error === "string" ? error : error?.userMessage || error?.message;
  return String(message || fallback).trim().slice(0, 280);
}

function normalizedBanner(value) {
  return isDurableMediaUrl(value) ? value : null;
}

function profileInitials(name) {
  return (String(name || "").match(/\p{L}|\p{N}/gu) || ["?"]).slice(0, 2).join("").toUpperCase();
}

/**
 * A small post-verification signup walkthrough. App owns routing and the
 * durable onboarding-version mutation. The optional save override keeps this
 * screen easy to exercise without duplicating the profile API.
 */
export default function SignupOnboardingScreen({
  session,
  initialStep = 1,
  onComplete,
  onSkip,
  onSaveProfile,
}) {
  const { updateProfile } = useStore();
  const saveProfile = onSaveProfile || updateProfile;
  const scrollRef = useRef(null);
  const mountedRef = useRef(true);
  const sessionIdRef = useRef(session?.id || null);
  sessionIdRef.current = session?.id || null;

  const initialHandle = cleanHandle(session?.handle || "");
  const initialBanner = normalizedBanner(session?.banner);
  const [step, setStep] = useState(() => normalizeStep(initialStep));
  const [handle, setHandle] = useState(initialHandle);
  const [confirmedHandle, setConfirmedHandle] = useState(initialHandle);
  const [handleLocked, setHandleLocked] = useState(false);
  const [handleTouched, setHandleTouched] = useState(false);
  const [handleFocused, setHandleFocused] = useState(false);
  const [banner, setBanner] = useState(initialBanner);
  const [confirmedBanner, setConfirmedBanner] = useState(initialBanner);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [openArtistsAfterFinish, setOpenArtistsAfterFinish] = useState(false);
  const [exitMode, setExitMode] = useState(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => () => { mountedRef.current = false; }, []);

  // Never carry choices or late async results into a replacement cookie-backed
  // account on a shared browser.
  useEffect(() => {
    const nextHandle = cleanHandle(session?.handle || "");
    const nextBanner = normalizedBanner(session?.banner);
    setStep(normalizeStep(initialStep));
    setHandle(nextHandle);
    setConfirmedHandle(nextHandle);
    setHandleLocked(false);
    setHandleTouched(false);
    setBanner(nextBanner);
    setConfirmedBanner(nextBanner);
    setUploadingBanner(false);
    setSavingProfile(false);
    setOpenArtistsAfterFinish(false);
    setExitMode(null);
    setError("");
    setStatus("");
  }, [initialStep, session?.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo?.({ y: 0, animated: false });
    setError("");
    setStatus("");
  }, [step]);

  const firstName = String(session?.name || "there").trim().split(/\s+/)[0] || "there";
  const previewUser = useMemo(() => ({
    ...session,
    name: session?.name || "New member",
    initials: session?.initials || profileInitials(session?.name),
  }), [session]);
  const handleChanged = handle !== confirmedHandle;
  const bannerChanged = banner !== confirmedBanner;
  const handleInvalid = handleTouched && !isHandle(handle);
  const busy = uploadingBanner || savingProfile || !!exitMode;

  const pickBanner = async () => {
    if (busy) return;
    if (!session?.id || session.emailVerified !== true) {
      setError("Verify your email and sign in again before adding a banner.");
      return;
    }
    const accountId = String(session.id);
    setError("");
    setStatus("");
    let result;
    try {
      result = await ImagePicker.launchImageLibraryAsync(
        profileImagePickerOptions("banner", { platform: Platform.OS }),
      );
    } catch (pickerError) {
      const captured = reportMediaPickerError(pickerError, "Opening the profile banner photo library");
      if (mountedRef.current && sessionIdRef.current === accountId) {
        setError(readableError(captured || pickerError, "Your photo library could not open. Try again."));
      }
      return;
    }
    if (!result || result.canceled || !result.assets?.[0]) return;
    if (!mountedRef.current || sessionIdRef.current !== accountId) return;
    setUploadingBanner(true);
    try {
      const uploaded = await uploadMediaAsset(result.assets[0], "banner");
      if (!mountedRef.current || sessionIdRef.current !== accountId) return;
      setBanner(uploaded);
      setStatus("Banner added. Continue to save it to your profile.");
    } catch (uploadError) {
      if (mountedRef.current && sessionIdRef.current === accountId) {
        setError(readableError(uploadError, "Your banner could not be uploaded. Your profile is unchanged."));
      }
    } finally {
      if (mountedRef.current && sessionIdRef.current === accountId) setUploadingBanner(false);
    }
  };

  const saveProfileAndContinue = async () => {
    if (busy) return;
    setHandleTouched(true);
    setError("");
    setStatus("");
    if (!session?.id || session.emailVerified !== true) {
      setError("Verify your email and sign in again before saving your profile.");
      return;
    }
    const requestedHandle = cleanHandle(handle);
    if (!isHandle(requestedHandle)) {
      setError("Enter 3 to 20 letters, numbers, or underscores for your @username.");
      return;
    }
    const patch = {
      ...(handleChanged ? { handle: requestedHandle } : {}),
      ...(bannerChanged ? { banner } : {}),
    };
    if (!Object.keys(patch).length) {
      setStep(2);
      return;
    }

    const accountId = String(session.id);
    setSavingProfile(true);
    try {
      const result = await Promise.resolve(saveProfile(patch));
      if (!mountedRef.current || sessionIdRef.current !== accountId) return;
      if (result?.ok !== true) {
        setError(readableError(result?.error, "Mshpit could not save your profile. Your changes are still here."));
        return;
      }

      // Availability comes only from the authoritative response. The screen
      // never labels a locally inspected username as available.
      const confirmedUser = result?.user;
      if (!confirmedUser) {
        setError("Mshpit could not confirm the profile save. Try again before continuing.");
        return;
      }
      if (patch.handle && cleanHandle(confirmedUser.handle || "") !== requestedHandle) {
        setError("That @username was not saved. Try another one or keep your current username.");
        return;
      }
      if (bannerChanged && normalizedBanner(confirmedUser.banner) !== normalizedBanner(banner)) {
        setError("Mshpit could not confirm your banner. Try saving it again.");
        return;
      }

      const savedHandle = cleanHandle(confirmedUser.handle || requestedHandle);
      const savedBanner = normalizedBanner(confirmedUser.banner);
      setHandle(savedHandle);
      setConfirmedHandle(savedHandle);
      setBanner(savedBanner);
      setConfirmedBanner(savedBanner);
      // A successful change starts the server cooldown. Do not invite a second
      // change if the member taps Back during this walkthrough.
      setHandleLocked(!!patch.handle);
      setStep(2);
    } catch (saveError) {
      if (mountedRef.current && sessionIdRef.current === accountId) {
        setError(readableError(saveError, "Mshpit could not save your profile. Your changes are still here."));
      }
    } finally {
      if (mountedRef.current && sessionIdRef.current === accountId) setSavingProfile(false);
    }
  };

  const finishOrSkip = async (mode) => {
    if (busy) return;
    // onComplete owns the server-backed onboarding version. onSkip is a
    // compatibility fallback for an integrating parent that has not combined
    // dismissal and persistence yet.
    const callback = onComplete || (mode === "skip" ? onSkip : null);
    if (typeof callback !== "function") {
      setError("Mshpit could not finish setup. Try again.");
      return;
    }
    const accountId = sessionIdRef.current;
    setError("");
    setStatus("");
    setExitMode(mode);
    try {
      const result = await Promise.resolve(callback({
        openArtistPicker: mode === "finish" ? openArtistsAfterFinish : false,
      }));
      if (!mountedRef.current || sessionIdRef.current !== accountId) return;
      if (result?.ok === false) {
        setError(readableError(result.error, "Mshpit could not finish setup. Try again."));
      }
    } catch (completionError) {
      if (mountedRef.current && sessionIdRef.current === accountId) {
        setError(readableError(completionError, "Mshpit could not finish setup. Try again."));
      }
    } finally {
      if (mountedRef.current && sessionIdRef.current === accountId) setExitMode(null);
    }
  };

  const goBack = () => {
    if (busy || step <= 1) return;
    setStep((current) => Math.max(1, current - 1));
  };

  const goForward = () => {
    if (step === 1) void saveProfileAndContinue();
    else if (step === 2) setStep(3);
    else void finishOrSkip("finish");
  };

  return (
    <View style={styles.safe} accessibilityViewIsModal>
      <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <View style={styles.headerInner}>
            <View style={styles.brand} accessibilityRole="text" accessibilityLabel="Mshpit, live music remembered">
              <BrandMark size={30} color={colors.amber} />
              <View>
                <Text style={styles.brandName}>MSHPIT</Text>
                <Text style={styles.brandLine}>LIVE MUSIC, REMEMBERED</Text>
              </View>
            </View>
            <Pressable
              onPress={() => void finishOrSkip("skip")}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={exitMode === "skip" ? "Skipping setup" : "Skip setup"}
              accessibilityState={{ disabled: busy, busy: exitMode === "skip" }}
              style={({ pressed, focused }) => [
                styles.skip,
                focused && focusRing,
                pressed && !busy && styles.controlPressed,
                busy && styles.disabled,
              ]}
            >
              <Text style={styles.skipText}>{exitMode === "skip" ? "Skipping..." : "Skip"}</Text>
            </Pressable>
          </View>
        </View>

        <View
          style={styles.progress}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="Signup setup progress"
          accessibilityValue={{ min: 1, max: TOTAL_STEPS, now: step, text: "Step " + step + " of " + TOTAL_STEPS }}
        >
          <View style={styles.progressMeta}>
            <Text style={styles.progressText}>STEP {step} OF {TOTAL_STEPS}</Text>
            <Text style={styles.progressName}>{step === 1 ? "Profile" : step === 2 ? "Artists" : "Ready"}</Text>
          </View>
          <View style={styles.progressBars}>
            {Array.from({ length: TOTAL_STEPS }, (_, index) => (
              <View key={index} style={[styles.progressBar, index < step && styles.progressBarOn]} />
            ))}
          </View>
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
        >
          {step === 1 ? (
            <View>
              <Text style={styles.kicker}>MAKE YOUR PROFILE</Text>
              <Text style={styles.title} accessibilityRole="header" accessibilityLiveRegion="polite">Make it yours, {firstName}.</Text>
              <Text style={styles.subtitle}>Choose the @username people will see. A banner is optional.</Text>

              <View style={styles.profileCard}>
                <Pressable
                  onPress={() => void pickBanner()}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={banner ? "Change profile banner" : "Add a profile banner"}
                  accessibilityHint={BANNER_PICKER_HINT}
                  accessibilityState={{ disabled: busy, busy: uploadingBanner }}
                  style={({ pressed, focused }) => [
                    styles.banner,
                    focused && focusRing,
                    pressed && !busy && styles.bannerPressed,
                    busy && styles.bannerDisabled,
                  ]}
                >
                  {banner ? (
                    <Image source={{ uri: banner }} style={StyleSheet.absoluteFillObject} resizeMode="cover" accessible={false} />
                  ) : null}
                  <View style={[StyleSheet.absoluteFillObject, styles.bannerShade]} />
                  <View style={styles.bannerAction}>
                    {uploadingBanner
                      ? <ActivityIndicator size="small" color="#FFFFFF" />
                      : <Icon name="camera" size={18} color="#FFFFFF" />}
                    <Text style={styles.bannerActionText}>
                      {uploadingBanner ? "Uploading..." : banner ? "Change banner" : "Add a banner"}
                    </Text>
                  </View>
                </Pressable>
                <View style={styles.profileIdentity}>
                  <Avatar user={previewUser} size={64} priority="high" />
                  <View style={styles.profileIdentityText}>
                    <Text style={styles.previewName} numberOfLines={1}>{previewUser.name}</Text>
                    <Text style={styles.previewHandle} numberOfLines={1}>@{handle || "username"}</Text>
                  </View>
                </View>
              </View>

              <Text style={styles.label}>USERNAME</Text>
              <View style={[
                styles.handleRow,
                handleFocused && styles.handleRowFocused,
                handleInvalid && styles.handleRowError,
                handleLocked && styles.handleRowLocked,
              ]}>
                <Text style={styles.at}>@</Text>
                <TextInput
                  style={styles.handleInput}
                  value={handle}
                  onChangeText={(value) => {
                    setHandle(cleanHandle(value));
                    setHandleTouched(true);
                    setError("");
                    setStatus("");
                  }}
                  onFocus={() => setHandleFocused(true)}
                  onBlur={() => { setHandleFocused(false); setHandleTouched(true); }}
                  onSubmitEditing={() => void saveProfileAndContinue()}
                  editable={!busy && !handleLocked}
                  placeholder="username"
                  placeholderTextColor={colors.textFaint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  textContentType="username"
                  returnKeyType="done"
                  maxLength={20}
                  accessibilityLabel="Username"
                  accessibilityHint="Use 3 to 20 letters, numbers, or underscores. Availability is checked when you continue."
                  accessibilityState={{ disabled: busy || handleLocked }}
                  aria-invalid={handleInvalid}
                />
                {handleLocked ? <Icon name="check" size={17} color={colors.good} /> : null}
              </View>
              <Text style={[styles.fieldHint, handleInvalid && styles.fieldHintError]}>
                {handleLocked
                  ? "Saved as @" + handle + ". You can change it later from Edit profile when the username cooldown ends."
                  : "Use 3–20 letters, numbers, or underscores. We check it when you continue. After changing it, you’ll wait 10 business days to change it again."}
              </Text>
            </View>
          ) : null}

          {step === 2 ? (
            <View>
              <Text style={styles.kicker}>TUNE YOUR FEED</Text>
              <Text style={styles.title} accessibilityRole="header" accessibilityLiveRegion="polite">Pick artists you like.</Text>
              <Text style={styles.subtitle}>Following artists puts their shows and fan posts closer to the top. You can change this anytime.</Text>
              <View style={styles.infoCard}>
                <InfoRow icon="music" title="A feed that sounds like you" detail="Your choices help rank posts and recommendations." />
                <InfoRow icon="calendar" title="Upcoming dates" detail="See concerts from artists you follow sooner." />
                <InfoRow icon="user-plus" title="Find other fans" detail="Discover people who show up for the same music." last />
              </View>
              <Pressable
                onPress={() => setOpenArtistsAfterFinish((current) => !current)}
                disabled={busy}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: openArtistsAfterFinish, disabled: busy }}
                accessibilityLabel="Choose artists after this walkthrough"
                accessibilityHint="When selected, the artist picker opens after setup is saved."
                style={({ pressed, focused }) => [
                  styles.artistChoice,
                  openArtistsAfterFinish && styles.artistChoiceOn,
                  focused && focusRing,
                  pressed && !busy && styles.controlPressed,
                  busy && styles.disabled,
                ]}
              >
                <View style={[styles.choiceBox, openArtistsAfterFinish && styles.choiceBoxOn]}>
                  {openArtistsAfterFinish ? <Icon name="check" size={17} color="#1A1206" /> : null}
                </View>
                <View style={styles.choiceCopy}>
                  <Text style={styles.choiceTitle}>Choose artists after this walkthrough</Text>
                  <Text style={styles.choiceDetail}>We’ll open the artist picker after setup is saved.</Text>
                </View>
              </Pressable>
              <Text style={styles.optionalNote}>Optional. You can also do this later from Edit profile.</Text>
            </View>
          ) : null}

          {step === 3 ? (
            <View>
              <Text style={styles.kicker}>HOW IT WORKS</Text>
              <Text style={styles.title} accessibilityRole="header" accessibilityLiveRegion="polite">You’re ready.</Text>
              <Text style={styles.subtitle}>The whole app in three quick moves.</Text>
              <View style={styles.infoCard}>
                <InfoRow number="1" title="Find a show" detail="Search artists, venues, or concerts near you." />
                <InfoRow number="2" title="Make plans" detail="Tap Interested or Going and keep the date close." />
                <InfoRow number="3" title="Remember the night" detail="Add a rating, words, photos, or video—then find more fans." last />
              </View>
              <View style={styles.readyCard}>
                <BrandMark size={42} color={colors.amber} />
                <View style={styles.readyText}>
                  <Text style={styles.readyTitle}>Start wherever you want.</Text>
                  <Text style={styles.readyDetail}>Nothing else has to be filled out before you explore.</Text>
                </View>
              </View>
            </View>
          ) : null}

          {!!error ? (
            <Text
              style={styles.error}
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
              role="alert"
              selectable
            >
              {error}
            </Text>
          ) : null}
          {!!status ? (
            <Text style={styles.status} accessibilityLiveRegion="polite" role="status">{status}</Text>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <View style={styles.footerInner}>
            {step > 1 ? (
              <Button
                title="Back"
                icon="chevron-left"
                variant="secondary"
                onPress={goBack}
                disabled={busy}
                accessibilityLabel={"Back to step " + (step - 1)}
                style={styles.footerButton}
              />
            ) : null}
            <Button
              title={step === 1
                ? (savingProfile ? "Saving profile..." : "Save and continue")
                : step === TOTAL_STEPS
                  ? (exitMode === "finish" ? "Finishing..." : "Start exploring")
                  : "Continue"}
              icon={step === TOTAL_STEPS ? "check" : "chevron-right"}
              onPress={goForward}
              loading={savingProfile || exitMode === "finish"}
              disabled={busy && !savingProfile && exitMode !== "finish"}
              accessibilityLabel={step === 1
                ? "Save profile and continue"
                : step === TOTAL_STEPS
                  ? "Finish setup and start exploring"
                  : "Continue to how Mshpit works"}
              style={styles.footerButton}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function InfoRow({ icon, number, title, detail, last = false }) {
  return (
    <View style={[styles.infoRow, last && styles.infoRowLast]}>
      <View style={styles.infoIcon}>
        {number ? <Text style={styles.infoNumber}>{number}</Text> : <Icon name={icon} size={19} color={colors.amber} />}
      </View>
      <View style={styles.infoCopy}>
        <Text style={styles.infoTitle}>{title}</Text>
        <Text style={styles.infoDetail}>{detail}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  keyboard: { flex: 1 },
  header: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  headerInner: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    minHeight: 62,
    paddingHorizontal: space(4),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space(3),
  },
  brand: { flexDirection: "row", alignItems: "center", gap: space(2.5) },
  brandName: { color: colors.text, fontFamily: mono, fontSize: 13, fontWeight: "900", letterSpacing: 2.8 },
  brandLine: { color: colors.textFaint, fontFamily: mono, fontSize: 7, fontWeight: "800", letterSpacing: 1.4, marginTop: 2 },
  skip: {
    minHeight: 44,
    minWidth: 58,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
  },
  skipText: { color: colors.textDim, fontSize: 14, fontWeight: "700" },
  progress: {
    width: "100%",
    maxWidth: 728,
    alignSelf: "center",
    paddingHorizontal: space(4),
    paddingTop: space(3),
    paddingBottom: space(2),
  },
  progressMeta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space(2) },
  progressText: { color: colors.amber, fontFamily: mono, fontSize: 9.5, fontWeight: "900", letterSpacing: 1.5 },
  progressName: { color: colors.textFaint, fontSize: 12, fontWeight: "700" },
  progressBars: { flexDirection: "row", gap: 6 },
  progressBar: { flex: 1, height: 4, borderRadius: radius.pill, backgroundColor: colors.line },
  progressBarOn: { backgroundColor: colors.amberStrong },
  scroll: { flex: 1 },
  content: {
    width: "100%",
    maxWidth: 680,
    alignSelf: "center",
    paddingHorizontal: space(4),
    paddingTop: space(3),
    paddingBottom: space(6),
  },
  kicker: { color: colors.amber, fontFamily: mono, fontSize: 10, fontWeight: "900", letterSpacing: 2.4 },
  title: {
    color: colors.text,
    fontFamily: displayFont,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "900",
    letterSpacing: -0.6,
    marginTop: space(2),
  },
  subtitle: { color: colors.textDim, fontSize: 14.5, lineHeight: 21, marginTop: space(1.5), marginBottom: space(4) },
  profileCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    overflow: "hidden",
    ...shadow.card,
  },
  banner: { height: 128, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  bannerShade: { backgroundColor: "rgba(7,9,15,0.34)" },
  bannerPressed: { opacity: 0.84 },
  bannerDisabled: { opacity: 0.72 },
  bannerAction: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: "rgba(7,9,15,0.76)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  bannerActionText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  profileIdentity: { flexDirection: "row", alignItems: "center", gap: space(3), padding: space(4) },
  profileIdentityText: { flex: 1, minWidth: 0 },
  previewName: { color: colors.text, fontFamily: displayFont, fontSize: 18, fontWeight: "900" },
  previewHandle: { color: colors.textDim, fontSize: 13.5, marginTop: 2 },
  label: {
    color: colors.textFaint,
    fontFamily: mono,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.5,
    marginTop: space(5),
    marginBottom: space(2),
  },
  handleRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 14,
  },
  handleRowFocused: { borderColor: colors.amber, ...focusRing },
  handleRowError: { borderColor: colors.danger },
  handleRowLocked: { backgroundColor: colors.surfaceAlt },
  at: { color: colors.textDim, fontSize: 16, fontWeight: "800", marginRight: 2 },
  handleInput: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: 16,
    paddingVertical: 13,
  },
  fieldHint: { color: colors.textFaint, fontSize: 12, lineHeight: 17, marginTop: space(2) },
  fieldHintError: { color: colors.danger },
  infoCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    paddingHorizontal: space(4),
    ...shadow.card,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space(3),
    paddingVertical: space(4),
    borderBottomWidth: 1,
    borderBottomColor: colors.lineSoft,
  },
  infoRowLast: { borderBottomWidth: 0 },
  infoIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bgElev,
    borderWidth: 1,
    borderColor: colors.line,
  },
  infoNumber: { color: colors.amber, fontFamily: mono, fontSize: 13, fontWeight: "900" },
  infoCopy: { flex: 1, minWidth: 0 },
  infoTitle: { color: colors.text, fontFamily: displayFont, fontSize: 15, fontWeight: "900" },
  infoDetail: { color: colors.textDim, fontSize: 13, lineHeight: 18, marginTop: 3 },
  artistChoice: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: space(3),
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderBottomWidth: 3,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: space(4),
    paddingVertical: space(3),
    marginTop: space(4),
    ...shadow.control,
  },
  artistChoiceOn: { borderColor: colors.amber, backgroundColor: colors.bgElev },
  choiceBox: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  choiceBoxOn: { borderColor: colors.amber, backgroundColor: colors.amberStrong },
  choiceCopy: { flex: 1, minWidth: 0 },
  choiceTitle: { color: colors.text, fontFamily: displayFont, fontSize: 14, fontWeight: "900" },
  choiceDetail: { color: colors.textDim, fontSize: 12, lineHeight: 17, marginTop: 2 },
  optionalNote: { color: colors.textFaint, fontSize: 12.5, lineHeight: 18, textAlign: "center", marginTop: space(2.5) },
  readyCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(3),
    backgroundColor: colors.bgElev,
    borderWidth: 1,
    borderColor: colors.amber,
    borderRadius: radius.md,
    padding: space(4),
    marginTop: space(4),
  },
  readyText: { flex: 1, minWidth: 0 },
  readyTitle: { color: colors.text, fontFamily: displayFont, fontSize: 15, fontWeight: "900" },
  readyDetail: { color: colors.textDim, fontSize: 12.5, lineHeight: 18, marginTop: 2 },
  error: {
    color: colors.danger,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.sm,
    padding: 12,
    fontSize: 13,
    lineHeight: 19,
    marginTop: space(4),
  },
  status: { color: colors.good, fontSize: 13, lineHeight: 19, marginTop: space(3), textAlign: "center" },
  footer: { borderTopWidth: 1, borderTopColor: colors.lineSoft, backgroundColor: colors.bg },
  footerInner: {
    width: "100%",
    maxWidth: 680,
    alignSelf: "center",
    flexDirection: "row",
    gap: space(3),
    paddingHorizontal: space(4),
    paddingTop: space(3),
    paddingBottom: space(3),
  },
  footerButton: { flex: 1 },
  controlPressed: { opacity: 0.72 },
  disabled: { opacity: 0.5 },
});
