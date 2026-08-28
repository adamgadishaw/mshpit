import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_TICKETMASTER_EVENT_IMAGES,
  publicTicketmasterEventImage,
  selectTicketmasterEventImage,
} from "./providerEventImage.js";

function image(overrides = {}) {
  return {
    url: "https://s1.ticketm.net/dam/a/123/example.jpg",
    ratio: "16_9",
    width: 1_024,
    height: 576,
    fallback: false,
    attribution: "Ticketmaster",
    ...overrides,
  };
}

test("Ticketmaster image selection prefers non-fallback, 16:9, useful, highest-resolution media", () => {
  const selected = selectTicketmasterEventImage({
    images: [
      image({ url: "https://s1.ticketm.net/fallback.jpg", fallback: true, width: 4_096, height: 2_304 }),
      image({ url: "https://s1.ticketm.net/four-three.jpg", ratio: "4_3", width: 4_096, height: 3_072 }),
      image({ url: "https://s1.ticketm.net/small.jpg", width: 640, height: 360 }),
      image({ url: "https://s1.ticketm.net/large.jpg", width: 2_048, height: 1_152 }),
      image({ url: "https://s1.ticketm.net/medium.jpg", width: 1_280, height: 720 }),
    ],
  });

  assert.deepEqual(selected, {
    uri: "https://s1.ticketm.net/large.jpg",
    attribution: "Ticketmaster",
    width: 2_048,
    height: 1_152,
  });
});

test("Ticketmaster image selection rejects malformed media and bounds the provider scan", () => {
  assert.equal(selectTicketmasterEventImage({ images: [
    image({ url: "http://s1.ticketm.net/insecure.jpg" }),
    image({ url: "https://localhost/private.jpg" }),
    image({ attribution: "" }),
    image({ width: 1.5 }),
    image({ height: 0 }),
    image({ width: 20_000 }),
  ] }), null);

  const beyondBound = Array.from({ length: MAX_TICKETMASTER_EVENT_IMAGES }, () => null);
  beyondBound.push(image({ url: "https://s1.ticketm.net/too-late.jpg" }));
  assert.equal(selectTicketmasterEventImage({ images: beyondBound }), null);
});

test("public Ticketmaster image projection requires trusted source page and complete persisted evidence", () => {
  const row = {
    source: "TicketMaster",
    ticket_url: "https://www.ticketmaster.ca/event/123?brand=example#tickets",
    event_image_url: " https://s1.ticketm.net/dam/a/123/example.jpg#fragment ",
    event_image_attribution: " Ticketmaster / Artist partner ",
    event_image_width: 1_920,
    event_image_height: 1_080,
  };

  assert.deepEqual(publicTicketmasterEventImage(row), {
    uri: "https://s1.ticketm.net/dam/a/123/example.jpg",
    attribution: "Ticketmaster / Artist partner",
    width: 1_920,
    height: 1_080,
    sourcePage: "https://www.ticketmaster.ca/event/123?brand=example",
  });
});

test("public Ticketmaster image projection fails closed for untrusted or incomplete rows", () => {
  const valid = {
    source: "ticketmaster",
    ticket_url: "https://www.ticketmaster.com/event/123",
    event_image_url: "https://s1.ticketm.net/dam/a/123/example.jpg",
    event_image_attribution: "Ticketmaster",
    event_image_width: 1_920,
    event_image_height: 1_080,
  };

  assert.equal(publicTicketmasterEventImage({ ...valid, source: "bandsintown" }), null);
  assert.equal(publicTicketmasterEventImage({ ...valid, ticket_url: "https://ticketmaster.example.com/event/123" }), null);
  assert.equal(publicTicketmasterEventImage({ ...valid, ticket_url: "http://www.ticketmaster.com/event/123" }), null);
  assert.equal(publicTicketmasterEventImage({ ...valid, event_image_url: "http://s1.ticketm.net/image.jpg" }), null);
  assert.equal(publicTicketmasterEventImage({ ...valid, event_image_attribution: "" }), null);
  assert.equal(publicTicketmasterEventImage({ ...valid, event_image_width: "1920" }), null);
  assert.equal(publicTicketmasterEventImage({ ...valid, event_image_height: 0 }), null);
});
