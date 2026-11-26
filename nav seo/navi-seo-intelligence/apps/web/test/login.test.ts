import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PgClientLike, PgPoolLike } from "@navi/db";
import { base32Encode, createRateLimiter, encryptCredentials, hashPassword, parseKeyRing, totpCode } from "@navi/security";
import { authenticate } from "../src/lib/login";

const ring = parseKeyRing(`1:${randomBytes(32).toString("base64")}`);
const USER = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const ORG = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
const NOW = 1_700_000_000_000;

async function setup(opts: { totp?: boolean; disabled?: boolean; noOrg?: boolean } = {}) {
  const secretB32 = base32Encode(Buffer.from("12345678901234567890"));
  const enc = opts.totp ? encryptCredentials(secretB32, ring, `user:${USER}|totp`) : undefined;
  const user = { id: USER, password_hash: await hashPassword("mot-de-passe-correct"), totp_secret_enc: enc?.blob ?? null, totp_key_version: enc?.keyVersion ?? null, disabled_at: opts.disabled ? new Date() : null };
  const calls: { sql: string; values?: readonly unknown[] }[] = [];
  const client: PgClientLike = {
    query: async <R>(sql: string, values?: readonly unknown[]) => {
      calls.push({ sql, values });
      const rows: unknown[] = sql.includes("auth_find_user") ? (values?.[0] === "ok@example.com" ? [user] : []) : sql.includes("auth_user_orgs") ? (opts.noOrg ? [] : [{ org_id: ORG, slug: "a", name: "A", role: "owner" }]) : [];
      return { rows: rows as R[], rowCount: rows.length };
    },
    release: () => undefined,
  };
  const pool: PgPoolLike = { connect: async () => client };
  const deps = { pool, ring, limiter: createRateLimiter({ max: 5, windowMs: 900_000 }), hashIp: () => Buffer.from("h"), now: () => NOW };
  return { deps, calls, secret: Buffer.from("12345678901234567890") };
}
const ok = { email: "OK@example.com ", password: "mot-de-passe-correct", ip: "1.2.3.4" };
const audits = (calls: { sql: string }[]) => calls.filter((c) => c.sql.includes("insert into audit_log"));

describe("authenticate", () => {
  it("connexion réussie sans TOTP : mfa=false, organisations renvoyées, audit login_success", async () => {
    const { deps, calls } = await setup();
    const r = await authenticate(deps, ok);
    expect(r).toMatchObject({ ok: true, userId: USER, mfa: false });
    expect(audits(calls)).toHaveLength(1);
    expect(audits(calls)[0]!.sql).toContain("login_success");
  });
  it("mauvais mot de passe et compte inconnu : même résultat « invalid », audit login_failure", async () => {
    const a = await setup();
    const bad = await authenticate(a.deps, { ...ok, password: "mauvais-mot-de-passe" });
    const b = await setup();
    const unknown = await authenticate(b.deps, { ...ok, email: "inconnu@example.com" });
    expect(bad).toEqual({ ok: false, reason: "invalid" });
    expect(unknown).toEqual({ ok: false, reason: "invalid" });
    expect(audits(a.calls)[0]!.sql).toContain("login_failure");
  });
  it("compte désactivé ou sans organisation : refusé", async () => {
    expect(await authenticate((await setup({ disabled: true })).deps, ok)).toEqual({ ok: false, reason: "invalid" });
    expect(await authenticate((await setup({ noOrg: true })).deps, ok)).toEqual({ ok: false, reason: "invalid" });
  });
  it("TOTP configuré : exigé, vérifié, mfa=true", async () => {
    const { deps, secret } = await setup({ totp: true });
    expect(await authenticate(deps, ok)).toEqual({ ok: false, reason: "totp_required" });
    expect(await authenticate(deps, { ...ok, totp: "000000" })).toEqual({ ok: false, reason: "totp_invalid" });
    expect(await authenticate(deps, { ...ok, totp: totpCode(secret, NOW) })).toMatchObject({ ok: true, mfa: true });
  });
  it("limite les tentatives par IP+e-mail, sans toucher la base une fois bloqué", async () => {
    const { deps, calls } = await setup();
    for (let i = 0; i < 5; i++) await authenticate(deps, { ...ok, password: "mauvais-mot-de-passe" });
    const before = calls.length;
    expect(await authenticate(deps, ok)).toEqual({ ok: false, reason: "rate_limited" });
    expect(calls.length).toBe(before);
  });
});
