/**
 * Adaptateur de non-régression : expose les anciennes signatures de lib/seo
 * (config en constante de module) au-dessus de createSeoKit. Les assertions des
 * 56 tests historiques restent ainsi inchangées ; seul le câblage des imports diffère.
 */
import { createSeoKit } from "../src/kit";
import type { Env, FaqItem, NewsItem, PageEntry, VideoItem } from "../src/types";
import { buildGraph as _buildGraph, type GraphOptions } from "../src/schema/graph";
import { homeFaq, navitrendsPages, navitrendsSite } from "./fixtures/navitrends";

export const siteConfig = navitrendsSite;
export const pages = navitrendsPages;
export { homeFaq };
export type { FaqItem };

const kit = createSeoKit({ site: navitrendsSite, pages: navitrendsPages });

export const getPage = (p: string): PageEntry | undefined => kit.getPage(p);
export const buildMetadata = (p: string, o?: Partial<PageEntry>) => kit.buildMetadata(p, o);
export const buildOgImageUrl = (e: PageEntry): string => kit.buildOgImageUrl(e);
export const resolveSeo = (e: PageEntry) => kit.resolveSeo(e);
export const buildRobots = (env: Env) => kit.buildRobots(env);
export const buildLlmsTxt = (): string => kit.buildLlmsTxt();
export const buildNewsSitemap = (i: readonly NewsItem[], now?: Date): string => kit.buildNewsSitemap(i, now);
export const buildVideoSitemap = (i: readonly VideoItem[]): string => kit.buildVideoSitemap(i);
export const buildGraph = (p: string, o?: GraphOptions) => _buildGraph(kit.context, p, o);
