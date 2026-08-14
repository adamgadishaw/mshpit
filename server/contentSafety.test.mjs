import assert from "node:assert/strict";
import test from "node:test";

import { assertSafeAuthoredText, CONTENT_REJECTED_CODE, contentSafetyDecision } from "./contentSafety.js";

test("content safety allows ordinary concert conversation and a normal shared link", () => {
  for (const value of [
    "J. Cole was incredible last night - the crowd knew every word.",
    "I hated the mix, but the opener deserved a longer set.",
    "Tickets are here: https://tickets.example/show",
    "This documentary discusses child-safety policy without soliciting anything.",
    "The band played Kill Yourself by S.O.D. in the encore.",
    "Don't go kill yourself. Please call someone.",
    "He told me to go kill yourself, so I reported him.",
    "I hope you die laughing at this crowd video.",
    "I will shoot you the ticket link tomorrow.",
    "Don't send me nudes",
    "Never send me nudes without asking",
    "All phone batteries should die",
    "He threatened me: I'll kill you",
    "He reported: I will kill you and laugh",
    "Lyrics: we are going to kill you",
    "Lyrics: I w i l l k i l l you",
    "Please do not kill yourself",
    "If someone says send me nudes now, block and report them",
    "Nude by Radiohead is on the setlist",
    "A survivor discussed child exploitation prevention resources",
    "The MP4 file: https://media.example/show.mp4",
    "encore encore encore encore encore encore encore",
    "WOOOOOOOOOOOOOOOOOOOOO!",
  ]) assert.equal(contentSafetyDecision(value).safe, true, value);
});

test("content safety rejects direct abuse, exploitation, unsafe schemes, and mechanical spam", () => {
  const rejected = [
    "Go kill yourself",
    "kill yourself",
    "I am going to find you and stab you",
    "I will murder you",
    "I'll kill you",
    "I'm going to kill you",
    "We're going to kill you",
    "I am going to beat you to death",
    "go k1ll yourself",
    "go kіll yourself",
    "Please go kill yourself",
    "Go kill yourself now",
    "You need to die",
    "I will burn your house down",
    "I am coming to hurt you",
    "Send me porn",
    "I'll k1ll you",
    "I will r@pe you",
    "child p0rn",
    "c h i l d p o r n",
    "nudes from a 15 year old",
    "kys",
    "I hope you die",
    "Send me nudes",
    "I have CSAM",
    "Send child sexual abuse material",
    "I will kill you \u{1F52A}",
    "hey, I will kill you",
    "I will kill you and laugh",
    "Kill yourself loser",
    "Send me nudes now",
    "Send me child porn now",
    "I w i l l k i l l you",
    "white power",
    "javascript:alert(1)",
    "https://spam.example https://spam.example",
    "a.test https://one.example https://two.example https://three.example https://four.example",
    "spam.test one.test two.test three.test",
    "Guaranteed returns https://crypto.example",
    "tickets tickets tickets tickets tickets tickets tickets tickets tickets tickets tickets tickets tickets tickets tickets",
  ];
  for (const value of rejected) assert.equal(contentSafetyDecision(value).safe, false, value);
});

test("rejection is a stable 422 and never echoes the submitted text", () => {
  const submitted = "Go kill yourself now";
  assert.throws(
    () => assertSafeAuthoredText(submitted, { field: "comment" }),
    (error) => error.status === 422
      && error.code === CONTENT_REJECTED_CODE
      && !error.message.includes(submitted),
  );
});
