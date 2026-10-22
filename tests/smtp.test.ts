import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { smtpTransport } from "../selfhost/smtp.ts";
test("Nodemailer submits a multipart email to local SMTP capture, without external network", async (t) => {
  let message = "";
  const server = createServer((socket) => {
    let buffer = "",
      data = false;
    socket.setEncoding("utf8");
    socket.write("220 localhost ESMTP capture\r\n");
    socket.on("data", (s) => {
      buffer += s;
      let end;
      while ((end = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data) {
          if (line === ".") {
            data = false;
            socket.write("250 2.0.0 queued as test-local\r\n");
          } else message += line + "\r\n";
          continue;
        }
        if (/^EHLO/.test(line))
          socket.write("250-localhost\r\n250 SIZE 1000000\r\n");
        else if (/^DATA/.test(line)) {
          data = true;
          socket.write("354 End with dot\r\n");
        } else if (/^QUIT/.test(line)) {
          socket.end("221 Bye\r\n");
        } else socket.write("250 OK\r\n");
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const smtp = smtpTransport({
    host: "127.0.0.1",
    port: addr.port,
    sender: "hello@nep-mail.dev",
    capture: true,
  });
  const r = await smtp.send({
    to: "preview@example.invalid",
    subject: "Nếp Mail SMTP test",
    html: "<p>Chào bạn</p>",
    text: "Chào bạn",
    unsubscribe: "https://mail.nep-mail.dev/api/unsubscribe?token=test",
    idempotencyKey: "delivery-local-01",
  });
  assert.ok(r.id.includes("delivery-local-01"));
  assert.ok(message.includes("multipart/alternative"));
  assert.ok(message.includes("List-Unsubscribe:"));
  assert.ok(message.includes("List-Unsubscribe-Post:"));
  assert.ok(message.includes("Message-ID: <delivery-local-01@nep-mail.dev>"));
});
