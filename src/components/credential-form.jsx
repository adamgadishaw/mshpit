import { createContext, use, useRef } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { createCredentialSubmitGuard, credentialFieldId } from "./credential-form-state.mjs";

const FormContext = createContext(null);

// Native keeps the established controls. Only the web adapter emits HTML.
export default function CredentialForm({ id, onSubmit, disabled = false, style, children }) {
  const guard = useRef(createCredentialSubmitGuard());
  const submit = (submitter) => guard.current(() => onSubmit?.(submitter), disabled);
  return <FormContext value={{ id, submit }}><View style={style}>{children}</View></FormContext>;
}

export function CredentialInput({ name, ref, onSubmitEditing, ...props }) {
  const form = use(FormContext);
  return <TextInput {...props} ref={ref} nativeID={props.nativeID || credentialFieldId(form?.id || "credential", name)}
    onSubmitEditing={onSubmitEditing || (form ? () => form.submit() : undefined)} />;
}

export function CredentialLabel({ htmlFor: _htmlFor, ...props }) {
  return <Text {...props} />;
}

export function CredentialSubmit({ name, value, onPress, ...props }) {
  const form = use(FormContext);
  return <Pressable {...props} accessibilityRole="button" onPress={form ? () => form.submit({ name, value }) : onPress} />;
}
