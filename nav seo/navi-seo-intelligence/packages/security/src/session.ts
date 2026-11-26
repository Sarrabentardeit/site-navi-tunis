/** Jetons de session signés (HMAC-SHA256), sans état serveur. Format : base64url(payload).base64url(signature) */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface SessionPayload {
  /** user id */
  readonly sub: string;
  /** org active */
  readonly org: string;
  /** expiration (ms epoch) */
  readonly exp: number;
  /** 2e facteur validé */
  readonly mfa: boolean;
}

const b64 = (b: Buffer | string): string => Buffer.from(b).toString("base64url");

function sign(data: string, secret: string): string {
  return b64(createHmac("sha256", secret).update(data).digest());
}

export function createSessionToken(payload: SessionPayload, secret: string): string {
  if (secret.length < 32) throw new Error("secret de session trop court (32 caractères minimum)");
  const body = b64(JSON.stringify(payload));
  return `${body}.${sign(body, secret)}`;
}

export function verifySessionToken(token: string | undefined, secret: string, now: number = Date.now()): SessionPayload | undefined {
  if (!token || secret.length < 32) return undefined;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return undefined;
  const expected = Buffer.from(sign(body, secret));
  const got = Buffer.from(sig);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return undefined;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<SessionPayload>;
    if (typeof p.sub !== "string" || typeof p.org !== "string" || typeof p.exp !== "number" || typeof p.mfa !== "boolean") return undefined;
    if (p.exp <= now) return undefined;
    return { sub: p.sub, org: p.org, exp: p.exp, mfa: p.mfa };
  } catch {
    return undefined;
  }
}
