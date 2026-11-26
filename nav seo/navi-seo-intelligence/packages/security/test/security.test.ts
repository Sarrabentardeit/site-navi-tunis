import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, createSessionToken, decryptCredentials, encryptCredentials, hashPassword, parseKeyRing, totpCode, verifyPassword, verifySessionToken, verifyTotp } from "../src";

const SECRET = "x".repeat(40);

describe("mots de passe", () => {
  it("vérifie le bon mot de passe et rejette les autres", async () => {
    const h = await hashPassword("un-mot-de-passe-solide");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("un-mot-de-passe-solide", h)).toBe(true);
    expect(await verifyPassword("un-mot-de-passe-solidE", h)).toBe(false);
  });
  it("rejette un hash absent ou corrompu sans lever d'erreur", async () => {
    expect(await verifyPassword("x", null)).toBe(false);
    expect(await verifyPassword("x", "n'importe quoi")).toBe(false);
  });
  it("refuse un mot de passe trop court", async () => {
    await expect(hashPassword("court")).rejects.toThrow();
  });
});

describe("sessions", () => {
  const payload = { sub: "u1", org: "o1", exp: 2_000_000, mfa: true };
  it("aller-retour valide", () => {
    expect(verifySessionToken(createSessionToken(payload, SECRET), SECRET, 1_000_000)).toEqual(payload);
  });
  it("rejette expiré, altéré, mauvais secret", () => {
    const t = createSessionToken(payload, SECRET);
    expect(verifySessionToken(t, SECRET, 3_000_000)).toBeUndefined();
    const [b, s] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ ...payload, org: "o2" })).toString("base64url");
    expect(verifySessionToken(`${forged}.${s}`, SECRET, 1_000_000)).toBeUndefined();
    expect(verifySessionToken(`${b}.AAAA`, SECRET, 1_000_000)).toBeUndefined();
    expect(verifySessionToken(t, "y".repeat(40), 1_000_000)).toBeUndefined();
    expect(verifySessionToken(undefined, SECRET)).toBeUndefined();
  });
  it("refuse un secret trop court", () => {
    expect(() => createSessionToken(payload, "court")).toThrow();
  });
});

describe("chiffrement des credentials", () => {
  const k1 = randomBytes(32).toString("base64");
  const k2 = randomBytes(32).toString("base64");
  it("aller-retour et rotation de clé", () => {
    const old = parseKeyRing(`1:${k1}`);
    const { blob, keyVersion } = encryptCredentials('{"token":"abc"}', old, "org:1|gsc");
    expect(keyVersion).toBe(1);
    const ring = parseKeyRing(`1:${k1},2:${k2}`);
    expect(decryptCredentials(blob, 1, ring, "org:1|gsc")).toBe('{"token":"abc"}');
    expect(encryptCredentials("x", ring, "a").keyVersion).toBe(2);
  });
  it("lie le blob à son contexte (AAD) et détecte l'altération", () => {
    const ring = parseKeyRing(`1:${k1}`);
    const { blob } = encryptCredentials("secret", ring, "org:1|gsc");
    expect(() => decryptCredentials(blob, 1, ring, "org:2|gsc")).toThrow();
    const tampered = Buffer.from(blob);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] as number) ^ 1;
    expect(() => decryptCredentials(tampered, 1, ring, "org:1|gsc")).toThrow();
    expect(() => decryptCredentials(blob, 9, ring, "org:1|gsc")).toThrow();
  });
  it("refuse un trousseau invalide", () => {
    expect(() => parseKeyRing("")).toThrow();
    expect(() => parseKeyRing("1:court")).toThrow();
  });
});

describe("TOTP (vecteurs RFC 6238, SHA-1)", () => {
  const secret = Buffer.from("12345678901234567890");
  it("produit les codes de référence", () => {
    expect(totpCode(secret, 59_000)).toBe("287082");
    expect(totpCode(secret, 1_111_111_109_000)).toBe("081804");
    expect(totpCode(secret, 1_234_567_890_000)).toBe("005924");
  });
  it("vérifie avec tolérance ±1 pas et rejette le reste", () => {
    const b32 = base32Encode(secret);
    expect(base32Decode(b32).equals(secret)).toBe(true);
    expect(verifyTotp(b32, "287082", 59_000)).toBe(true);
    expect(verifyTotp(b32, "287082", 59_000 + 30_000)).toBe(true);
    expect(verifyTotp(b32, "287082", 59_000 + 90_000)).toBe(false);
    expect(verifyTotp(b32, "12345", 59_000)).toBe(false);
  });
});

import { signBody, verifySignature } from "../src";
describe("signature des lots", () => {
  const body = '{"a":1}';
  it("accepte une signature valide dans la fenêtre", () => {
    const { timestamp, signature } = signBody(body, SECRET, 1_700_000_000_000);
    expect(verifySignature(body, SECRET, timestamp, signature, 1_700_000_060_000)).toBe(true);
  });
  it("rejette corps modifié, mauvais secret, rejeu tardif, entrées mal formées", () => {
    const { timestamp, signature } = signBody(body, SECRET, 1_700_000_000_000);
    expect(verifySignature('{"a":2}', SECRET, timestamp, signature, 1_700_000_000_000)).toBe(false);
    expect(verifySignature(body, "z".repeat(40), timestamp, signature, 1_700_000_000_000)).toBe(false);
    expect(verifySignature(body, SECRET, timestamp, signature, 1_700_000_000_000 + 6 * 60_000)).toBe(false);
    expect(verifySignature(body, SECRET, "abc", "zz", 0)).toBe(false);
    expect(verifySignature(body, SECRET, null, null)).toBe(false);
  });
});

import { createRateLimiter } from "../src";
describe("createRateLimiter", () => {
  it("autorise max tentatives par fenêtre puis bloque, puis libère", () => {
    const l = createRateLimiter({ max: 3, windowMs: 1000 });
    expect([1, 2, 3, 4].map((i) => l.hit("k", i))).toEqual([true, true, true, false]);
    expect(l.hit("autre", 5)).toBe(true);
    expect(l.hit("k", 1200)).toBe(true); // fenêtre écoulée pour les 3 premiers
  });
  it("reset efface la clé ; la mémoire reste bornée", () => {
    const l = createRateLimiter({ max: 1, windowMs: 1000, maxKeys: 2 });
    l.hit("a", 1); l.hit("a", 2);
    l.reset("a");
    expect(l.hit("a", 3)).toBe(true);
    l.hit("b", 4); l.hit("c", 5);
    expect(l.hit("a", 6)).toBe(true); // "a" évincée, repart de zéro
  });
});
