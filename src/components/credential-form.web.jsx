import { createContext, use, useRef, useState } from "react";
import { unstable_createElement as createElement, StyleSheet } from "react-native-web";
import { createCredentialSubmitGuard, credentialFieldId } from "./credential-form-state.mjs";

const FormContext = createContext(null);
const styles = StyleSheet.create({
  form: { display: "flex", flexDirection: "column", minWidth: 0, margin: 0, padding: 0 },
  input: { appearance: "none", backgroundColor: "transparent", borderWidth: 0, borderRadius: 0, boxSizing: "border-box", fontFamily: "inherit", fontSize: 14, minWidth: 0, margin: 0, padding: 0 },
  label: { display: "block", fontFamily: "inherit", fontSize: 14, margin: 0, padding: 0 },
  button: { display: "flex", flexDirection: "column", alignItems: "stretch", position: "relative", minWidth: 0, boxSizing: "border-box", backgroundColor: "transparent", borderWidth: 0, margin: 0, padding: 0, textAlign: "inherit", fontFamily: "inherit", cursor: "pointer", touchAction: "manipulation" },
});

export default function CredentialForm({ id, onSubmit, disabled = false, busy = false, style, username, requireExplicitSubmitter = false, children }) {
  const guard = useRef(createCredentialSubmitGuard());
  const handleSubmit = (event) => {
    // Never navigate with credentials, including through a default GET action.
    event.preventDefault();
    event.stopPropagation();
    const button = event.nativeEvent?.submitter;
    const submitter = button ? { name: button.name, value: button.value } : undefined;
    return guard.current(() => onSubmit?.(submitter), disabled);
  };
  return <FormContext value={{ id }}>{createElement("form", {
    id, method: "post", noValidate: true, autoComplete: "on", onSubmit: handleSubmit,
    onKeyDownCapture: (event) => {
      if (requireExplicitSubmitter && event.key === "Enter" && event.target.tagName === "INPUT" && !event.nativeEvent?.isComposing && event.keyCode !== 229) {
        event.preventDefault(); event.stopPropagation();
        // Multiple consequential choices require an explicit button activation.
        return guard.current(() => onSubmit?.(), disabled);
      }
    },
    "aria-busy": busy, style: [styles.form, style],
    children: <>
      {username ? createElement("input", { type: "text", id: credentialFieldId(id, "username"), name: "username", autoComplete: "username", value: username, readOnly: true, hidden: true }) : null}
      {children}
    </>,
  })}</FormContext>;
}

// RN-web TextInput drops name/form attributes. This adapter retains the input
// semantics and existing onChangeText/ref/style contract, with no persistence.
export function CredentialInput({
  name, ref, nativeID, accessibilityLabel, accessibilityHint: _hint, accessibilityState,
  style, value, onChangeText, onSubmitEditing, secureTextEntry, keyboardType,
  autoComplete, textContentType: _contentType, autoCapitalize = "none", autoCorrect = false,
  returnKeyType, enterKeyHint, editable = true, placeholderTextColor,
  maxLength, placeholder, onFocus, onBlur, required, readOnly = false, disabled = false,
  ...rest
}) {
  const form = use(FormContext);
  const id = nativeID || credentialFieldId(form?.id || "credential", name);
  const type = secureTextEntry ? "password" : keyboardType === "email-address" ? "email" : "text";
  return createElement("input", {
    ...rest, ref, id, name, type, value, autoComplete, autoCapitalize,
    autoCorrect: autoCorrect ? "on" : "off", spellCheck: autoCorrect,
    enterKeyHint: enterKeyHint || returnKeyType, maxLength, placeholder, required,
    readOnly: readOnly || !editable, disabled, onFocus, onBlur,
    "aria-label": accessibilityLabel, "aria-disabled": disabled || accessibilityState?.disabled,
    onChange: (event) => onChangeText?.(event.target.value),
    onKeyDown: (event) => {
      if (event.key !== "Enter" || event.nativeEvent?.isComposing || event.keyCode === 229) return;
      // Explicit next-field focus is allowed; final fields use native form submit.
      if (onSubmitEditing) {
        event.preventDefault();
        onSubmitEditing({ nativeEvent: { text: event.currentTarget.value } });
      }
    },
    style: [styles.input, placeholderTextColor ? { placeholderTextColor } : null, style],
  });
}

export function CredentialLabel({ htmlFor, children, style, ...props }) {
  const form = use(FormContext);
  return createElement("label", { ...props, htmlFor: credentialFieldId(form?.id || "credential", htmlFor), style: [styles.label, style], children });
}

export function CredentialSubmit({
  children, style, disabled = false, accessibilityState, accessibilityLabel,
  accessibilityRole: _role, accessibilityHint: _hint, onPress: _onPress,
  onHoverIn, onHoverOut, onFocus, onBlur, name, value, ...props
}) {
  const [interaction, setInteraction] = useState({ pressed: false, hovered: false, focused: false });
  const blocked = disabled || !!accessibilityState?.disabled;
  return createElement("button", {
    ...props, type: "submit", name, value, disabled: blocked,
    "aria-label": accessibilityLabel, "aria-disabled": blocked, "aria-busy": accessibilityState?.busy,
    onPointerDown: () => { if (!blocked) setInteraction(state => ({ ...state, pressed: true })); },
    onPointerUp: () => setInteraction(state => ({ ...state, pressed: false })),
    onPointerCancel: () => setInteraction(state => ({ ...state, pressed: false })),
    onPointerEnter: (event) => { setInteraction(state => ({ ...state, hovered: true })); onHoverIn?.(event); },
    onPointerLeave: (event) => { setInteraction(state => ({ ...state, hovered: false, pressed: false })); onHoverOut?.(event); },
    onFocus: (event) => { setInteraction(state => ({ ...state, focused: true })); onFocus?.(event); },
    onBlur: (event) => { setInteraction(state => ({ ...state, focused: false, pressed: false })); onBlur?.(event); },
    style: [styles.button, typeof style === "function" ? style(interaction) : style],
    children: typeof children === "function" ? children(interaction) : children,
  });
}
