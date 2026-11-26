/** Lecture / validation / écriture de redirects.json (versionné en Git). */
import { readFileSync, existsSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type RedirectType = 301 | 302 | 307 | 410;
export const REDIRECT_TYPES: readonly RedirectType[] = [301, 302, 307, 410];

export interface RedirectRule {
  readonly source: string;
  readonly destination?: string;
  readonly type: RedirectType;
  readonly note?: string;
  readonly createdAt?: string;
}

export class RedirectsValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`redirects.json invalide :\n- ${issues.join("\n- ")}`);
    this.name = "RedirectsValidationError";
  }
}

/** Fichier de redirections : SEO_REDIRECTS_FILE (ex. hors dépôt sur le VPS) ou ./redirects.json. L'environnement est un paramètre. */
export const defaultRedirectsFile = (env: Readonly<Record<string, string | undefined>> = process.env): string =>
  env.SEO_REDIRECTS_FILE ?? path.join(process.cwd(), "redirects.json");

/**
 * Caractères interdits dans une source ou une destination :
 *  - contrôles (dont CR/LF) et espaces : injection de directives dans la config Apache générée ;
 *  - antislash : « /\\evil.com » est interprété comme « //evil.com » par les navigateurs (redirection ouverte).
 */
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[\u0000-\u0020\u007f\\]/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Valide et normalise le contenu brut de redirects.json (tableau ou { redirects: [] }). */
export function parseRedirects(raw: unknown): RedirectRule[] {
  const list: unknown = isRecord(raw) ? raw.redirects : raw;
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw new RedirectsValidationError(["la racine doit être un tableau ou { \"redirects\": [] }"]);

  const issues: string[] = [];
  const rules: RedirectRule[] = [];
  const sources = new Set<string>();

  list.forEach((item: unknown, i) => {
    const label = `#${i + 1}`;
    if (!isRecord(item)) return void issues.push(`${label} : objet attendu`);
    const { source, destination, type, note, createdAt } = item;
    if (typeof source !== "string" || !source.startsWith("/") || source.startsWith("//") || source.length > 500 || FORBIDDEN_CHARS.test(source)) {
      return void issues.push(`${label} : source invalide (un seul "/" initial, sans espace, contrôle ni antislash)`);
    }
    if (typeof type !== "number" || !REDIRECT_TYPES.includes(type as RedirectType)) {
      return void issues.push(`${label} ${source} : type doit valoir 301, 302, 307 ou 410`);
    }
    if (sources.has(source)) return void issues.push(`${label} : source dupliquée ${source}`);
    sources.add(source);
    if (type !== 410) {
      if (typeof destination !== "string" || !/^(\/(?!\/)|https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?(?=[/?#]|$))/.test(destination) || FORBIDDEN_CHARS.test(destination) || destination.length > 2000) {
        return void issues.push(`${label} ${source} : destination invalide`);
      }
      if (destination === source) return void issues.push(`${label} ${source} : redirection vers elle-même`);
    }
    rules.push({
      source,
      type: type as RedirectType,
      ...(typeof destination === "string" && type !== 410 ? { destination } : {}),
      ...(typeof note === "string" ? { note } : {}),
      ...(typeof createdAt === "string" ? { createdAt } : {}),
    });
  });

  // Détection de boucles (A→B→…→A)
  const map = new Map(rules.filter((r) => r.destination).map((r) => [r.source, r.destination as string]));
  for (const start of map.keys()) {
    let cur: string | undefined = start;
    for (let step = 0; step < 10 && cur !== undefined; step++) {
      cur = map.get(cur);
      if (cur === start) {
        issues.push(`boucle de redirection détectée depuis ${start}`);
        break;
      }
    }
  }
  if (issues.length > 0) throw new RedirectsValidationError(issues);
  return rules;
}

/** Charge redirects.json (synchrone : utilisé dans next.config.ts). Fichier absent = []. */
export function loadRedirects(file: string = defaultRedirectsFile()): RedirectRule[] {
  if (!existsSync(file)) return [];
  return parseRedirects(JSON.parse(readFileSync(file, "utf8")) as unknown);
}

export interface NextRedirect {
  source: string;
  destination: string;
  statusCode: 301 | 302 | 307;
}

/** Règles 301/302/307 au format `redirects()` de Next.js. */
export function toNextRedirects(rules: readonly RedirectRule[]): NextRedirect[] {
  return rules.flatMap((r) =>
    r.type !== 410 && r.destination ? [{ source: r.source, destination: r.destination, statusCode: r.type }] : [],
  );
}

/** Règles 410 : réécrites vers /api/seo/gone qui répond 410 Gone. */
export function toGoneRewrites(rules: readonly RedirectRule[]): { source: string; destination: string }[] {
  return rules.filter((r) => r.type === 410).map((r) => ({ source: r.source, destination: "/api/seo/gone" }));
}

/** Ajoute une règle dans redirects.json (écriture atomique). Utilisé par l'admin. */
export async function addRedirect(rule: RedirectRule, file: string = defaultRedirectsFile()): Promise<void> {
  let current: RedirectRule[] = [];
  try {
    current = parseRedirects(JSON.parse(await readFile(file, "utf8")) as unknown);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const next = parseRedirects([...current, { ...rule, createdAt: new Date().toISOString() }]);
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify({ redirects: next }, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}
