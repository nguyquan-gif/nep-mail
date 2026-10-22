import {
  createHmac,
  timingSafeEqual,
  randomBytes,
  scryptSync,
} from "node:crypto";
export function session(secret: string) {
  const payload = Buffer.from(
    JSON.stringify({
      exp: Date.now() + 12 * 60 * 60 * 1000,
      nonce: randomBytes(16).toString("hex"),
    }),
  ).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}
export function verifySession(secret: string, value: string) {
  const [p, s, extra] = value.split(".");
  if (!p || !s || extra) return false;
  const expected = createHmac("sha256", secret).update(p).digest();
  const actual = Buffer.from(s, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return false;
  try {
    return JSON.parse(Buffer.from(p, "base64url").toString()).exp > Date.now();
  } catch {
    return false;
  }
}
export function passwordMatches(expected: string, input: string) {
  const salt = "nep-mail-password-compare";
  return timingSafeEqual(
    scryptSync(expected, salt, 32),
    scryptSync(input, salt, 32),
  );
}
