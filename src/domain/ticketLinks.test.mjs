import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalTicketUrl,
  followTicketLink,
  projectedTourDateTicketUrl,
  ticketUrlDecision,
} from "./ticketLinks.mjs";

test("ticket URL policy canonicalizes known global providers without trusting lookalikes", () => {
  const ticketmaster = ticketUrlDecision(" HTTPS://Checkout.Ticketmaster.COM.AU/show?q=1#seat ", {
    source: "ticketmaster",
    allowUntrusted: false,
  });
  assert.deepEqual(ticketmaster, {
    valid: true,
    url: "https://checkout.ticketmaster.com.au/show?q=1",
    hostname: "checkout.ticketmaster.com.au",
    provider: "ticketmaster",
    trusted: true,
    requiresConfirmation: false,
    reason: null,
  });
  assert.equal(
    canonicalTicketUrl("https://www.bandsintown.com/e/123#tickets", { source: "bandsintown", allowUntrusted: false }),
    "https://www.bandsintown.com/e/123",
  );
  assert.equal(
    canonicalTicketUrl("https://www.axs.com/events/123", { source: "bandsintown", allowUntrusted: false }),
    "https://www.axs.com/events/123",
    "Bandsintown may hand an offer to another reviewed provider",
  );
  assert.equal(
    canonicalTicketUrl("https://tickets.artist-example.com/123", { source: "bandsintown", allowUntrusted: false }),
    "",
    "an aggregator response cannot grant trust to an arbitrary hostname",
  );
  assert.equal(ticketUrlDecision("https://ticketmaster.com.evil-site.com/show").valid, false);
  assert.equal(ticketUrlDecision("https://www.ticketmaster.com.evil-site.com/show").reason, "hostname");
  assert.equal(ticketUrlDecision("https://secure-ticketmaster.evil-site.com/show").reason, "hostname");
  assert.equal(ticketUrlDecision("https://bandsintown-login.evil-site.com/show").reason, "hostname");
  assert.equal(
    ticketUrlDecision("https://www.bandsintown.com/e/123", { source: "ticketmaster", allowUntrusted: false }).reason,
    "provider_host_mismatch",
  );
});

test("ticket URL policy rejects unsafe authority forms and classifies custom artist domains for confirmation", () => {
  for (const unsafe of [
    "http://tickets.artist-example.com/show",
    "javascript:alert(1)",
    "https://user:password@tickets.artist-example.com/show",
    "https://tickets.artist-example.com:8443/show",
    "https://tickets.artist-example.com:443/show",
    "https://localhost/show",
    "https://show.local/tickets",
    "https://show.internal/tickets",
    "https://show.test/tickets",
    "https://show.example/tickets",
    "https://show.invalid/tickets",
    "https://router.home.arpa/tickets",
    "https://hiddenservice.onion/tickets",
    "https://127.0.0.1/show",
    "https://[::1]/show",
    "https://tickets.artist-example.com./show",
    "https://tickets..artist-example.com/show",
    "https://%61rtist-example.com/show",
    "https://tickets.artist-example.com\\@evil-site.com/show",
    "https://tickets.artist-example.com/show\nhttps://evil-site.com",
  ]) {
    assert.equal(ticketUrlDecision(unsafe).valid, false, unsafe);
  }

  const artist = ticketUrlDecision("https://tickets.artist-example.com/world-tour#buy");
  assert.equal(artist.url, "https://tickets.artist-example.com/world-tour");
  assert.equal(artist.hostname, "tickets.artist-example.com");
  assert.equal(artist.trusted, false);
  assert.equal(artist.requiresConfirmation, true);
  assert.equal(ticketUrlDecision(artist.url, { allowUntrusted: false }).reason, "untrusted_provider");
  assert.equal(ticketUrlDecision("https://www.dice.fm/event/example").requiresConfirmation, false);
});

test("tour-date projection revalidates legacy rows and allows only owner-bound custom domains", () => {
  assert.equal(projectedTourDateTicketUrl({
    ticket_url: "https://www.ticketmaster.ca/event/1#buy",
    source: "ticketmaster",
    owner_id: null,
  }), "https://www.ticketmaster.ca/event/1");
  assert.equal(projectedTourDateTicketUrl({
    ticket_url: "https://ticketmaster.com.evil.example/event/1",
    source: "ticketmaster",
    owner_id: null,
  }), "");
  assert.equal(projectedTourDateTicketUrl({
    ticket_url: "https://tickets.artist-example.com/event/1",
    source: "artist-submitted",
    owner_id: "artist-1",
  }), "https://tickets.artist-example.com/event/1");
  assert.equal(projectedTourDateTicketUrl({
    ticket_url: "https://tickets.artist-example.com/event/1",
    source: "legacy-import",
    owner_id: null,
  }), "");
});

test("ticket opening fails closed and confirms the exact custom hostname", async () => {
  const opened = [];
  let confirmations = 0;
  const trusted = await followTicketLink("https://www.ticketmaster.com/event/1#buy", {
    confirmDestination: async () => { confirmations += 1; return true; },
    openUrl: async (url) => { opened.push(url); },
  });
  assert.equal(trusted.status, "opened");
  assert.deepEqual(opened, ["https://www.ticketmaster.com/event/1"]);
  assert.equal(confirmations, 0);

  let shownHostname = null;
  const custom = await followTicketLink("https://tickets.artist-example.com/event/2", {
    confirmDestination: async (decision) => { shownHostname = decision.hostname; return true; },
    openUrl: async (url) => { opened.push(url); },
  });
  assert.equal(custom.status, "opened");
  assert.equal(shownHostname, "tickets.artist-example.com");

  const cancelled = await followTicketLink("https://tickets.artist-example.com/event/3", {
    confirmDestination: async () => false,
    openUrl: async () => { throw new Error("must not open"); },
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal((await followTicketLink("https://tickets.artist-example.com/event/4", {
    openUrl: async () => {},
  })).status, "rejected", "custom links cannot open if the confirmation UI is unavailable");
  assert.equal((await followTicketLink("javascript:alert(1)", {
    confirmDestination: async () => true,
    openUrl: async () => { throw new Error("must not open"); },
  })).status, "rejected");
  assert.equal((await followTicketLink("https://www.ticketmaster.com/event/5", {
    openUrl: async () => { throw new Error("device refused"); },
  })).status, "failed");
});
