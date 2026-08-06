import assert from "node:assert/strict";
import test from "node:test";

import { invitationCodeFromInput } from "./index.js";

test("invitation inputs accept either a raw code or a complete signup link", () => {
  assert.equal(invitationCodeFromInput("  Kp8YWa75vRZ6  ", "signup"), "Kp8YWa75vRZ6");
  assert.equal(
    invitationCodeFromInput("https://example.com/?invite=Kp8YWa75vRZ6", "signup"),
    "Kp8YWa75vRZ6",
  );
  assert.equal(
    invitationCodeFromInput("https://example.com/?signupInvite=abc123", "signup"),
    "abc123",
  );
});

test("reset inputs accept complete reset links without confusing signup links", () => {
  assert.equal(
    invitationCodeFromInput("https://example.com/?reset=F9eS123456ve", "reset"),
    "F9eS123456ve",
  );
  assert.equal(
    invitationCodeFromInput("https://example.com/?resetInvite=reset123", "reset"),
    "reset123",
  );
  assert.equal(
    invitationCodeFromInput("https://example.com/?invite=signup123", "reset"),
    "https://example.com/?invite=signup123",
  );
});
