// Presentation only: font changes never reset the artist's selected section or drafts.
export function iosArtistLayout(platform, fontScale = 1) {
  return { largeText: platform === "ios" && fontScale > 1.25,
    singleColumn: platform === "ios" && fontScale > 2 };
}

// Only an explicit action arms speech; background refresh and initial render stay quiet.
export function createIOSArtistAnnouncements({ announce, schedule = setTimeout, cancel = clearTimeout }) {
  let scope, enabled = false, active = false, intent = null, timer = null, generation = 0;
  const reset = () => { generation++; if (timer !== null) cancel(timer); timer = null; intent = null; };
  return {
    configure(nextScope, nextEnabled, nextActive) {
      if (scope !== nextScope || !nextEnabled || !nextActive) reset();
      scope = nextScope; enabled = nextEnabled; active = nextActive;
    },
    request(current = () => true) { reset(); if (enabled && active && current()) intent = { scope, current }; },
    update(ui, artistName) {
      if (!intent || intent.scope !== scope || (ui.scope != null && ui.scope !== scope) || ui.busy || ui.joining || timer !== null) return;
      const message = ui.error || ui.notice || (ui.invite ? `Following ${artistName}. You can also join the Fan Club.` : "");
      if (!message) return;
      const token = generation;
      timer = schedule(() => {
        if (token !== generation || !intent || !intent.current() || !enabled || !active) return;
        timer = null; intent = null;
        announce(message, { queue: true });
      }, 450);
    },
    reset,
  };
}
