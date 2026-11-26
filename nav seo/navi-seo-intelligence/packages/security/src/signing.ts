/** Signature des lots envoyés par apps/log-agent : HMAC-SHA256 sur "<timestamp>.<corps>", fenêtre anti-rejeu. */
import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_TOLERANCE_MS = 5 * 60_000;

export function signBody(body: string, secret: string, timestampMs: number = Date.now()): { timestamp: string; signature: string } {
  const timestamp = String(timestampMs);
  return { timestamp, signature: createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex") };
}

export function verifySignature(body: string, secret: string, timestamp: string | null | undefined, signature: string | null | undefined, nowMs: number = Date.now()): boolean {
  if (!timestamp || !signature || !/^\d{10,16}$/.test(timestamp) || !/^[0-9a-f]{64}$/.test(signature)) return false;
  if (Math.abs(nowMs - Number(timestamp)) > SIGNATURE_TOLERANCE_MS) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex"));
  return timingSafeEqual(expected, Buffer.from(signature));
}
