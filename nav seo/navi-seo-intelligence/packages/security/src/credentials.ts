/**
 * Chiffrement des identifiants d'intégration (AES-256-GCM) avec trousseau versionné.
 * Format du blob : [1 octet version de format = 1][12 octets IV][16 octets tag][chiffré].
 * La version de clé est stockée à part (colonne `key_version`) pour permettre la rotation.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type KeyRing = ReadonlyMap<number, Buffer>;

export function parseKeyRing(spec: string): KeyRing {
  // Format : "1:<base64 32 octets>,2:<base64 32 octets>"
  const ring = new Map<number, Buffer>();
  for (const part of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [v, k] = part.split(":");
    const version = Number(v);
    const key = Buffer.from(k ?? "", "base64");
    if (!Number.isInteger(version) || version < 1 || key.length !== 32) throw new Error(`clé invalide dans le trousseau (version "${v}") : 32 octets en base64 attendus`);
    ring.set(version, key);
  }
  if (ring.size === 0) throw new Error("trousseau de clés vide");
  return ring;
}

export const currentKeyVersion = (ring: KeyRing): number => Math.max(...ring.keys());

/** `aad` lie le blob à son contexte (ex. "org:<id>|provider:gsc") : un blob copié ailleurs ne se déchiffre pas. */
export function encryptCredentials(plain: string, ring: KeyRing, aad: string): { blob: Buffer; keyVersion: number } {
  const keyVersion = currentKeyVersion(ring);
  const key = ring.get(keyVersion) as Buffer;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(aad));
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return { blob: Buffer.concat([Buffer.from([1]), iv, c.getAuthTag(), enc]), keyVersion };
}

export function decryptCredentials(blob: Buffer, keyVersion: number, ring: KeyRing, aad: string): string {
  const key = ring.get(keyVersion);
  if (!key) throw new Error(`clé de chiffrement version ${keyVersion} absente du trousseau`);
  if (blob.length < 29 || blob[0] !== 1) throw new Error("blob de credentials invalide");
  const d = createDecipheriv("aes-256-gcm", key, blob.subarray(1, 13));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(blob.subarray(13, 29));
  return Buffer.concat([d.update(blob.subarray(29)), d.final()]).toString("utf8");
}
