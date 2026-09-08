import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, displayFont, focusRing, mono, radius, shadow, space } from "../theme";
import { useStore } from "../store";
import Icon from "../components/Icon";
import BrandMark from "../components/BrandMark";
import SheetHeader from "../components/SheetHeader";
import LocationPicker from "../components/LocationPicker";
import PrivacyScreen from "./PrivacyScreen";
import TermsScreen from "./TermsScreen";
import { PROFILE_GENRE_MAX, PROFILE_GENRE_OPTIONS } from "../domain/genrePreferences.mjs";
import { cleanHandle, isEmail } from "../domain/validation.mjs";
import { signupAccountError, signupAriaProps, signupFormPayload, signupHandlePresentation, signupMusicError } from "../domain/signupForm.mjs";
import { useSignupHandleAvailability } from "../features/signupHandle/useSignupHandleAvailability";

const readableError = (error, fallback) => String(typeof error === "string" ? error : error?.userMessage || error?.message || fallback).slice(0, 280);
const controlStyle = (base, disabled = false) => ({ pressed, focused }) => [base, disabled && styles.disabled, pressed && !disabled && styles.pressed, focused && focusRing];

function AuthPressable({ accessibilityState = {}, disabled, ...props }) {
  const state = { ...accessibilityState, ...(disabled === undefined ? {} : { disabled: !!disabled }) };
  return <Pressable {...props} disabled={disabled} accessibilityState={state} {...signupAriaProps(Platform.OS, state)} />;
}

export default function AuthScreen({ onDone, onCancel, onModeChange, initialMode = "login", addAccount = false, initialEmail = "" }) {
  const { login, signup, forgotPassword, session } = useStore();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState(initialMode === "signup" ? "signup" : "login");
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [email, setEmail] = useState(addAccount ? session?.email || "" : initialEmail);
  const [currentPassword, setCurrentPassword] = useState("");
  const [accounts, setAccounts] = useState(null);
  const [signupChoice, setSignupChoice] = useState(null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [city, setCity] = useState(null);
  const [genres, setGenres] = useState([]);
  const [ageBand, setAgeBand] = useState(null);
  const [agreed, setAgreed] = useState(false);
  const [analyticsConsent, setAnalyticsConsent] = useState(false);
  const [analyticsDetails, setAnalyticsDetails] = useState(false);
  const [pickingCity, setPickingCity] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [sentTo, setSentTo] = useState(null);
  const [busyAction, setBusyAction] = useState(null);
  const [error, setError] = useState("");
  const [errorField, setErrorField] = useState(null);
  const mounted = useRef(true);
  const busyRef = useRef(false);
  const inputs = useRef({});
  const scroll = useRef(null);
  const heading = useRef(null);
  const errorRef = useRef(null);
  const signupMode = mode === "signup";
  const authBusy = busyAction === "auth";
  const resetBusy = busyAction === "reset";
  const busy = !!busyAction;
  const availability = useSignupHandleAvailability(handle, { enabled: signupMode && !signupChoice && !viewing && !pickingCity });
  const handleStatus = signupHandlePresentation(availability.resource, handle);
  const currentAvailability = availability.resource.status === "ready" ? availability.resource.data : null;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    scroll.current?.scrollTo?.({ y: 0, animated: false });
    if (!error) heading.current?.focus?.();
  }, [mode, step, signupChoice, sentTo, viewing, pickingCity]);
  useEffect(() => {
    if (!error) return;
    const target = inputs.current[errorField] || errorRef.current;
    target?.focus?.();
    if (!errorField || !inputs.current[errorField]) scroll.current?.scrollTo?.({ y: 0, animated: false });
  }, [error, errorField, step]);

  const clearError = () => { setError(""); setErrorField(null); };
  const showError = (failure) => { setError(failure.message); setErrorField(failure.field || null); };
  const changeMode = (next) => {
    if (busyRef.current) return;
    setAccounts(null); setSignupChoice(null); setPassword(""); setCurrentPassword("");
    setMode(next); setStep(1); setSentTo(null); setShowPassword(false); clearError();
    onModeChange?.(next);
  };
  const accountValues = () => ({ name, handle, email, password });
  const accountFailure = () => signupAccountError(accountValues(), currentAvailability)
    || (availability.resource.scope === cleanHandle(handle) && availability.resource.status === "error"
      && Number(availability.resource.error?.status) === 400 ? { field: "handle", message: handleStatus.message } : null);
  const advance = () => {
    if (addAccount && !currentPassword) { showError({ field: "currentPassword", message: "Enter the current account’s password to add another account." }); return; }
    const failure = accountFailure();
    if (failure) { showError(failure); return; }
    clearError(); setStep(2);
  };
  const submit = async (accountId, { createAdditional = false, useExisting = false } = {}) => {
    if (typeof accountId !== "string") accountId = undefined;
    if (busyRef.current) return;
    const creating = signupMode && !useExisting;
    if (creating && step === 1) { advance(); return; }
    if (creating) {
      const accountError = accountFailure();
      if (accountError) { setStep(1); showError(accountError); return; }
      const musicFailure = signupMusicError({ genres, ageBand, agreed });
      if (musicFailure) { showError(musicFailure); return; }
    } else if (!isEmail(email) || !password) {
      showError({ field: !isEmail(email) ? "email" : "password", message: !isEmail(email) ? "Enter a valid email address." : "Enter your password." });
      return;
    }
    clearError(); busyRef.current = true; setBusyAction("auth");
    try {
      const result = creating
        ? await signup({ ...signupFormPayload({ ...accountValues(), city, genres, ageBand, agreed, analyticsConsent }), ...(addAccount ? { addAccount, currentPassword } : {}), createAdditional })
        : await login(email.trim(), password, accountId);
      if (!mounted.current) return;
      if (result?.ok) {
        if (result.needsAccountChoice) { setSignupChoice(result); return; }
        if (result.chooseAccount) { setSignupChoice(null); setAccounts(result.accounts); return; }
        setPassword(""); setShowPassword(false);
        setAccounts(null); setCurrentPassword("");
        onDone?.(creating ? "signup" : "login");
      } else {
        const handleTaken = result?.error?.serverCode === "HANDLE_TAKEN" || result?.code === "HANDLE_TAKEN"
          || /username.*taken|handle.*taken/i.test(readableError(result?.error, ""));
        if (signupMode && handleTaken) { setStep(1); availability.retry(); }
        showError({ field: handleTaken ? "handle" : null, message: readableError(result?.error, "That request did not complete. Please try again.") });
      }
    } catch (failure) {
      if (mounted.current) showError({ message: readableError(failure, "Couldn't connect. Check your connection and try again.") });
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusyAction(null);
    }
  };
  const close = () => {
    if (busyRef.current) return;
    setPassword(""); setCurrentPassword(""); setAccounts(null); onCancel?.();
  };
  const sendReset = async () => {
    if (busyRef.current) return;
    if (!isEmail(email)) { showError({ field: "email", message: "Enter the email on your account." }); return; }
    const requestedEmail = email.trim();
    clearError(); busyRef.current = true; setBusyAction("reset");
    try {
      const result = await forgotPassword(requestedEmail);
      if (!mounted.current) return;
      if (result?.ok === false) showError({ message: readableError(result.error, "The reset request did not complete. Please try again.") });
      else setSentTo(requestedEmail);
    } catch (failure) {
      if (mounted.current) showError({ message: readableError(failure, "Couldn't request a reset link. Check your connection and try again.") });
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusyAction(null);
    }
  };
  const toggleGenre = (genre) => {
    if (genres.includes(genre)) { setGenres(genres.filter((value) => value !== genre)); clearError(); return; }
    if (genres.length >= PROFILE_GENRE_MAX) { showError({ field: "genres", message: "Choose up to 3 music genres." }); return; }
    setGenres([...genres, genre]); clearError();
  };

  // Inline readers and the location picker leave all form state mounted here.
  if (pickingCity) return <LocationPicker onClose={() => setPickingCity(false)} onSelect={(place) => { setCity(place); setPickingCity(false); }} />;
  if (viewing === "terms") return <TermsScreen onClose={() => setViewing(null)} />;
  if (viewing === "privacy") return <PrivacyScreen onClose={() => setViewing(null)} />;

  const field = (key, label, value, change, options = {}) => (
    <View style={[styles.field, options.paired && styles.pairedField]} key={key}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={[styles.inputShell, errorField === key && styles.invalidInput]}>
        {key === "handle" ? <Text style={styles.handlePrefix}>@</Text> : null}
        <TextInput
          ref={(node) => { inputs.current[key] = node; }}
          style={styles.input} value={value} onChangeText={(next) => { change(next); setAccounts(null); clearError(); }}
          placeholder={options.placeholder} placeholderTextColor={colors.textFaint}
          autoCapitalize={key === "name" ? "words" : "none"} autoCorrect={false}
          autoComplete={options.autoComplete} textContentType={options.textContentType}
          keyboardType={key === "email" ? "email-address" : "default"}
          secureTextEntry={key === "currentPassword" || (key === "password" && !showPassword)}
          maxLength={options.maxLength || 120} editable={!busy && !(addAccount && key === "email")}
          returnKeyType={options.returnKeyType || "next"} onSubmitEditing={options.onSubmit}
          accessibilityLabel={label} accessibilityState={{ disabled: busy }}
          {...signupAriaProps(Platform.OS, { disabled: busy })}
          {...(Platform.OS === "web" ? { "aria-invalid": errorField === key } : {})}
        />
        {key === "password" ? <AuthPressable style={controlStyle(styles.passwordToggle, busy)} onPress={() => setShowPassword(!showPassword)} disabled={busy} accessibilityRole="button" accessibilityLabel={showPassword ? "Hide password" : "Show password"} accessibilityState={{ disabled: busy }}>
          <Text style={styles.link}>{showPassword ? "Hide" : "Show"}</Text>
        </AuthPressable> : null}
      </View>
      {options.hint ? <Text style={styles.hint}>{options.hint}</Text> : null}
    </View>
  );
  const primary = (label, onPress, loading = false) => <AuthPressable style={controlStyle(styles.primary, busy)} onPress={onPress} disabled={busy} accessibilityRole="button" accessibilityState={{ disabled: busy, busy: loading }}>
    {loading ? <ActivityIndicator size="small" color="#1A1206" /> : null}
    <Text style={styles.primaryText}>{label}</Text>
    {!loading ? <Icon name="chevron-right" size={18} color="#1A1206" /> : null}
  </AuthPressable>;
  const headingText = signupChoice || accounts ? "Choose your account." : mode === "forgot" ? sentTo ? "Check your email." : "Back to your account."
    : signupMode ? step === 1 ? "Make it your night." : "Find your kind of show." : "Good to see you.";
  const subheading = signupChoice || accounts ? "Choose which profile to open." : mode === "forgot" ? "A reset link gets you back in."
    : signupMode ? step === 1 ? "Start with your account details." : "Pick your music. We’ll take it from there." : "Your shows, photos and people are waiting.";
  const progress = { min: 1, max: 2, now: step, text: `Step ${step} of 2: ${step === 1 ? "Account" : "Music"}` };

  return <KeyboardAvoidingView style={[styles.wrap, { paddingTop: insets.top }]} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <SheetHeader title={mode === "forgot" ? "Reset password" : signupMode ? addAccount ? "Add account" : "Sign up" : "Log in"} onClose={close} leadDisabled={busy} />
    <ScrollView ref={scroll} contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}>
      <View style={styles.ticket}>
        <View style={styles.brandRow}><BrandMark size={30} color={colors.amber} /><View><Text style={styles.wordmark}>MSHPIT</Text><Text style={styles.slogan}>LIVE MUSIC, REMEMBERED</Text></View></View>
        <View style={styles.trim}><View style={styles.amberTrim} /><View style={styles.magentaTrim} /><View style={styles.coolTrim} /></View>
        <View style={styles.cardBody}>
          {signupMode && !signupChoice ? <View style={styles.stepper} accessibilityRole="progressbar" accessibilityLabel="Account creation progress" accessibilityValue={progress} {...signupAriaProps(Platform.OS, {}, progress)}>
            <Text style={styles.stepKicker}>STEP {step} OF 2</Text><Text style={styles.stepName}>{step === 1 ? "Account / Music next" : "Music / Almost there"}</Text>
          </View> : null}
          <Text ref={heading} tabIndex={-1} style={styles.title} accessibilityRole="header">{headingText}</Text>
          <Text style={styles.subtitle}>{subheading}</Text>
          {!!error ? <Text ref={errorRef} tabIndex={-1} style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive" selectable>{error}</Text> : null}

          {signupChoice ? <>
            <Text style={styles.subtitle}>{signupChoice.canCreate ? "An account already uses this email and password. Continue with it, or create your second account. Nothing has been changed." : "These credentials already belong to an account. Choose a profile below. Nothing has been changed."}</Text>
            {signupChoice.accounts.map((account) => <View key={account.id}>{primary(`Log in: ${account.name} · @${account.handle}`, () => void submit(account.id, { useExisting: true }))}</View>)}
            {signupChoice.canCreate ? primary("Create a second account", () => void submit(undefined, { createAdditional: true })) : <Text style={styles.hint}>This email has reached its two-account limit.</Text>}
            {primary("Use a different email", () => { setSignupChoice(null); setPassword(""); setStep(1); })}
          </> : accounts ? <>
            <Text style={styles.subtitle}>This password matches two accounts. Which one would you like to use?</Text>
            {accounts.map((account) => <View key={account.id}>{primary(`${account.name} · @${account.handle}`, () => void submit(account.id, { useExisting: true }))}</View>)}
            {primary("Use a different password", () => { setAccounts(null); setPassword(""); })}
          </> : mode === "forgot" ? sentTo ? <>
            <View style={styles.note}><Icon name="mail" size={19} color={colors.amber} /><Text style={styles.noteText} accessibilityLiveRegion="polite" role="status">If an account exists for {sentTo}, we’ve emailed a link to reset your password. It’s valid for 1 hour. Check spam if you don’t see it.</Text></View>
            {primary("Back to log in", () => changeMode("login"))}
          </> : <>
            {field("email", "Account email", email, setEmail, { autoComplete: "email", textContentType: "emailAddress", returnKeyType: "send", onSubmit: sendReset })}
            {primary(resetBusy ? "Sending…" : "Send reset link", sendReset, resetBusy)}
            <AuthPressable style={controlStyle(styles.textButton, busy)} onPress={() => changeMode("login")} disabled={busy} accessibilityRole="button"><Text style={styles.link}>Back to log in</Text></AuthPressable>
          </> : <>
            {(!signupMode || step === 1) ? <>
              {signupMode && addAccount ? <>{field("currentPassword", "Current account password", currentPassword, setCurrentPassword, { maxLength: 100, autoComplete: "current-password" })}<Text style={styles.hint}>Up to two accounts can use a verified email. Use the same password for a choice at login, or different passwords to sign straight into the matching account.</Text></> : null}
              {signupMode ? <View style={styles.fieldPair}>
                {field("name", "Name", name, setName, { paired: true, maxLength: 40, autoComplete: "name", textContentType: "name", onSubmit: () => inputs.current.handle?.focus?.() })}
                {field("handle", "Username", handle, (value) => setHandle(cleanHandle(value)), { paired: true, maxLength: 20, autoComplete: "username", textContentType: "username", onSubmit: () => inputs.current.email?.focus?.() })}
              </View> : null}
              {signupMode ? <View style={styles.availability} accessibilityLiveRegion="polite">
                <Text style={[styles.hint, handleStatus.tone === "good" && styles.availableText, handleStatus.tone === "error" && styles.errorText]}>{handleStatus.message}</Text>
                {availability.resource.status === "error" ? <AuthPressable onPress={availability.retry} style={controlStyle(styles.retry, busy)} disabled={busy} accessibilityRole="button" accessibilityLabel="Check username again" accessibilityState={{ disabled: busy }}><Text style={styles.link}>Try again</Text></AuthPressable> : null}
              </View> : null}
              {field("email", "Email", email, setEmail, { autoComplete: "email", textContentType: "emailAddress", onSubmit: () => inputs.current.password?.focus?.() })}
              {field("password", "Password", password, setPassword, { maxLength: 100, autoComplete: signupMode ? "new-password" : "current-password", textContentType: signupMode ? "newPassword" : "password", returnKeyType: signupMode ? "next" : "go", onSubmit: submit, hint: signupMode ? "8+ characters, with a letter and a number." : null })}
              {signupMode ? <View style={styles.nextStep}><Icon name="you" size={18} color={colors.amber} /><Text style={styles.noteText}>Explore as soon as you sign up. Add a profile photo and banner whenever you’re ready, after email confirmation.</Text></View>
                : <AuthPressable style={controlStyle(styles.forgotButton, busy)} onPress={() => changeMode("forgot")} disabled={busy} accessibilityRole="button"><Text style={styles.link}>Forgot password?</Text></AuthPressable>}
            </> : <>
              <View ref={(node) => { inputs.current.genres = node; }} tabIndex={-1} style={styles.section}>
                <View style={styles.sectionHeading}><Text style={styles.fieldLabel}>Music you like</Text><Text style={styles.count}>{genres.length}/3</Text></View>
                <Text style={styles.hint}>Choose 1–3 genres for your first recommendations.</Text>
                <View style={styles.genreChips}>{PROFILE_GENRE_OPTIONS.map((genre) => {
                  const selected = genres.includes(genre);
                  return <AuthPressable key={genre} style={({ pressed, focused }) => [styles.genreChip, selected && styles.selectedChip, pressed && styles.pressed, focused && focusRing]} onPress={() => toggleGenre(genre)} disabled={busy} accessibilityRole="checkbox" accessibilityLabel={genre} accessibilityState={{ checked: selected, disabled: busy }}>
                    <Text style={[styles.genreText, selected && styles.selectedText]}>{genre}</Text>{selected ? <Icon name="check" size={13} color={colors.amber} /> : null}
                  </AuthPressable>;
                })}</View>
              </View>
              <View style={styles.section}><View style={styles.sectionHeading}><Text style={styles.fieldLabel}>Your city</Text><Text style={styles.optional}>Optional</Text></View>
                <AuthPressable style={controlStyle(styles.cityPick, busy)} onPress={() => setPickingCity(true)} disabled={busy} accessibilityRole="button" accessibilityLabel={city ? `City, ${city.label}` : "Choose your city"} accessibilityHint="Shows nearby concerts and local posts" accessibilityState={{ disabled: busy }}>
                  <Icon name="pin" size={18} color={colors.amber} /><Text style={styles.cityText}>{city?.label || "Find shows near you"}</Text><Icon name="chevron-right" size={16} color={colors.textDim} />
                </AuthPressable>
                {city ? <AuthPressable style={controlStyle(styles.retry, busy)} onPress={() => setCity(null)} disabled={busy} accessibilityRole="button" accessibilityLabel="Remove selected city"><Text style={styles.link}>Not now</Text></AuthPressable> : null}
              </View>
              <View ref={(node) => { inputs.current.ageBand = node; }} tabIndex={-1} style={styles.section} accessibilityRole="radiogroup" accessibilityLabel="Age group">
                <Text style={styles.fieldLabel}>Age group</Text><Text style={styles.hint}>For account safety. No birth date needed.</Text>
                <View style={styles.ageChoices}>{[["13_17", "13–17"], ["18_plus", "18+"]].map(([value, label]) => <AuthPressable key={value} style={({ focused, pressed }) => [styles.ageChoice, ageBand === value && styles.selectedChip, pressed && styles.pressed, focused && focusRing]} onPress={() => { setAgeBand(value); clearError(); }} disabled={busy} accessibilityRole="radio" accessibilityState={{ checked: ageBand === value, disabled: busy }} accessibilityLabel={label}><Text style={[styles.genreText, ageBand === value && styles.selectedText]}>{label}</Text></AuthPressable>)}</View>
              </View>
              <View style={styles.consents}>
                <AuthPressable ref={(node) => { inputs.current.agreed = node; }} style={controlStyle(styles.consent, busy)} onPress={() => { setAgreed(!agreed); clearError(); }} disabled={busy} accessibilityRole="checkbox" accessibilityLabel="I agree to the Terms and Privacy policy" accessibilityState={{ checked: agreed, disabled: busy }}>
                  <View style={[styles.checkbox, agreed && styles.checked]}>{agreed ? <Icon name="check" size={14} color="#1A1206" strokeWidth={3} /> : null}</View><Text style={styles.consentText}>I agree to the Terms & Conditions and Privacy policy.</Text>
                </AuthPressable>
                <View style={styles.policyLinks}><AuthPressable style={controlStyle(styles.retry, busy)} onPress={() => setViewing("terms")} disabled={busy} accessibilityRole="button" accessibilityLabel="Read Terms"><Text style={styles.link}>Read Terms</Text></AuthPressable><AuthPressable style={controlStyle(styles.retry, busy)} onPress={() => setViewing("privacy")} disabled={busy} accessibilityRole="button" accessibilityLabel="Read Privacy policy"><Text style={styles.link}>Read Privacy policy</Text></AuthPressable></View>
                <AuthPressable style={controlStyle(styles.consent, busy)} onPress={() => setAnalyticsConsent(!analyticsConsent)} disabled={busy} accessibilityRole="checkbox" accessibilityLabel="Share optional limited account usage data" accessibilityState={{ checked: analyticsConsent, disabled: busy }}><View style={[styles.checkbox, analyticsConsent && styles.checked]}>{analyticsConsent ? <Icon name="check" size={14} color="#1A1206" strokeWidth={3} /> : null}</View><Text style={styles.consentText}>Optional: share limited account usage data to help improve Mshpit.</Text></AuthPressable>
                <AuthPressable style={controlStyle(styles.retry, busy)} onPress={() => setAnalyticsDetails(!analyticsDetails)} disabled={busy} accessibilityRole="button" accessibilityState={{ expanded: analyticsDetails }} accessibilityLabel="What usage data is shared"><Text style={styles.link}>{analyticsDetails ? "Hide details" : "What is shared?"}</Text></AuthPressable>
                {analyticsDetails ? <Text style={styles.hint}>We record limited usage events linked to your account. They do not include the contents of authored posts or reviews, search terms, messages, or uploaded media. IP addresses are not stored with these analytics events. Change your choice any time in Settings; opting out deletes your raw product events.</Text> : null}
              </View>
            </>}
            {primary(authBusy ? signupMode ? "Creating account…" : "Logging in…" : signupMode ? step === 1 ? "Continue to music" : "Create account" : "Log in", submit, authBusy)}
            {signupMode && step === 2 ? <AuthPressable style={controlStyle(styles.textButton, busy)} onPress={() => { clearError(); setStep(1); }} disabled={busy} accessibilityRole="button"><Text style={styles.link}>Back to account details</Text></AuthPressable> : null}
            <AuthPressable style={controlStyle(styles.textButton, busy)} onPress={() => changeMode(signupMode ? "login" : "signup")} disabled={busy} accessibilityRole="button"><Text style={styles.link}>{signupMode ? "Have an account? Log in" : "No account? Sign up"}</Text></AuthPressable>
          </>}
        </View>
        {mode !== "forgot" ? <View style={styles.ticketFooter}><Icon name="shield" size={16} color={colors.amber} /><Text style={styles.footerText}>Artist? Start with a personal account, then choose Claim artist profile. Every claim is reviewed.</Text></View> : null}
      </View>
    </ScrollView>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  content: { flexGrow: 1, padding: space(4), alignItems: "center" },
  ticket: { width: "100%", maxWidth: 640, minWidth: 0, borderRadius: radius.lg, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: "hidden", ...shadow.card },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 11, padding: space(4) },
  wordmark: { color: colors.text, fontFamily: mono, fontSize: 16, fontWeight: "900", letterSpacing: 3 },
  slogan: { color: colors.textFaint, fontFamily: mono, fontSize: 8, fontWeight: "700", letterSpacing: 1.3, marginTop: 4 },
  trim: { flexDirection: "row", height: 4 }, amberTrim: { flex: 2, backgroundColor: colors.amberStrong }, magentaTrim: { flex: 1, backgroundColor: colors.magenta }, coolTrim: { flex: 1, backgroundColor: colors.cool },
  cardBody: { padding: space(4), gap: 10, minWidth: 0 },
  stepper: { flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: 6, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.lineSoft, borderStyle: "dashed" },
  stepKicker: { color: colors.amber, fontFamily: mono, fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  stepName: { color: colors.textFaint, fontSize: 11 },
  title: { color: colors.text, fontFamily: displayFont, fontWeight: "900", fontSize: 29, lineHeight: 35, letterSpacing: -0.7, marginTop: 3 },
  subtitle: { color: colors.textDim, fontSize: 14, lineHeight: 20, marginBottom: 5 },
  fieldPair: { flexDirection: "row", flexWrap: "wrap", gap: 12 }, pairedField: { flexGrow: 1, flexBasis: 220, minWidth: 0 },
  field: { gap: 6, marginBottom: 3 }, fieldLabel: { color: colors.text, fontSize: 13, fontWeight: "800" },
  inputShell: { flexDirection: "row", alignItems: "center", minHeight: 48, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, backgroundColor: colors.bgElev, overflow: "hidden" },
  input: { flex: 1, minWidth: 0, color: colors.text, fontSize: 16, paddingHorizontal: 12, paddingVertical: 12 },
  handlePrefix: { color: colors.amber, fontFamily: mono, fontWeight: "800", fontSize: 17, paddingLeft: 12 },
  invalidInput: { borderColor: colors.danger }, passwordToggle: { width: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  hint: { color: colors.textDim, fontSize: 12, lineHeight: 17 }, availability: { minHeight: 22, gap: 3 }, availableText: { color: colors.good }, errorText: { color: colors.danger },
  section: { gap: 8, marginBottom: 6 }, sectionHeading: { flexDirection: "row", justifyContent: "space-between", gap: 8, alignItems: "center" },
  count: { color: colors.amber, fontFamily: mono, fontSize: 12, fontWeight: "800" }, optional: { color: colors.textFaint, fontSize: 11 },
  genreChips: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  genreChip: { minHeight: 44, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev },
  genreText: { color: colors.textDim, fontSize: 12.5, fontWeight: "700" }, selectedChip: { borderColor: colors.amber, backgroundColor: colors.surfaceAlt }, selectedText: { color: colors.amber, fontWeight: "900" },
  cityPick: { minHeight: 48, flexDirection: "row", gap: 9, alignItems: "center", padding: 12, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm }, cityText: { flex: 1, minWidth: 0, color: colors.textDim, fontSize: 13, lineHeight: 18 },
  ageChoices: { flexDirection: "row", gap: 10 }, ageChoice: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  consents: { borderTopWidth: 1, borderTopColor: colors.lineSoft, paddingTop: 10, gap: 2 },
  consent: { minHeight: 44, flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 8 },
  checkbox: { width: 22, height: 22, borderWidth: 1.5, borderColor: colors.line, borderRadius: 6, alignItems: "center", justifyContent: "center", flexShrink: 0 }, checked: { backgroundColor: colors.amberStrong, borderColor: colors.amberStrong },
  consentText: { flex: 1, minWidth: 0, color: colors.textDim, fontSize: 12.5, lineHeight: 18 },
  policyLinks: { flexDirection: "row", flexWrap: "wrap", columnGap: 16, paddingLeft: 32 },
  link: { color: colors.amber, fontSize: 12.5, fontWeight: "700" }, retry: { minHeight: 44, alignSelf: "flex-start", justifyContent: "center" },
  primary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, minHeight: 50, backgroundColor: colors.amberStrong, borderColor: colors.amber, borderBottomColor: colors.accentEdge, borderWidth: 1, borderBottomWidth: 3, borderRadius: radius.md, paddingHorizontal: 16, marginTop: 6, ...shadow.control },
  primaryText: { color: "#1A1206", fontFamily: displayFont, fontSize: 16, fontWeight: "900" },
  textButton: { minHeight: 44, justifyContent: "center", alignItems: "center" }, forgotButton: { minHeight: 44, alignSelf: "flex-end", justifyContent: "center" },
  error: { color: colors.danger, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.danger, borderRadius: radius.sm, padding: 12, fontSize: 13, lineHeight: 19 },
  note: { flexDirection: "row", gap: 10, paddingVertical: 8 }, noteText: { flex: 1, minWidth: 0, color: colors.textDim, fontSize: 12.5, lineHeight: 19 },
  nextStep: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 12, backgroundColor: colors.bgElev, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.lineSoft },
  ticketFooter: { flexDirection: "row", alignItems: "flex-start", gap: 10, borderTopWidth: 1, borderTopColor: colors.line, borderStyle: "dashed", padding: space(4), backgroundColor: colors.bgElev }, footerText: { flex: 1, minWidth: 0, color: colors.textFaint, fontSize: 11, lineHeight: 16 },
  disabled: { opacity: 0.5 }, pressed: { opacity: 0.82 },
});
