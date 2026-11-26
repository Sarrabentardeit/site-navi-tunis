/** TOTP (RFC 6238, HMAC-SHA1, 30 s, 6 chiffres) — compatible Google Authenticator et équivalents. */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of s.replace(/=+$/, "").toUpperCase()) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error("base32 invalide");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export const generateTotpSecret = (): string => base32Encode(randomBytes(20));

export function totpCode(secret: Buffer, atMs: number, digits = 6, stepSec = 30): string {
  const counter = Math.floor(atMs / 1000 / stepSec);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", secret).update(msg).digest();
  const off = (h[h.length - 1] as number) & 0xf;
  const bin = (((h[off] as number) & 0x7f) << 24) | (((h[off + 1] as number) & 0xff) << 16) | (((h[off + 2] as number) & 0xff) << 8) | ((h[off + 3] as number) & 0xff);
  return String(bin % 10 ** digits).padStart(digits, "0");
}

/** Vérifie un code avec une tolérance de ±1 pas (dérive d'horloge). */
export function verifyTotp(secretBase32: string, code: string, nowMs: number = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const secret = base32Decode(secretBase32);
  let ok = false;
  for (const delta of [-1, 0, 1]) {
    const expected = Buffer.from(totpCode(secret, nowMs + delta * 30_000));
    if (timingSafeEqual(expected, Buffer.from(code))) ok = true;
  }
  return ok;
}

export const otpauthUri = (secretBase32: string, account: string, issuer = "Navi-SEO"): string =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;
