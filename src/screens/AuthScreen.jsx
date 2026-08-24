import { useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView } from "react-native";
import { colors, mono, radius } from "../theme";
import { useStore } from "../store";
import Icon from "../components/Icon";
import SheetHeader from "../components/SheetHeader";
import LocationPicker from "../components/LocationPicker";
import PrivacyScreen from "./PrivacyScreen";
import TermsScreen from "./TermsScreen";

export default function AuthScreen({ onDone, onCancel, initialMode = "login" }) {
  const { login, signup, forgotPassword } = useStore();
  const [mode, setMode] = useState(initialMode === "signup" ? "signup" : "login");
  const [sentTo, setSentTo] = useState(null); // email a reset link was requested for
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [city, setCity] = useState(null); // complete LocationPicker place identity
  const [pickingCity, setPickingCity] = useState(false);
  const [agreed, setAgreed] = useState(false); // signup: consent to Terms + Privacy
  const [analyticsConsent, setAnalyticsConsent] = useState(false); // optional, default off
  const [viewing, setViewing] = useState(null); // "terms" | "privacy", inline reader
  const [error, setError] = useState("");
  const [busyAction, setBusyAction] = useState(null); // "auth" | "reset"

  const authBusy = busyAction === "auth";
  const resetBusy = busyAction === "reset";

  const submit = async () => {
    if (busyAction) return;
    if (mode === "signup" && !agreed) {
      setError("Please agree to the Terms & Conditions and Privacy policy to create your account.");
      return;
    }
    setError("");
    setBusyAction("auth");
    try {
      const res = mode === "login"
        ? await login(email.trim(), password)
        : await signup({ name, email: email.trim(), password, city: city?.city, location: city, agreedToTerms: true, analyticsConsent });
      if (res?.ok) onDone?.(mode); // signup flows into the artist taste picker
      else setError(res?.error || "That request did not complete. Please try again.");
    } catch {
      setError("Couldn't connect. Check your connection and try again.");
    } finally {
      setBusyAction(null);
    }
  };

  if (pickingCity) {
    return (
      <LocationPicker
        onClose={() => setPickingCity(false)}
        onSelect={(place) => { setCity(place); setPickingCity(false); }}
      />
    );
  }

  // Let people actually read what they're agreeing to, without leaving sign-up.
  if (viewing === "terms") return <TermsScreen onClose={() => setViewing(null)} />;
  if (viewing === "privacy") return <PrivacyScreen onClose={() => setViewing(null)} />;

  const sendReset = async () => {
    if (busyAction) return;
    if (!email.trim()) { setError("Enter the email on your account."); return; }
    const requestedEmail = email.trim();
    setError("");
    setBusyAction("reset");
    try {
      const result = await forgotPassword(requestedEmail);
      if (result?.ok === false) setError(result?.error || "The reset request did not complete. Please try again.");
      else setSentTo(requestedEmail);
    } catch {
      setError("Couldn't request a reset link. Check your connection and try again.");
    } finally {
      setBusyAction(null);
    }
  };

  // Forgot-password view: request a reset link, then a neutral confirmation.
  if (mode === "forgot") {
    return (
      <View style={styles.wrap}>
        <SheetHeader title="Reset password" onClose={onCancel} />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.wordmark}>PIT</Text>
          {sentTo ? (
            <View>
              <Text style={[styles.tag, { marginBottom: 20 }]} accessibilityRole="header">Check your email</Text>
              <View style={styles.artistNote}>
                <Icon name="mail" size={16} color={colors.amber} />
                <Text style={styles.artistNoteTxt} accessibilityLiveRegion="polite" role="status">If an account exists for {sentTo}, we've emailed a link to reset your password. It's valid for 1 hour. Check spam if you don't see it.</Text>
              </View>
              <Pressable style={styles.primary} onPress={() => { setMode("login"); setSentTo(null); setError(""); }} accessibilityRole="button">
                <Text style={styles.primaryTxt}>BACK TO LOG IN</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Text style={[styles.tag, { marginBottom: 20 }]}>Enter your email and we'll send a reset link.</Text>
              <TextInput
                style={styles.input}
                placeholder="Email"
                placeholderTextColor={colors.textFaint}
                value={email}
                onChangeText={(value) => { setEmail(value); setError(""); }}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                keyboardType="email-address"
                returnKeyType="send"
                maxLength={120}
                onSubmitEditing={sendReset}
                editable={!resetBusy}
                accessibilityLabel="Account email"
                accessibilityState={{ disabled: resetBusy }}
              />
              {!!error && <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">{error}</Text>}
              <Pressable
                style={[styles.primary, resetBusy && styles.primaryOff]}
                onPress={sendReset}
                disabled={resetBusy}
                accessibilityRole="button"
                accessibilityState={{ disabled: resetBusy, busy: resetBusy }}
              >
                <Text style={styles.primaryTxt}>{resetBusy ? "SENDING..." : "SEND RESET LINK"}</Text>
              </Pressable>
              <Pressable style={styles.switchButton} onPress={() => { setMode("login"); setError(""); }} disabled={resetBusy} accessibilityRole="button" accessibilityState={{ disabled: resetBusy }}>
                <Text style={styles.switch}>Back to log in</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <SheetHeader title={mode === "login" ? "Log in" : "Sign up"} onClose={onCancel} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.wordmark}>PIT</Text>
        <Text style={styles.tag}>log the shows you go to</Text>

        {mode === "signup" && (
          <TextInput
            style={styles.input}
            placeholder="Name"
            placeholderTextColor={colors.textFaint}
            value={name}
            onChangeText={(value) => { setName(value); setError(""); }}
            autoComplete="name"
            textContentType="name"
            returnKeyType="next"
            maxLength={40}
            editable={!authBusy}
            accessibilityLabel="Name"
            accessibilityState={{ disabled: authBusy }}
          />
        )}
        {mode === "signup" && (
          <Pressable
            style={[styles.cityPick, authBusy && styles.primaryOff]}
            onPress={() => setPickingCity(true)}
            disabled={authBusy}
            accessibilityRole="button"
            accessibilityLabel={city ? `City, ${city.label}` : "Choose your city"}
            accessibilityHint="Sets the local feed for this account"
            accessibilityState={{ disabled: authBusy }}
          >
            <Icon name="pin" size={16} color={colors.amber} />
            <Text style={[styles.cityTxt, !city && styles.cityPlaceholder]}>{city ? city.label : "Your city (powers your local feed)"}</Text>
            <Icon name="chevron-right" size={16} color={colors.textDim} />
          </Pressable>
        )}
        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={colors.textFaint}
          value={email}
          onChangeText={(value) => { setEmail(value); setError(""); }}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          keyboardType="email-address"
          returnKeyType="next"
          maxLength={120}
          editable={!authBusy}
          accessibilityLabel="Email"
          accessibilityState={{ disabled: authBusy }}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={colors.textFaint}
          value={password}
          onChangeText={(value) => { setPassword(value); setError(""); }}
          secureTextEntry
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          textContentType={mode === "login" ? "password" : "newPassword"}
          returnKeyType="go"
          maxLength={100}
          editable={!authBusy}
          onSubmitEditing={submit}
          accessibilityLabel="Password"
          accessibilityState={{ disabled: authBusy }}
        />

        {mode === "signup" && (
          <Pressable
            style={styles.consent}
            onPress={() => { setAgreed((v) => !v); setError(""); }}
            disabled={authBusy}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: agreed, disabled: authBusy }}
            accessibilityLabel="I am 13 or older and agree to the Terms and Privacy policy"
          >
            <View style={[styles.box, agreed && styles.boxOn]}>
              {agreed ? <Icon name="check" size={14} color="#1A1206" strokeWidth={3} /> : null}
            </View>
            <Text style={styles.consentTxt}>
              I'm 13+ and agree to the{" "}
              <Text style={styles.link}>Terms & Conditions</Text> and Privacy policy. Use the links below to review them first.
            </Text>
          </Pressable>
        )}

        {mode === "signup" && (
          <View style={styles.policyLinks}>
            <Pressable style={styles.inlineLink} onPress={() => setViewing("terms")} disabled={authBusy} accessibilityRole="link" accessibilityState={{ disabled: authBusy }}><Text style={styles.link}>Read Terms</Text></Pressable>
            <Pressable style={styles.inlineLink} onPress={() => setViewing("privacy")} disabled={authBusy} accessibilityRole="link" accessibilityState={{ disabled: authBusy }}><Text style={styles.link}>Read Privacy policy</Text></Pressable>
          </View>
        )}

        {mode === "signup" && (
          <Pressable style={styles.consent} onPress={() => setAnalyticsConsent((value) => !value)} disabled={authBusy} accessibilityRole="checkbox" accessibilityState={{ checked: analyticsConsent, disabled: authBusy }} accessibilityLabel="Share optional privacy-filtered product analytics">
            <View style={[styles.box, analyticsConsent && styles.boxOn]}>
              {analyticsConsent ? <Icon name="check" size={14} color="#1A1206" strokeWidth={3} /> : null}
            </View>
            <Text style={styles.consentTxt}>Optional: share privacy-filtered product analytics so Pit can improve reliability and recommendations. You can change this any time in Settings.</Text>
          </Pressable>
        )}

        {mode === "login" && (
          <Pressable style={styles.forgotButton} onPress={() => { setMode("forgot"); setError(""); }} disabled={authBusy} accessibilityRole="button" accessibilityState={{ disabled: authBusy }}>
            <Text style={styles.forgot}>Forgot password?</Text>
          </Pressable>
        )}

        {!!error && <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">{error}</Text>}

        <Pressable
          style={[styles.primary, (authBusy || (mode === "signup" && !agreed)) && styles.primaryOff]}
          onPress={submit}
          disabled={authBusy || (mode === "signup" && !agreed)}
          accessibilityRole="button"
          accessibilityState={{ disabled: authBusy || (mode === "signup" && !agreed), busy: authBusy }}
        >
          <Text style={styles.primaryTxt}>{authBusy ? (mode === "login" ? "LOGGING IN..." : "CREATING ACCOUNT...") : mode === "login" ? "LOG IN" : "CREATE ACCOUNT"}</Text>
        </Pressable>

        <Pressable style={styles.switchButton} onPress={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }} disabled={authBusy} accessibilityRole="button" accessibilityState={{ disabled: authBusy }}>
          <Text style={styles.switch}>
            {mode === "login" ? "No account? Sign up" : "Have an account? Log in"}
          </Text>
        </Pressable>

        <View style={styles.artistNote}>
          <Icon name="shield" size={16} color={colors.amber} />
          <Text style={styles.artistNoteTxt}>
            Are you an artist? Create a personal account first, then claim your official artist
            profile from Manage profile. Every claim is reviewed before approval.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 10 },
  cancel: { color: colors.textDim, fontSize: 15, width: 40 },
  topTitle: { color: colors.textFaint, fontSize: 11, letterSpacing: 2, fontWeight: "700" },
  content: { padding: 16, paddingBottom: 48 },
  wordmark: { color: colors.text, fontSize: 34, fontWeight: "900", letterSpacing: 5, fontFamily: mono, marginTop: 8 },
  tag: { color: colors.textDim, fontSize: 14, marginTop: 4, marginBottom: 24 },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    color: colors.text,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    marginBottom: 10,
  },
  cityPick: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 10 },
  cityTxt: { flex: 1, color: colors.text, fontSize: 15 },
  cityPlaceholder: { color: colors.textFaint },
  error: { color: colors.danger, fontSize: 13, marginBottom: 8 },
  consent: { minHeight: 44, flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 14, marginBottom: 4, paddingVertical: 6 },
  policyLinks: { flexDirection: "row", flexWrap: "wrap", gap: 18, marginLeft: 44, marginTop: 3, marginBottom: 4 },
  inlineLink: { minHeight: 44, justifyContent: "center" },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", marginTop: 1 },
  boxOn: { backgroundColor: colors.amberStrong, borderColor: colors.amberStrong },
  consentTxt: { flex: 1, color: colors.textDim, fontSize: 12.5, lineHeight: 18 },
  link: { color: colors.amber, fontWeight: "700", textDecorationLine: "underline" },
  primary: { backgroundColor: colors.amberStrong, borderRadius: radius.md, paddingVertical: 15, alignItems: "center", marginTop: 10 },
  primaryOff: { opacity: 0.5 },
  primaryTxt: { color: "#1A1206", fontSize: 15, fontWeight: "800", letterSpacing: 1 },
  switchButton: { minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: 8 },
  switch: { color: colors.amber, fontSize: 14, textAlign: "center" },
  forgotButton: { minHeight: 44, alignItems: "flex-end", justifyContent: "center" },
  forgot: { color: colors.textDim, fontSize: 13, textAlign: "right" },
  artistNote: { flexDirection: "row", gap: 10, backgroundColor: colors.bgElev, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 14, marginTop: 24 },
  artistNoteTxt: { color: colors.textDim, fontSize: 12, lineHeight: 18, flex: 1 },
  seed: { marginTop: 20, backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.lineSoft, padding: 14 },
  seedTitle: { color: colors.textFaint, fontSize: 10, letterSpacing: 1.5, fontWeight: "700", marginBottom: 8 },
  seedLine: { color: colors.textDim, fontFamily: mono, fontSize: 11, lineHeight: 18 },
});
