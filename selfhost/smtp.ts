import nodemailer from "nodemailer";
import type { Transport, Mail } from "../src/core/types.ts";
export function smtpTransport(options: {
  host: string;
  port: number;
  sender: string;
  capture?: boolean;
  dkim?: { domainName: string; keySelector: string; privateKey: string };
}): Transport {
  const client = nodemailer.createTransport({
    host: options.host,
    port: options.port,
    secure: false,
    ignoreTLS: options.capture === true,
    connectionTimeout: 15000,
    socketTimeout: 30000,
    dkim: options.dkim,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return {
    async send(m: Mail) {
      const r = await client.sendMail({
        from: options.sender,
        to: m.to,
        subject: m.subject,
        html: m.html,
        text: m.text,
        messageId: `<${m.idempotencyKey}@${options.sender.split("@")[1]}>`,
        headers: {
          "List-Unsubscribe": `<${m.unsubscribe}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
        envelope: { from: options.sender, to: m.to },
      });
      if (!r.accepted?.length) throw new Error("SMTP did not accept recipient");
      return { id: r.messageId };
    },
  };
}
