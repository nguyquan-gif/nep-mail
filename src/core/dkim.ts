/**
 * DKIM key generation without Node-only APIs, so the same code runs in the
 * self-host server and in a browser-based deployment.
 */
const b64 = (buffer: ArrayBuffer | Uint8Array) => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const pem = (label: string, der: ArrayBuffer) =>
  `-----BEGIN ${label}-----\n${b64(der)
    .replace(/(.{64})/g, "$1\n")
    .trim()}\n-----END ${label}-----\n`;

export type DkimKey = {
  selector: string;
  domain: string;
  bits: number;
  privateKeyPem: string;
  publicKeyPem: string;
  /** Value for `<selector>._domainkey.<domain>` TXT. */
  dnsValue: string;
  /** Fully qualified DNS name to publish. */
  dnsName: string;
  /** Suggested file name for DKIM_PRIVATE_KEY_FILE. */
  fileName: string;
};

export async function generateDkimKey(
  selector: string,
  domain: string,
  bits: 1024 | 2048 = 2048,
): Promise<DkimKey> {
  const pair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: bits,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const spki = await crypto.subtle.exportKey("spki", pair.publicKey);
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const publicKeyPem = pem("PUBLIC KEY", spki);
  const privateKeyPem = pem("PRIVATE KEY", pkcs8);
  // The p= value is the base64 of the DER SubjectPublicKeyInfo, one line.
  const dnsValue = `v=DKIM1; k=rsa; p=${b64(spki)}`;
  return {
    selector,
    domain,
    bits,
    privateKeyPem,
    publicKeyPem,
    dnsValue,
    dnsName: `${selector}._domainkey.${domain}`,
    fileName: `${selector}.key`,
  };
}

/** Split a long TXT value into 255-byte strings for zone files. */
export function txtChunks(value: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < value.length; i += 255) out.push(value.slice(i, i + 255));
  return out.length ? out : [""];
}
