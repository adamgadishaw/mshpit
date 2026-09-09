// Lock before React renders disabled controls: pointer/Enter events can race.
export function createCredentialSubmitGuard() {
  let pending = false;
  return async (action, disabled = false) => {
    if (disabled || pending) return;
    pending = true;
    try { return await action(); }
    finally { pending = false; }
  };
}

export function credentialFieldId(formId, name) {
  return `${formId}-${name}`;
}
