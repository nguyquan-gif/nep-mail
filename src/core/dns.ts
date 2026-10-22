/**
 * Sending-domain readiness checks over DNS-over-HTTPS.
 *
 * DoH keeps the app runtime-agnostic (no `node:dns`) and works behind the same
 * egress rules as the rest of the app. Results are facts plus a status code;
 * the UI owns the wording, so no translated string is baked into the payload.
 */
export type DnsRecord = { name: string; type: string; value: string };
export type CheckId = "mx" | "spf" | "dkim" | "dmarc";
export type CheckStatus = "ok" | "warn" | "fail";
export type DnsCheck = {
  id: CheckId;
  status: CheckStatus;
  /** Raw record(s) that produced the verdict, for the operator to read. */
  records: string[];
  /** Machine-readable reason, e.g. "missing", "multiple", "policy-none". */
  reason?: string;
};
export type DnsReport = {
  domain: string;
  selector: string;
  checks: DnsCheck[];
  ready: boolean;
  resolver: string;
};

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const RESOLVER = "https://cloudflare-dns.com/dns-query";

export function domainOk(domain: string): boolean {
  return (
    /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(
      domain,
    ) && !/\.(invalid|test|localhost|example)$/i.test(domain)
  );
}

export function selectorOk(selector: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,62})$/i.test(selector);
}

async function resolveTxt(name: string, fetcher: Fetcher): Promise<string[]> {
  const url = `${RESOLVER}?name=${encodeURIComponent(name)}&type=TXT`;
  const response = await fetcher(url, {
    headers: { accept: "application/dns-json" },
  });
  if (!response.ok) throw new Error(`dns_${response.status}`);
  const body = (await response.json()) as {
    Answer?: { type: number; data: string }[];
  };
  return (body.Answer || [])
    .filter((a) => a.type === 16)
    .map((a) => a.data.replace(/^"|"$/g, "").replace(/"\s*"/g, ""));
}

async function resolveMx(name: string, fetcher: Fetcher): Promise<string[]> {
  const url = `${RESOLVER}?name=${encodeURIComponent(name)}&type=MX`;
  const response = await fetcher(url, {
    headers: { accept: "application/dns-json" },
  });
  if (!response.ok) throw new Error(`dns_${response.status}`);
  const body = (await response.json()) as {
    Answer?: { type: number; data: string }[];
  };
  return (body.Answer || []).filter((a) => a.type === 15).map((a) => a.data);
}

export async function checkDomain(
  domain: string,
  selector: string,
  fetcher: Fetcher = fetch,
): Promise<DnsReport> {
  if (!domainOk(domain)) throw new Error("domain_invalid");
  if (!selectorOk(selector)) throw new Error("selector_invalid");

  const [mx, rootTxt, dkimTxt, dmarcTxt] = await Promise.all([
    resolveMx(domain, fetcher).catch(() => [] as string[]),
    resolveTxt(domain, fetcher).catch(() => [] as string[]),
    resolveTxt(`${selector}._domainkey.${domain}`, fetcher).catch(
      () => [] as string[],
    ),
    resolveTxt(`_dmarc.${domain}`, fetcher).catch(() => [] as string[]),
  ]);

  const checks: DnsCheck[] = [];

  checks.push(
    mx.length
      ? { id: "mx", status: "ok", records: mx }
      : { id: "mx", status: "warn", records: [], reason: "missing" },
  );

  const spf = rootTxt.filter((r) => /^v=spf1\b/i.test(r));
  if (!spf.length)
    checks.push({ id: "spf", status: "fail", records: [], reason: "missing" });
  else if (spf.length > 1)
    checks.push({
      id: "spf",
      status: "fail",
      records: spf,
      reason: "multiple",
    });
  else
    checks.push({
      id: "spf",
      status: /\s[-~]all\b/i.test(spf[0]) ? "ok" : "warn",
      records: spf,
      reason: /\s[-~]all\b/i.test(spf[0]) ? undefined : "no-all",
    });

  const dkim = dkimTxt.filter((r) => /v=DKIM1/i.test(r));
  const published = dkim.some((r) =>
    /(?:^|;\s*)p=[A-Za-z0-9+/=]{100,}/.test(r),
  );
  checks.push(
    !dkim.length
      ? { id: "dkim", status: "fail", records: [], reason: "missing" }
      : published
        ? { id: "dkim", status: "ok", records: dkim }
        : { id: "dkim", status: "fail", records: dkim, reason: "empty-key" },
  );

  const dmarc = dmarcTxt.filter((r) => /^v=DMARC1\b/i.test(r));
  const policy = dmarc[0]?.match(/\bp=(\w+)/i)?.[1]?.toLowerCase();
  checks.push(
    !dmarc.length
      ? { id: "dmarc", status: "warn", records: [], reason: "missing" }
      : policy === "none"
        ? { id: "dmarc", status: "warn", records: dmarc, reason: "policy-none" }
        : policy === "quarantine" || policy === "reject"
          ? { id: "dmarc", status: "ok", records: dmarc }
          : { id: "dmarc", status: "warn", records: dmarc, reason: "policy" },
  );

  return {
    domain,
    selector,
    checks,
    // Warnings (no MX, DMARC p=none) are advisory; only hard failures block.
    ready: checks.every((c) => c.status !== "fail"),
    resolver: "cloudflare-dns.com",
  };
}
