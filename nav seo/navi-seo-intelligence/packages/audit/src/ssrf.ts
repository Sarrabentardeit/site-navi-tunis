/** Garde SSRF : refuse tout ce qui n'est pas une adresse publique routable. */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224
    );
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x === "::" || x === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    if (mapped) return isPrivateAddress(mapped[1] as string);
    return /^(fc|fd)/.test(x) || /^fe[89ab]/.test(x) || x.startsWith("ff");
  }
  return true; // illisible = refusé
}

export type Resolver = (host: string) => Promise<string[]>;
const defaultResolver: Resolver = async (host) => (await lookup(host, { all: true })).map((r) => r.address);

export async function assertPublicUrl(url: string, resolve: Resolver = defaultResolver): Promise<void> {
  const u = new URL(url);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(`protocole refusé : ${u.protocol}`);
  if (u.username || u.password) throw new Error("identifiants dans l'URL refusés");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [host] : await resolve(host);
  if (addrs.length === 0) throw new Error(`hôte non résolu : ${host}`);
  for (const a of addrs) if (isPrivateAddress(a)) throw new Error(`adresse non publique refusée : ${host} → ${a}`);
}
