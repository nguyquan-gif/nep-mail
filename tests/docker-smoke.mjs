// Requires docker compose capture stack. Never enables Internet delivery.
const origin = process.env.APP_ORIGIN || "http://localhost:3000";
const login = await fetch(origin + "/auth/login", {
  method: "POST",
  headers: { origin, "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ password: process.env.ADMIN_PASSWORD || "" }),
  redirect: "manual",
});
if (login.status !== 303) throw new Error("Container admin login failed");
const cookie = login.headers.get("set-cookie")?.split(";")[0];
async function post(path, body) {
  const r = await fetch(origin + "/api/" + path, {
    method: "POST",
    headers: { cookie, origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const p = await r.json();
  if (!r.ok) throw new Error("Smoke API failed: " + (p.error || r.status));
  return p;
}
const w = await post("workspaces", { name: "Container smoke test" });
const c = await post(`workspaces/${w.id}/campaigns`, {
  name: "Local SMTP smoke",
  subject: "N ep Mail container capture smoke",
  body: "This email must only reach the local capture mailbox.",
  category: "marketing",
});
await post(`workspaces/${w.id}/campaigns/${c.id}/test`, {});
const inbox = await fetch("http://localhost:8025/api/v1/messages");
const messages = await inbox.json();
if (
  !messages.messages?.some(
    (m) => m.Subject === "N ep Mail container capture smoke",
  )
)
  throw new Error("Capture mailbox did not receive SMTP message");
console.log(
  "Container HTTP -> app -> SMTP -> Mailpit capture flow passed. No Internet mail sent.",
);
