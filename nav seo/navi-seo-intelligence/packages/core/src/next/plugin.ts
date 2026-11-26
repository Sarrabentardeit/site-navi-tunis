/**
 * Enveloppe next.config : ajoute les redirections de redirects.json (301/302/307)
 * et les réponses 410 (réécriture vers /api/seo/gone). Types structurels : pas de dépendance à `next`.
 */
import { loadRedirects, toGoneRewrites, toNextRedirects } from "../redirects/load";

type Rule = { source: string; destination: string; [k: string]: unknown };
type RewritesObject = { beforeFiles?: Rule[]; afterFiles?: Rule[]; fallback?: Rule[] };

export interface NextConfigLike {
  redirects?: () => Promise<Rule[]>;
  rewrites?: () => Promise<Rule[] | RewritesObject>;
  [key: string]: unknown;
}

export function withNaviSeo<T extends NextConfigLike>(config: T = {} as T, options: { redirectsFile?: string } = {}): T {
  const rules = loadRedirects(options.redirectsFile);
  return {
    ...config,
    async redirects() {
      const existing = config.redirects ? await config.redirects() : [];
      return [...(toNextRedirects(rules) as unknown as Rule[]), ...existing];
    },
    async rewrites() {
      const gone = toGoneRewrites(rules) as unknown as Rule[];
      const existing = config.rewrites ? await config.rewrites() : [];
      if (Array.isArray(existing)) return { beforeFiles: gone, afterFiles: existing, fallback: [] };
      return { ...existing, beforeFiles: [...gone, ...(existing.beforeFiles ?? [])] };
    },
  };
}
