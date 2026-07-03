import { useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView } from "react-native";
import { colors, mono, radius } from "../theme";
import { useStore } from "../store";
import Icon from "../components/Icon";
import SheetHeader from "../components/SheetHeader";
import LocationPicker from "../components/LocationPicker";

export default function AuthScreen({ onDone, onCancel, initialMode = "login" }) {
  const { login, signup } = useStore();
  const [mode, setMode] = useState(initialMode === "signup" ? "signup" : "login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [city, setCity] = useState(null); // { city, label }
  const [pickingCity, setPickingCity] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    const res = mode === "login" ? await login(email, password) : await signup({ name, email, password, city: city?.city });
    if (res.ok) onDone?.(mode); // signup flows into the artist taste picker
    else setError(res.error);
  };

  if (pickingCity) {
    return (
      <LocationPicker
        onClose={() => setPickingCity(false)}
        onSelect={(place) => { setCity({ city: place.city, label: place.label }); setPickingCity(false); }}
      />
    );
  }

  return (
    <View style={styles.wrap}>
      <SheetHeader title={mode === "login" ? "Log in" : "Sign up"} onClose={onCancel} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.wordmark}>PIT</Text>
        <Text style={styles.tag}>log the shows you go to</Text>

        {mode === "signup" && (
          <TextInput style={styles.input} placeholder="Name" placeholderTextColor={colors.textFaint} value={name} onChangeText={setName} maxLength={40} />
        )}
        {mode === "signup" && (
          <Pressable style={styles.cityPick} onPress={() => setPickingCity(true)}>
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
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          maxLength={120}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={colors.textFaint}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          maxLength={100}
        />

        {!!error && <Text style={styles.error}>{error}</Text>}

        <Pressable style={styles.primary} onPress={submit}>
          <Text style={styles.primaryTxt}>{mode === "login" ? "LOG IN" : "CREATE ACCOUNT"}</Text>
        </Pressable>

        <Pressable onPress={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }}>
          <Text style={styles.switch}>
            {mode === "login" ? "No account? Sign up" : "Have an account? Log in"}
          </Text>
        </Pressable>

        <View style={styles.artistNote}>
          <Icon name="shield" size={16} color={colors.amber} />
          <Text style={styles.artistNoteTxt}>
            Are you an artist? Log in as a fan first, then request an official artist account from
            your profile - an admin reviews every request before approval.
          </Text>
        </View>

        <View style={styles.seed}>
          <Text style={styles.seedTitle}>DEMO LOGINS</Text>
          <Text style={styles.seedLine}>fan · demo@example.com / password123</Text>
          <Text style={styles.seedLine}>artist · band@turnstile.com / password123</Text>
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
  primary: { backgroundColor: colors.amberStrong, borderRadius: radius.md, paddingVertical: 15, alignItems: "center", marginTop: 6 },
  primaryTxt: { color: "#1A1206", fontSize: 15, fontWeight: "800", letterSpacing: 1 },
  switch: { color: colors.amber, fontSize: 14, textAlign: "center", marginTop: 18 },
  artistNote: { flexDirection: "row", gap: 10, backgroundColor: colors.bgElev, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, padding: 14, marginTop: 24 },
  artistNoteTxt: { color: colors.textDim, fontSize: 12, lineHeight: 18, flex: 1 },
  seed: { marginTop: 20, backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.lineSoft, padding: 14 },
  seedTitle: { color: colors.textFaint, fontSize: 10, letterSpacing: 1.5, fontWeight: "700", marginBottom: 8 },
  seedLine: { color: colors.textDim, fontFamily: mono, fontSize: 11, lineHeight: 18 },
});
