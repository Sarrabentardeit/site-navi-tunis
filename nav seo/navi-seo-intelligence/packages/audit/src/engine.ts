/**
 * Moteur d'audit technique (35 règles). Extrait de scripts/seo-audit.ts : il n'écrit plus de fichier, ne lit plus process.argv
 * et renvoie un rapport structuré. Le CLI (scripts/audit.ts) et le worker l'appellent tous les deux.
 *
 * SÉCURITÉ (SSRF) : en SaaS multi-clients, l'URL à auditer est une saisie utilisateur. Chaque requête, y compris chaque
 * redirection, passe par `guard`, par défaut `assertPublicUrl` (refuse localhost, réseaux privés, link-local, métadonnées cloud).
 */
import * as cheerio from "cheerio";
import { auditScore, type RuleOutcome, type Severity } from "@navi/metrics";
import { validateGraph, type JsonLdNode, type SchemaGraph } from "@navi/core";
import { assertPublicUrl } from "./ssrf";

export type { Severity };
export interface Rule { id: string; label: string; severity: Severity }
export interface Result { rule: string; url: string; ok: boolean; message: string }
interface Page { url: string; status: number; ms: number; type: string; $?: cheerio.CheerioAPI; links: string[] }

export interface AuditOptions {
  readonly baseUrl: string;
  readonly maxPages?: number;
  readonly minScore?: number;
  readonly log?: (message: string) => void;
  /** Surcharge de la garde réseau (tests). Par défaut : refus des adresses non publiques. */
  readonly guard?: (url: string) => Promise<void>;
  readonly fetch?: typeof fetch;
}

export interface AuditReport {
  readonly baseUrl: string;
  readonly score: number | null;
  readonly minScore: number;
  readonly passed: boolean;
  readonly pagesCrawled: number;
  readonly results: readonly Result[];
  readonly rules: readonly Rule[];
  readonly markdown: string;
}

export const RULES: readonly Rule[] = [
  { id: "status-200", label: "La page répond 200", severity: "error" },
  { id: "title-present", label: "Balise title présente", severity: "error" },
  { id: "title-length", label: "Title entre 30 et 65 caractères", severity: "warning" },
  { id: "title-unique", label: "Title unique sur le site", severity: "warning" },
  { id: "desc-present", label: "Meta description présente", severity: "error" },
  { id: "desc-length", label: "Description entre 70 et 160 caractères", severity: "warning" },
  { id: "desc-unique", label: "Description unique sur le site", severity: "warning" },
  { id: "canonical-present", label: "Canonical présent", severity: "error" },
  { id: "canonical-valid", label: "Canonical absolu, https, même origine", severity: "error" },
  { id: "canonical-self", label: "Canonical pointe vers la page elle-même", severity: "warning" },
  { id: "h1-single", label: "Un seul H1", severity: "warning" },
  { id: "og-complete", label: "Open Graph (title, description, image, url)", severity: "warning" },
  { id: "og-image-absolute", label: "og:image en URL absolue", severity: "warning" },
  { id: "twitter-card", label: "Twitter Card présente", severity: "info" },
  { id: "html-lang", label: "Attribut lang sur <html>", severity: "warning" },
  { id: "viewport", label: "Meta viewport", severity: "error" },
  { id: "img-alt", label: "Toutes les images ont un alt", severity: "warning" },
  { id: "jsonld-present", label: "JSON-LD présent", severity: "warning" },
  { id: "jsonld-valid", label: "JSON-LD parseable et valide", severity: "error" },
  { id: "jsonld-webpage", label: "Nœud WebPage dans le schema", severity: "info" },
  { id: "robots-indexable", label: "Page indexable (pas de noindex)", severity: "error" },
  { id: "mixed-content", label: "Aucun contenu mixte http://", severity: "error" },
  { id: "response-time", label: "Temps de réponse < 1500 ms", severity: "warning" },
  { id: "links-ok", label: "Aucun lien interne cassé", severity: "error" },
  { id: "orphan", label: "Page du sitemap atteignable par un lien interne", severity: "warning" },
  { id: "robots-txt", label: "robots.txt accessible", severity: "error" },
  { id: "robots-sitemap", label: "robots.txt référence le sitemap", severity: "warning" },
  { id: "robots-open", label: "robots.txt n'interdit pas tout le site", severity: "error" },
  { id: "sitemap-ok", label: "sitemap.xml accessible et valide", severity: "error" },
  { id: "sitemap-origin", label: "URLs du sitemap sur le bon domaine", severity: "error" },
  { id: "sitemap-urls-ok", label: "URLs du sitemap répondent 200", severity: "error" },
  { id: "llms-txt", label: "llms.txt accessible", severity: "info" },
  { id: "soft-404", label: "Une URL inexistante renvoie un vrai 404", severity: "error" },
  { id: "https-redirect", label: "http:// redirige vers https://", severity: "warning" },
  { id: "home-org-schema", label: "Accueil : Organization + WebSite dans le schema", severity: "warning" },
];


export async function runAudit(opts: AuditOptions): Promise<AuditReport> {
  const BASE = opts.baseUrl.replace(/\/+$/, "");
  const MAX_PAGES = opts.maxPages ?? 150;
  const MIN_SCORE = opts.minScore ?? 80;
  const ORIGIN = new URL(BASE).origin;
  const log = opts.log ?? ((): void => undefined);
  const guard = opts.guard ?? assertPublicUrl;
  const doFetch = opts.fetch ?? fetch;
  const results: Result[] = [];
  const record = (rule: string, url: string, ok: boolean, message = ""): void => void results.push({ rule, url, ok, message });

  async function get(url: string, redirect: "follow" | "manual" = "follow"): Promise<{ status: number; ms: number; type: string; text: string; location: string | null }> {
      const t0 = Date.now();
      let current = url;
      for (let hop = 0; hop <= 5; hop++) {
        await guard(current);
        const res = await doFetch(current, { redirect: "manual", headers: { "user-agent": "navi-seo-audit/1.0" }, signal: AbortSignal.timeout(20_000) });
        const location = res.headers.get("location");
        if (res.status >= 300 && res.status < 400 && location) {
          if (redirect === "manual") return { status: res.status, ms: Date.now() - t0, type: "", text: "", location };
          current = new URL(location, current).href;
          continue;
        }
        const type = res.headers.get("content-type") ?? "";
        const text = /text|xml|json/.test(type) ? (await res.text()).slice(0, 5_000_000) : "";
        return { status: res.status, ms: Date.now() - t0, type, text, location };
      }
      throw new Error("trop de redirections");
    }

    function normalize(href: string, from: string): string | undefined {
    try {
      const u = new URL(href, from);
      if (!/^https?:$/.test(u.protocol) || u.origin !== ORIGIN) return undefined;
      if (/^\/_next\/|\.(?:pdf|jpe?g|png|webp|avif|svg|gif|css|js|ico|xml|txt|zip|woff2?)$/i.test(u.pathname)) return undefined;
      u.hash = "";
      u.search = "";
      return u.pathname === "/" ? ORIGIN : `${ORIGIN}${u.pathname.replace(/\/+$/, "")}`;
    } catch {
      return undefined;
    }
  }

  async function crawl(seeds: string[]): Promise<{ pages: Map<string, Page>; referrers: Map<string, Set<string>> }> {
    const pages = new Map<string, Page>();
    const referrers = new Map<string, Set<string>>();
    const queue = [...new Set(seeds)];
    const seen = new Set(queue);
    while (queue.length > 0 && pages.size < MAX_PAGES) {
      const batch = queue.splice(0, 5);
      await Promise.all(
        batch.map(async (url) => {
          try {
            const r = await get(url);
            const isHtml = r.type.includes("html");
            const $ = isHtml ? cheerio.load(r.text) : undefined;
            const links = $ ? $("a[href]").toArray().map((a) => normalize($(a).attr("href") ?? "", url)).filter((l): l is string => l !== undefined) : [];
            pages.set(url, { url, status: r.status, ms: r.ms, type: r.type, $, links });
            for (const l of links) {
              if (l !== url) (referrers.get(l) ?? referrers.set(l, new Set()).get(l))?.add(url);
              if (!seen.has(l)) {
                seen.add(l);
                queue.push(l);
              }
            }
          } catch (e) {
            pages.set(url, { url, status: 0, ms: 0, type: "", links: [] });
            log(`Échec ${url} : ${(e as Error).message}`);
          }
        }),
      );
    }
    return { pages, referrers };
  }

  function jsonLdNodes($: cheerio.CheerioAPI): { graph: SchemaGraph | undefined; nodes: JsonLdNode[]; error?: string; count: number } {
    const scripts = $('script[type="application/ld+json"]').toArray();
    const nodes: JsonLdNode[] = [];
    for (const s of scripts) {
      try {
        const data = JSON.parse($(s).text()) as { "@graph"?: JsonLdNode[] } & JsonLdNode;
        if (Array.isArray(data["@graph"])) nodes.push(...data["@graph"]);
        else nodes.push(data);
      } catch (e) {
        return { graph: undefined, nodes, error: (e as Error).message, count: scripts.length };
      }
    }
    return { graph: nodes.length > 0 ? { "@context": "https://schema.org", "@graph": nodes } : undefined, nodes, count: scripts.length };
  }

  const hasType = (n: JsonLdNode, t: string): boolean => (Array.isArray(n["@type"]) ? n["@type"].includes(t) : n["@type"] === t);

  function auditPage(p: Page, isHome: boolean): void {
    const u = p.url;
    record("status-200", u, p.status === 200, `HTTP ${p.status}`);
    if (!p.$ || p.status !== 200) return;
    const $ = p.$;
    const title = $("title").first().text().trim();
    const desc = $('meta[name="description"]').attr("content")?.trim() ?? "";
    const canonical = $('link[rel="canonical"]').attr("href")?.trim() ?? "";

    record("title-present", u, title !== "");
    record("title-length", u, title.length >= 30 && title.length <= 65, `${title.length} car.`);
    record("desc-present", u, desc !== "");
    record("desc-length", u, desc.length >= 70 && desc.length <= 160, `${desc.length} car.`);
    record("canonical-present", u, canonical !== "");
    let canonOk = false;
    let selfOk = false;
    try {
      const c = new URL(canonical, u);
      canonOk = c.protocol === "https:" && c.origin === ORIGIN && /^https?:\/\//.test(canonical);
      selfOk = normalize(c.href, u) === u;
    } catch { /* invalide */ }
    if (canonical) {
      record("canonical-valid", u, canonOk, canonical);
      record("canonical-self", u, selfOk, canonical);
    }
    record("h1-single", u, $("h1").length === 1, `${$("h1").length} H1`);
    const og = (n: string): string => $(`meta[property="og:${n}"]`).attr("content") ?? "";
    const ogMissing = ["title", "description", "image", "url"].filter((n) => og(n) === "");
    record("og-complete", u, ogMissing.length === 0, ogMissing.length ? `manquant : ${ogMissing.join(", ")}` : "");
    if (og("image")) record("og-image-absolute", u, /^https?:\/\//.test(og("image")), og("image"));
    record("twitter-card", u, $('meta[name="twitter:card"]').length > 0);
    record("html-lang", u, ($("html").attr("lang") ?? "") !== "");
    record("viewport", u, $('meta[name="viewport"]').length > 0);
    const noAlt = $("img").toArray().filter((i) => $(i).attr("alt") === undefined).length;
    record("img-alt", u, noAlt === 0, `${noAlt} image(s) sans alt`);
    const robotsMeta = ($('meta[name="robots"]').attr("content") ?? "").toLowerCase();
    record("robots-indexable", u, !robotsMeta.includes("noindex"), robotsMeta);
    const mixed = $("img[src^='http://'],script[src^='http://'],link[href^='http://'][rel='stylesheet'],iframe[src^='http://'],source[src^='http://']").length;
    record("mixed-content", u, mixed === 0, `${mixed} ressource(s) http://`);
    record("response-time", u, p.ms < 1500, `${p.ms} ms`);

    const ld = jsonLdNodes($);
    record("jsonld-present", u, ld.count > 0);
    if (ld.count > 0) {
      const issues = ld.error ? [`JSON invalide : ${ld.error}`] : ld.graph ? validateGraph(ld.graph) : ["vide"];
      record("jsonld-valid", u, issues.length === 0, issues.join(" ; "));
      record("jsonld-webpage", u, ld.nodes.some((n) => hasType(n, "WebPage") || hasType(n, "CollectionPage")));
      if (isHome) record("home-org-schema", u, ld.nodes.some((n) => hasType(n, "Organization")) && ld.nodes.some((n) => hasType(n, "WebSite")));
    } else if (isHome) {
      record("home-org-schema", u, false, "aucun JSON-LD");
    }
  }

    log(`Audit de ${BASE} (max ${MAX_PAGES} pages)…`);

    // robots.txt
    const robots = await get(`${BASE}/robots.txt`).catch(() => undefined);
    record("robots-txt", `${BASE}/robots.txt`, robots?.status === 200);
    const robotsText = robots?.text ?? "";
    if (robots?.status === 200) {
      record("robots-sitemap", `${BASE}/robots.txt`, /^sitemap:/im.test(robotsText));
      const starBlock = robotsText.split(/user-agent:/i).find((b) => /^\s*\*/.test(b)) ?? "";
      record("robots-open", `${BASE}/robots.txt`, !/^\s*disallow:\s*\/\s*$/im.test(starBlock), "Disallow: / détecté pour *");
    }

    // sitemap
    const sitemapUrl = `${BASE}/sitemap.xml`;
    const sm = await get(sitemapUrl).catch(() => undefined);
    const locs = [...(sm?.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g) ?? [])].map((m) => m[1] ?? "");
    record("sitemap-ok", sitemapUrl, sm?.status === 200 && locs.length > 0, `${locs.length} URL(s)`);
    const sitemapPages = new Set<string>();
    for (const l of locs) {
      const n = normalize(l, BASE);
      record("sitemap-origin", l, n !== undefined, "domaine différent");
      if (n) sitemapPages.add(n);
    }

    // llms.txt, soft 404, http→https
    const llms = await get(`${BASE}/llms.txt`).catch(() => undefined);
    record("llms-txt", `${BASE}/llms.txt`, llms?.status === 200 && llms.text.trim().startsWith("#"));
    const probe = `${BASE}/__navi-seo-probe-${Math.random().toString(36).slice(2, 8)}`;
    const p404 = await get(probe).catch(() => undefined);
    record("soft-404", probe, p404?.status === 404, `HTTP ${p404?.status ?? "erreur"}`);
    if (ORIGIN.startsWith("https://")) {
      const http = await get(ORIGIN.replace("https://", "http://"), "manual").catch(() => undefined);
      if (http) record("https-redirect", ORIGIN.replace("https://", "http://"), http.status >= 301 && http.status <= 308 && (http.location ?? "").startsWith("https://"), `HTTP ${http.status}`);
    }

    // crawl
    const { pages, referrers } = await crawl([BASE, ...sitemapPages]);
    for (const p of pages.values()) auditPage(p, p.url === BASE);

    // règles inter-pages
    const okPages = [...pages.values()].filter((p) => p.status === 200 && p.$);
    const dupes = (sel: (p: Page) => string): Map<string, Page[]> => {
      const m = new Map<string, Page[]>();
      for (const p of okPages) {
        const v = sel(p);
        if (v) m.set(v, [...(m.get(v) ?? []), p]);
      }
      return m;
    };
    const titles = dupes((p) => p.$?.("title").first().text().trim() ?? "");
    const descs = dupes((p) => p.$?.('meta[name="description"]').attr("content")?.trim() ?? "");
    for (const p of okPages) {
      record("title-unique", p.url, (titles.get(p.$?.("title").first().text().trim() ?? "")?.length ?? 1) === 1, "title dupliqué");
      record("desc-unique", p.url, (descs.get(p.$?.('meta[name="description"]').attr("content")?.trim() ?? "")?.length ?? 1) === 1, "description dupliquée");
    }
    for (const p of pages.values()) {
      if (p.type.includes("html")) {
        const broken = p.links.filter((l) => (pages.get(l)?.status ?? 200) >= 400 || pages.get(l)?.status === 0);
        record("links-ok", p.url, broken.length === 0, `cassés : ${[...new Set(broken)].join(", ")}`);
      }
    }
    for (const u of sitemapPages) {
      const status = pages.get(u)?.status;
      record("sitemap-urls-ok", u, status === 200, `HTTP ${status ?? "non crawlé"}`);
      if (u !== BASE) record("orphan", u, (referrers.get(u)?.size ?? 0) > 0, "aucun lien interne entrant");
    }

  // score (formule historique, désormais dans @navi/metrics)
  const outcomes: RuleOutcome[] = results.flatMap((r) => {
    const rule = RULES.find((x) => x.id === r.rule);
    return rule ? [{ rule: r.rule, severity: rule.severity, ok: r.ok }] : [];
  });
  const score = auditScore(outcomes);
  const passed = score !== null && score >= MIN_SCORE;
  const markdown = renderMarkdown({ baseUrl: BASE, score, minScore: MIN_SCORE, pagesCrawled: pages.size, results });
  return { baseUrl: BASE, score, minScore: MIN_SCORE, passed, pagesCrawled: pages.size, results, rules: RULES, markdown };
}

export function renderMarkdown(r: { baseUrl: string; score: number | null; minScore: number; pagesCrawled: number; results: readonly Result[] }): string {
  const byRule = new Map<string, Result[]>();
  for (const x of r.results) byRule.set(x.rule, [...(byRule.get(x.rule) ?? []), x]);
  const rows: string[] = [];
  for (const rule of RULES) {
    const rs = byRule.get(rule.id) ?? [];
    if (rs.length === 0) continue;
    const ok = rs.filter((x) => x.ok).length;
    rows.push(`| ${ok === rs.length ? "✅" : ok === 0 ? "❌" : "⚠️"} | ${rule.label} | ${rule.severity} | ${ok}/${rs.length} |`);
  }
  const failures = r.results.filter((x) => !x.ok);
  const label = (id: string): Rule | undefined => RULES.find((x) => x.id === id);
  return [
    `# Rapport d'audit SEO — ${r.baseUrl}`,
    "",
    `Pages explorées : ${r.pagesCrawled} · Contrôles : ${r.results.length}`,
    "",
    `## Score global : **${r.score === null ? "n/d" : `${r.score}/100`}** (seuil : ${r.minScore}) — ${r.score !== null && r.score >= r.minScore ? "✅ OK" : "❌ ÉCHEC"}`,
    "",
    "| | Règle | Gravité | Réussite |",
    "|---|---|---|---|",
    ...rows,
    "",
    "## Problèmes détectés",
    "",
    ...(failures.length === 0
      ? ["Aucun problème."]
      : (["error", "warning", "info"] as const).flatMap((sev) => {
          const list = failures.filter((f) => label(f.rule)?.severity === sev);
          return list.length === 0 ? [] : [`### ${sev}`, ...list.map((f) => `- **${label(f.rule)?.label ?? f.rule}** — ${f.url}${f.message ? ` — ${f.message}` : ""}`), ""];
        })),
    "",
    "_Core Web Vitals : collecte dédiée (PageSpeed Insights), hors de ce rapport._",
    "",
  ].join("\n");
}
