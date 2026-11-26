/**
 * Point d'entrée multi-sites : `createSeoKit({ site, pages })` lie la configuration
 * d'un site à toutes les fonctions du noyau. Aucune lecture de process.env ici.
 */
import type { Env, FaqItem, PageEntry, SeoContext, SeoMetadata, RobotsConfig, NewsItem, VideoItem } from "./types";
import { absoluteUrl, getIndexablePages, getPage, normalizePath } from "./pages";
import { buildMetadata, buildOgImageUrl, buildRootMetadata, resolveSeo } from "./metadata";
import { buildRobots } from "./robots";
import { buildLlmsTxt } from "./llms";
import { buildNewsSitemap, buildVideoSitemap } from "./sitemaps-extra";
import { buildGraph, type GraphOptions } from "./schema/graph";
import type { SchemaGraph } from "./schema/types";

export interface SeoKit {
  readonly context: SeoContext;
  absoluteUrl(path: string): string;
  getPage(path: string): PageEntry | undefined;
  getIndexablePages(): PageEntry[];
  normalizePath(path: string): string;
  buildMetadata(path: string, overrides?: Partial<PageEntry>): SeoMetadata;
  buildRootMetadata(): SeoMetadata;
  buildOgImageUrl(entry: PageEntry): string;
  resolveSeo(entry: PageEntry, now?: Date): { title: string; description: string };
  buildRobots(env: Env): RobotsConfig;
  buildLlmsTxt(): string;
  buildNewsSitemap(items?: readonly NewsItem[], now?: Date): string;
  buildVideoSitemap(items?: readonly VideoItem[]): string;
  buildGraph(path: string, options?: GraphOptions): SchemaGraph;
}

export function createSeoKit(context: SeoContext): SeoKit {
  const site = context.site;
  if (!/^https?:\/\/[^/]+$/.test(site.url)) {
    throw new Error(`site.url doit être une origine sans slash final (reçu : "${site.url}")`);
  }
  const seen = new Set<string>();
  for (const p of context.pages) {
    if (p.path !== normalizePath(p.path)) throw new Error(`Chemin non normalisé dans le registre : "${p.path}"`);
    if (seen.has(p.path)) throw new Error(`Chemin dupliqué dans le registre : "${p.path}"`);
    seen.add(p.path);
  }
  return {
    context,
    absoluteUrl: (path) => absoluteUrl(context, path),
    getPage: (path) => getPage(context, path),
    getIndexablePages: () => getIndexablePages(context),
    normalizePath,
    buildMetadata: (path, overrides) => buildMetadata(context, path, overrides),
    buildRootMetadata: () => buildRootMetadata(context),
    buildOgImageUrl: (entry) => buildOgImageUrl(context, entry),
    resolveSeo: (entry, now) => resolveSeo(context, entry, now),
    buildRobots: (env) => buildRobots(context, env),
    buildLlmsTxt: () => buildLlmsTxt(context),
    buildNewsSitemap: (items = context.newsItems ?? [], now) => buildNewsSitemap(context, items, now),
    buildVideoSitemap: (items = context.videoItems ?? []) => buildVideoSitemap(context, items),
    buildGraph: (path, options) => buildGraph(context, path, options),
  };
}

export type { FaqItem };
