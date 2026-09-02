import { useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView } from "react-native";
import { colors, mono, radius } from "../theme";
import { useStore } from "../store";
import Icon from "../components/Icon";
import SheetHeader from "../components/SheetHeader";
import LocationPicker from "../components/LocationPicker";
import PrivacyScreen from "./PrivacyScreen";
import TermsScreen from "./TermsScreen";
import { GENRES } from "../data";
import { PROFILE_GENRE_MAX, profileGenreSelection } from "../domain/genrePreferences.mjs";

export default function AuthScreen({ onDone, onCancel, initialMode = "login" }) {
  const { login, signup, forgotPassword } = useStore();
  const [mode, setMode] = useState(initialMode === "signup" ? "signup" : "login");
  const [sentTo, setSentTo] = useState(null); // email a reset link was requested for
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [city, setCity] = useState(null); // complete LocationPicker place identity
  const [genres, setGenres] = useState([]);
  const [pickingCity, setPickingCity] = useState(false);
  const [agreed, setAgreed] = useState(false); // signup: consent to Terms + Privacy
  const [ageBand, setAgeBand] = useState(null); // coarse safety band; no birth date is collected
  const [analyticsConsent, setAnalyticsConsent] = useState(false); // optional, default off
  const [viewing, setViewing] = useState(null); // "terms" | "privacy", inline reader
  const [error, setError] = useState("");
  const [signupSubmitted, setSignupSubmitted] = useState(false);
  const [busyAction, setBusyAction] = useState(null); // "auth" | "reset"

  const authBusy = busyAction === "auth";
  const resetBusy = busyAction === "reset";

  const submit = async () => {
    if (busyAction) return;
    if (mode === "signup" && !agreed) {
      setError("Please agree to the Terms & Conditions and Privacy policy to create your account.");
      return;
    }
    if (mode === "signup" && !ageBand) {
      setError("Choose your age group to continue.");
      return;
    }
    const genreSelection = profileGenreSelection(genres);
    if (mode === "signup" && !genreSelection.valid) {
      setError(genreSelection.error);
      return;
    }
    setError("");
    setBusyAction("auth");
    try {
      const res = mode === "login"
        ? await login(email.trim(), password)
        : await signup({ name, email: email.trim(), password, city: city?.city, location: city, genres: genreSelection.genres, ageBand, agreedToTerms: true, analyticsConsent });
      if (res?.ok && mode === "signup" && res?.pending) setSignupSubmitted(true);
      else if (res?.ok) onDone?.(mode);
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

  const toggleGenre = (genre) => {
    setGenres((current) => {
      if (current.includes(genre)) return current.filter((value) => value !== genre);
      if (current.length >= PROFILE_GENRE_MAX) {
        setError("Choose up to 3 music genres.");
        return current;
      }
      setError("");
      return [...current, genre];
    });
  };

  // Let people actually read what they're agreeing to, without leaving sign-up.
  if (viewing === "terms") return <TermsScreen onClose={() => setViewing(null)} />;
  if (viewing === "privacy") return <PrivacyScreen onClose={() => setViewing(null)} />;

  if (signupSubmitted) {
    return (
      <View style={styles.wrap}>
        <SheetHeader title="Check your email" onClose={onCancel} />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.wordmark}>MSHPIT</Text>
          <Text style={[styles.tag, { marginBottom: 20 }]} accessibilityRole="header">Finish signing up from your email</Text>
          <View style={styles.artistNote}>
            <Icon name="mail" size={16} color={colors.amber} />
            <Text style={styles.artistNoteTxt} accessibilityLiveRegion="polite" role="status">If this is a new email address, we sent a verification link. If it already has an account, log in or reset your password. For privacy, we show the same message either way.</Text>
          </View>
          <Pressable style={styles.primary} onPress={() => { setMode("login"); setSignupSubmitted(false); setPassword(""); setError(""); }} accessibilityRole="button">
            <Text style={styles.primaryTxt}>CONTINUE TO LOG IN</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

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
          <Text style={styles.wordmark}>MSHPIT</Text>
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
        <Text style={styles.wordmark}>MSHPIT</Text>
        <Text style={styles.tag}>remember the shows you attend</Text>

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
          <View style={styles.ageSection} accessibilityRole="radiogroup" accessibilityLabel="Age group">
            <Text style={styles.genreLabel}>AGE GROUP</Text>
            <Text style={styles.genreHint}>Used only for account safety. We do not ask for your birth date.</Text>
            <View style={styles.ageChoices}>
              {[["13_17", "13–17"], ["18_plus", "18+"]].map(([value, label]) => (
                <Pressable key={value} style={[styles.ageChoice, ageBand === value && styles.genreChipSelected]} onPress={() => setAgeBand(value)} accessibilityRole="radio" accessibilityState={{ selected: ageBand === value }}>
                  <Text style={[styles.genreChipText, ageBand === value && styles.genreChipTextSelected]}>{label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {mode === "signup" && (
          <Pressable
            style={[styles.cityPick, authBusy && styles.primaryOff]}
            onPress={() => setPickingCity(true)}
            disabled={authBusy}
            accessibilityRole="button"
            accessibilityLabel={city ? `City, ${city.label}` : "Choose your city"}
            accessibilityHint="Used to show nearby concerts and local posts"
            accessibilityState={{ disabled: authBusy }}
          >
            <Icon name="pin" size={16} color={colors.amber} />
            <Text style={[styles.cityTxt, !city && styles.cityPlaceholder]}>{city ? city.label : "Your city (shows events near you)"}</Text>
            <Icon name="chevron-right" size={16} color={colors.textDim} />
          </Pressable>
        )}
        {mode === "signup" && (
          <View style={styles.genreSection}>
            <View style={styles.genreHeading}>
              <Text style={styles.genreLabel}>MUSIC YOU LIKE</Text>
              <Text style={styles.genreCount}>{genres.length}/3 selected</Text>
            </View>
            <Text style={styles.genreHint}>Choose 1 to 3 genres. This starts your artist, show, and feed recommendations.</Text>
            <View style={styles.genreChips}>
              {GENRES.map((genre) => {
                const selected = genres.includes(genre);
                return (
                  <Pressable
                    key={genre}
                    style={[styles.genreChip, selected && styles.genreChipSelected]}
                    onPress={() => toggleGenre(genre)}
                    disabled={authBusy}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected, disabled: authBusy }}
                    accessibilityLabel={genre}
                  >
                    <Text style={[styles.genreChipText, selected && styles.genreChipTextSelected]}>{genre}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
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
            accessibilityLabel="I agree to the Terms and Privacy policy"
          >
            <View style={[styles.box, agreed && styles.boxOn]}>
              {agreed ? <Icon name="check" size={14} color="#1A1206" strokeWidth={3} /> : null}
            </View>
            <Text style={styles.consentTxt}>
              I agree to the{" "}
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
          <Pressable style={styles.consent} onPress={() => setAnalyticsConsent((value) => !value)} disabled={authBusy} accessibilityRole="checkbox" accessibilityState={{ checked: analyticsConsent, disabled: authBusy }} accessibilityLabel="Share optional limited account usage data">
            <View style={[styles.box, analyticsConsent && styles.boxOn]}>
              {analyticsConsent ? <Icon name="check" size={14} color="#1A1206" strokeWidth={3} /> : null}
            </View>
            <Text style={styles.consentTxt}>Optional: share limited app usage events linked to your account. These events do not include the contents of authored posts or reviews, search terms, messages, or uploaded media. IP addresses are not stored with these analytics events. This helps Mshpit fix problems and improve recommendations. You can change this any time in Settings.</Text>
          </Pressable>
        )}

        {mode === "login" && (
          <Pressable style={styles.forgotButton} onPress={() => { setMode("forgot"); setError(""); }} disabled={authBusy} accessibilityRole="button" accessibilityState={{ disabled: authBusy }}>
            <Text style={styles.forgot}>Forgot password?</Text>
          </Pressable>
        )}

        {!!error && <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">{error}</Text>}

        <Pressable
          style={[styles.primary, (authBusy || (mode === "signup" && (!agreed || !profileGenreSelection(genres).valid))) && styles.primaryOff]}
          onPress={submit}
          disabled={authBusy || (mode === "signup" && (!agreed || !profileGenreSelection(genres).valid))}
          accessibilityRole="button"
          accessibilityState={{ disabled: authBusy || (mode === "signup" && (!agreed || !profileGenreSelection(genres).valid)), busy: authBusy }}
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
            Are you an artist? Create a personal account first. Then open your profile and choose
            Claim artist profile. Every claim is reviewed before approval.
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
  genreSection: { gap: 8, paddingVertical: 8, marginBottom: 4 },
  genreHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  genreLabel: { color: colors.textFaint, fontFamily: mono, fontSize: 10, fontWeight: "800", letterSpacing: 1.3 },
  genreCount: { color: colors.amber, fontSize: 11.5, fontWeight: "700" },
  genreHint: { color: colors.textDim, fontSize: 12, lineHeight: 17 },
  genreChips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  genreChip: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  genreChipSelected: { borderColor: colors.amber, backgroundColor: colors.bgElev },
  genreChipText: { color: colors.textDim, fontSize: 12.5, fontWeight: "600" },
  genreChipTextSelected: { color: colors.amber, fontWeight: "800" },
  ageSection: { gap: 8, marginTop: 8, marginBottom: 4 },
  ageChoices: { flexDirection: "row", gap: 8 },
  ageChoice: { minHeight: 44, minWidth: 96, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
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
