import type { RedirectRule } from "./load";

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Convertit redirects.json en règles mod_rewrite pour le VirtualHost Apache (chemins exacts uniquement :
 * les motifs avec :param, * ou ( ) restent gérés par Next.js). 410 → [G].
 */
export function toApacheConf(rules: readonly RedirectRule[]): string {
  const lines = ["# Généré par scripts/export-apache.ts — ne pas éditer à la main", "RewriteEngine On"];
  for (const r of rules) {
    if (/[:*()?]/.test(r.source)) {
      lines.push(`# ignoré (motif dynamique, géré par Next.js) : ${r.source}`);
      continue;
    }
    const pattern = `^${escapeRegex(r.source)}$`;
    lines.push(r.type === 410 ? `RewriteRule ${pattern} - [G,L]` : `RewriteRule ${pattern} ${r.destination ?? "/"} [R=${r.type},L,NE]`);
  }
  return `${lines.join("\n")}\n`;
}
