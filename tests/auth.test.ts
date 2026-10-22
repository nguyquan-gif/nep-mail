import test from "node:test";
import assert from "node:assert/strict";
import { session, verifySession, passwordMatches } from "../selfhost/auth.ts";
test("session signature and tampering", () => {
  const secret = "a".repeat(64);
  const token = session(secret);
  assert.equal(verifySession(secret, token), true);
  assert.equal(verifySession("b".repeat(64), token), false);
  assert.equal(verifySession(secret, token + "x"), false);
  assert.equal(verifySession(secret, ""), false);
});
test("password comparison", () => {
  assert.equal(passwordMatches("a long password", "a long password"), true);
  assert.equal(passwordMatches("a long password", "wrong"), false);
});
