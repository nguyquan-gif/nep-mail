import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
test("self-host HTTP: login, forged identity rejection, persistent API writes and static app", async (t) => {
  const probe = createServer();
  await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
  const addr = probe.address() as { port: number };
  await new Promise<void>((r) => probe.close(() => r()));
  const port = addr.port,
    origin = `http://127.0.0.1:${port}`,
    dir = mkdtempSync(join(tmpdir(), "nep-mail-http-")),
    password = randomBytes(24).toString("hex");
  const child = spawn(process.execPath, ["selfhost/server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      APP_ORIGIN: origin,
      DATA_DIR: dir,
      SESSION_SECRET: randomBytes(32).toString("hex"),
      UNSUBSCRIBE_SECRET: randomBytes(32).toString("hex"),
      ADMIN_PASSWORD: password,
      ADMIN_EMAIL: "operator@nep-mail.dev",
      LIVE_SEND: "false",
      CAPTURE_MODE: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    child.kill("SIGTERM");
    await new Promise<void>((r) => child.once("exit", () => r()));
    rmSync(dir, { recursive: true, force: true });
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("server startup timeout")),
      10000,
    );
    child.stdout.on("data", (s) => {
      if (s.toString().includes("listening")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(Error("server exit " + code));
    });
  });
  const denied = await fetch(origin + "/api/bootstrap", {
    headers: {
      "oai-authenticated-user-id": "fake",
      "oai-authenticated-user-email": "operator@nep-mail.dev",
    },
  });
  assert.equal(denied.status, 401);
  const login = await fetch(origin + "/auth/login", {
    method: "POST",
    body: new URLSearchParams({ password }),
    headers: { origin, "content-type": "application/x-www-form-urlencoded" },
    redirect: "manual",
  });
  assert.equal(login.status, 303);
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  assert.ok(login.headers.get("set-cookie")!.includes("HttpOnly"));
  const headers = { cookie, origin, "content-type": "application/json" };
  const created = await fetch(origin + "/api/workspaces", {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "HTTP workspace" }),
  });
  assert.equal(created.status, 201);
  const w = ((await created.json()) as { id: string }).id;
  const contact = await fetch(origin + `/api/workspaces/${w}/contacts`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "Minh Anh",
      email: "minh@nep-mail.dev",
      consent: false,
    }),
  });
  assert.equal(contact.status, 200);
  const res = await fetch(origin + `/api/workspaces/${w}`, {
    headers: { cookie },
  });
  assert.equal(
    ((await res.json()) as { contacts: unknown[] }).contacts.length,
    1,
  );
  const page = await fetch(origin + "/", { headers: { cookie } });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes('id="root"'));
  // The Windows path guard must still serve real assets, not index.html.
  const asset = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
  assert.ok(asset, "index.html must reference a built script");
  const bundle = await fetch(origin + asset, { headers: { cookie } });
  assert.equal(bundle.status, 200);
  assert.match(bundle.headers.get("content-type") || "", /javascript/);
  assert.ok((await bundle.text()).length > 1000);
  const csrf = await fetch(origin + "/api/workspaces", {
    method: "POST",
    headers: { ...headers, origin: "https://evil.invalid" },
    body: JSON.stringify({ name: "unwanted" }),
  });
  assert.equal(csrf.status, 403);
});
