import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import Button from "../components/Button";
import Icon from "../components/Icon";
import SheetHeader from "../components/SheetHeader";
import {
  SUGGESTION_BODY_LIMIT,
  SUGGESTION_CATEGORIES,
  createSuggestionClientMutationId,
  normalizeSuggestionSurface,
  suggestionFailureMessage,
} from "../domain/suggestionBox.mjs";
import { submitSuggestion } from "../features/suggestions/suggestionService";
import { colors, displayFont, focusRing, mono, radius, shadow, space } from "../theme";

export default function SuggestionBoxScreen({ onClose, initialSurface = null }) {
  const safeInitialSurface = normalizeSuggestionSurface(initialSurface);
  const [category, setCategory] = useState("idea");
  const [body, setBody] = useState("");
  const [includeSurface, setIncludeSurface] = useState(false);
  const [clientMutationId, setClientMutationId] = useState(() => createSuggestionClientMutationId());
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState(null);

  const resetAttemptAfterEdit = () => {
    setError("");
    if (!attempted) return;
    setAttempted(false);
    setClientMutationId(createSuggestionClientMutationId());
  };

  const chooseCategory = (next) => {
    if (busy || next === category) return;
    setCategory(next);
    resetAttemptAfterEdit();
  };

  const changeBody = (next) => {
    setBody(next);
    resetAttemptAfterEdit();
  };

  const toggleSurface = () => {
    if (busy || !safeInitialSurface) return;
    setIncludeSurface((value) => !value);
    resetAttemptAfterEdit();
  };

  const send = async () => {
    if (busy || confirmation) return;
    setBusy(true);
    setError("");
    setAttempted(true);
    try {
      const suggestion = await submitSuggestion({
        category,
        body,
        clientMutationId,
        ...(includeSurface && safeInitialSurface ? { surface: safeInitialSurface } : {}),
      });
      setConfirmation(suggestion);
      setBody("");
    } catch (error) {
      setError(suggestionFailureMessage(error));
    }
    setBusy(false);
  };

  const valid = body.trim().length >= 3;

  return (
    <View style={styles.wrap}>
      <SheetHeader title="Make PIT better" onClose={onClose} leadDisabled={busy} leadHint={busy ? "Wait for the current suggestion to finish sending" : undefined} />
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {confirmation ? (
          <View style={styles.done} accessibilityLiveRegion="polite">
            <View style={styles.doneIcon}><Icon name="check" size={30} color={colors.good} /></View>
            <Text selectable style={styles.doneTitle}>Suggestion received</Text>
            <Text selectable style={styles.doneText}>
              Thanks for helping shape PIT. Your note was saved without automatically attaching your account or request details.
            </Text>
            <View style={styles.referenceBox}>
              <Text style={styles.referenceLabel}>REFERENCE</Text>
              <Text selectable style={styles.reference}>{confirmation.reference}</Text>
            </View>
            <Button title="Done" icon="check" onPress={onClose} style={styles.doneButton} />
          </View>
        ) : (
          <>
            <View style={styles.hero}>
              <View style={styles.heroIcon}><Icon name="music" size={22} color={colors.amber} /></View>
              <View style={styles.heroCopy}>
                <Text selectable accessibilityRole="header" style={styles.title}>What would make you come back?</Text>
                <Text selectable style={styles.intro}>Tell us what felt missing, confusing, or worth building next.</Text>
              </View>
            </View>

            <View style={styles.privacyCard}>
              <Icon name="lock" size={17} color={colors.good} />
              <Text selectable style={styles.privacyText}>
                Anonymous by design. PIT does not automatically attach your account, contact details, IP address, search text, or page URL to this suggestion.
              </Text>
            </View>

            <Text style={styles.label}>WHAT KIND OF NOTE IS THIS?</Text>
            <View accessibilityRole="radiogroup" accessibilityLabel="Suggestion category" style={styles.categoryGrid}>
              {SUGGESTION_CATEGORIES.map((option) => {
                const selected = category === option.key;
                return (
                  <Pressable
                    key={option.key}
                    onPress={() => chooseCategory(option.key)}
                    disabled={busy}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected, selected, disabled: busy }}
                    accessibilityLabel={option.label}
                    style={({ pressed, focused }) => [
                      styles.category,
                      selected && styles.categorySelected,
                      pressed && !busy && styles.pressed,
                      focused && focusRing,
                      busy && styles.disabled,
                    ]}
                  >
                    <View style={[styles.radio, selected && styles.radioSelected]}>{selected ? <View style={styles.radioDot} /> : null}</View>
                    <Text style={[styles.categoryText, selected && styles.categoryTextSelected]}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.messageHeading}>
              <Text style={styles.label}>YOUR SUGGESTION</Text>
              <Text style={styles.counter}>{body.length}/{SUGGESTION_BODY_LIMIT}</Text>
            </View>
            <TextInput
              value={body}
              onChangeText={changeBody}
              editable={!busy}
              multiline
              maxLength={SUGGESTION_BODY_LIMIT}
              placeholder="What should PIT change, and why would it matter to you?"
              placeholderTextColor={colors.textFaint}
              style={styles.input}
              textAlignVertical="top"
              accessibilityLabel="Your suggestion"
              accessibilityHint={`Up to ${SUGGESTION_BODY_LIMIT} characters. Do not include private or contact information.`}
              accessibilityState={{ disabled: busy }}
            />
            <Text selectable style={styles.safetyNote}>Do not include passwords, email addresses, private messages, phone numbers, or other personal information.</Text>

            {safeInitialSurface ? (
              <Pressable
                onPress={toggleSurface}
                disabled={busy}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: includeSurface, disabled: busy }}
                accessibilityLabel={`Include the ${safeInitialSurface} section with this suggestion`}
                style={({ pressed, focused }) => [styles.surfaceChoice, pressed && !busy && styles.pressed, focused && focusRing, busy && styles.disabled]}
              >
                <View style={[styles.checkbox, includeSurface && styles.checkboxOn]}>{includeSurface ? <Icon name="check" size={14} color="#1A1206" /> : null}</View>
                <View style={styles.surfaceCopy}>
                  <Text style={styles.surfaceTitle}>Include where I was</Text>
                  <Text style={styles.surfaceDetail}>Sends only "{safeInitialSurface}" - never the URL or anything you searched.</Text>
                </View>
              </Pressable>
            ) : null}

            {!!error && (
              <View style={styles.errorBox} accessibilityRole="alert" accessibilityLiveRegion="assertive">
                <Icon name="x" size={16} color={colors.danger} />
                <Text selectable style={styles.errorText}>{error}</Text>
              </View>
            )}

            <Button
              title={busy ? "Sending suggestion..." : "Send suggestion"}
              icon="share"
              onPress={send}
              loading={busy}
              disabled={!valid}
              accessibilityHint="Sends an anonymous product suggestion to PIT administrators"
              style={styles.submit}
            />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  content: { width: "100%", maxWidth: 680, alignSelf: "center", padding: space(4), paddingBottom: space(14), gap: space(3) },
  hero: { flexDirection: "row", gap: space(3), alignItems: "flex-start", paddingVertical: space(2) },
  heroIcon: { width: 48, height: 48, borderRadius: radius.sm, borderCurve: "continuous", alignItems: "center", justifyContent: "center", backgroundColor: `${colors.amber}16`, borderWidth: 1, borderColor: `${colors.amber}55` },
  heroCopy: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontFamily: displayFont, fontSize: 25, lineHeight: 31, fontWeight: "900", letterSpacing: -0.4 },
  intro: { color: colors.textDim, fontSize: 14, lineHeight: 21, paddingTop: 4 },
  privacyCard: { flexDirection: "row", alignItems: "flex-start", gap: space(2.5), padding: space(3), borderRadius: radius.md, borderCurve: "continuous", backgroundColor: `${colors.good}0D`, borderWidth: 1, borderColor: `${colors.good}44` },
  privacyText: { flex: 1, color: colors.textDim, fontSize: 12.5, lineHeight: 18 },
  label: { color: colors.textFaint, fontFamily: mono, fontSize: 10.5, lineHeight: 15, letterSpacing: 1.3, fontWeight: "900", paddingTop: space(2) },
  categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: space(2) },
  category: { minHeight: 48, flexGrow: 1, flexBasis: 210, flexDirection: "row", alignItems: "center", gap: space(2.5), paddingHorizontal: space(3), paddingVertical: space(2), borderRadius: radius.sm, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface, ...shadow.control },
  categorySelected: { borderColor: colors.amber, backgroundColor: colors.surfaceAlt },
  categoryText: { flex: 1, color: colors.textDim, fontSize: 13, lineHeight: 18, fontWeight: "700" },
  categoryTextSelected: { color: colors.text },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.textFaint, alignItems: "center", justifyContent: "center" },
  radioSelected: { borderColor: colors.amber },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.amberStrong },
  messageHeading: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: space(3) },
  counter: { color: colors.textFaint, fontFamily: mono, fontSize: 10.5, fontVariant: ["tabular-nums"] },
  input: { minHeight: 154, color: colors.text, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, borderCurve: "continuous", paddingHorizontal: space(3.5), paddingVertical: space(3), fontSize: 15, lineHeight: 22 },
  safetyNote: { color: colors.textFaint, fontSize: 11.5, lineHeight: 17 },
  surfaceChoice: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: space(3), padding: space(3), borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface },
  checkbox: { width: 24, height: 24, borderRadius: 7, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev, alignItems: "center", justifyContent: "center" },
  checkboxOn: { borderColor: colors.amberStrong, backgroundColor: colors.amberStrong },
  surfaceCopy: { flex: 1, minWidth: 0 },
  surfaceTitle: { color: colors.text, fontSize: 13.5, fontWeight: "800" },
  surfaceDetail: { color: colors.textDim, fontSize: 11.5, lineHeight: 16, paddingTop: 2 },
  errorBox: { flexDirection: "row", alignItems: "flex-start", gap: space(2.5), padding: space(3), borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: `${colors.danger}88`, backgroundColor: `${colors.danger}0D` },
  errorText: { flex: 1, color: colors.danger, fontSize: 13, lineHeight: 19, fontWeight: "700" },
  submit: { marginTop: space(2) },
  done: { alignItems: "center", gap: space(3), paddingTop: space(9) },
  doneIcon: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", backgroundColor: `${colors.good}16`, borderWidth: 1, borderColor: `${colors.good}66` },
  doneTitle: { color: colors.text, fontFamily: displayFont, fontSize: 25, fontWeight: "900", textAlign: "center" },
  doneText: { maxWidth: 500, color: colors.textDim, fontSize: 14, lineHeight: 21, textAlign: "center" },
  referenceBox: { minWidth: 180, alignItems: "center", gap: space(1), paddingHorizontal: space(4), paddingVertical: space(3), borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  referenceLabel: { color: colors.textFaint, fontFamily: mono, fontSize: 9.5, letterSpacing: 1.3, fontWeight: "900" },
  reference: { color: colors.amber, fontFamily: mono, fontSize: 17, letterSpacing: 1.4, fontWeight: "900" },
  doneButton: { width: "100%", maxWidth: 320, marginTop: space(2) },
  pressed: { opacity: 0.86 },
  disabled: { opacity: 0.5 },
});
