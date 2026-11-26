/**
 * robots.txt par environnement. `env` est un paramètre explicite : le noyau ne lit jamais process.env.
 *  - SEO_ENV = "production" autorise l'indexation ; toute autre valeur = staging (tout bloqué)
 *  - SEO_AI_BLOCK = "all" ou liste "GPTBot,ClaudeBot" des crawlers IA à bloquer
 */
import type { Env, RobotsConfig, SeoContext } from "./types";

export const AI_CRAWLERS = ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended"] as const;

export function getBlockedAiCrawlers(env: Env): string[] {
  const raw = (env.SEO_AI_BLOCK ?? "").trim();
  if (raw === "") return [];
  if (raw.toLowerCase() === "all") return [...AI_CRAWLERS];
  const wanted = raw.split(",").map((s) => s.trim().toLowerCase());
  return AI_CRAWLERS.filter((bot) => wanted.includes(bot.toLowerCase()));
}

export function buildRobots(ctx: SeoContext, env: Env): RobotsConfig {
  if (env.SEO_ENV !== "production") {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }
  const sitemaps = [`${ctx.site.url}/sitemap.xml`];
  if ((ctx.newsItems ?? []).length > 0) sitemaps.push(`${ctx.site.url}/news-sitemap.xml`);
  if ((ctx.videoItems ?? []).length > 0) sitemaps.push(`${ctx.site.url}/video-sitemap.xml`);
  const blocked = getBlockedAiCrawlers(env);
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: ["/admin/", "/api/seo/"] },
      ...(blocked.length > 0 ? [{ userAgent: blocked, disallow: "/" }] : []),
    ],
    sitemap: sitemaps,
    host: ctx.site.url,
  };
}
