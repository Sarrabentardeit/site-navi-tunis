import type { Env, PageEntry, PageType, SeoContext, SeoMetadata } from "./types";
import { absoluteUrl, getPage, humanizeSegment, normalizePath } from "./pages";
import { renderTemplate, truncate } from "./templates";

export const TITLE_MAX = 60;
export const DESCRIPTION_MAX = 160;

export const TITLE_TEMPLATES: Readonly<Record<PageType, string>> = {
  home: "%sitename% | %tagline%",
  service: "%pagetitle% | %sitename%",
  "case-study": "%pagetitle% | %sitename%",
  article: "%pagetitle% | %sitename%",
  page: "%pagetitle% | %sitename%",
  legal: "%pagetitle% | %sitename%",
};

export const DESCRIPTION_TEMPLATES: Readonly<Record<PageType, string>> = {
  home: "%description%",
  service: "%description%",
  "case-study": "%description%",
  article: "%description%",
  page: "%description%",
  legal: "%description%",
};

function fallbackEntry(ctx: SeoContext, path: string): PageEntry {
  const last = normalizePath(path).split("/").filter(Boolean).pop() ?? "";
  return { path: normalizePath(path), type: "page", title: humanizeSegment(last) || ctx.site.name, description: ctx.site.description };
}

export function buildOgImageUrl(ctx: SeoContext, entry: PageEntry): string {
  if (entry.ogImage) return absoluteUrl(ctx, entry.ogImage);
  if (entry.type === "home") return absoluteUrl(ctx, ctx.site.defaultOgImage);
  return `${ctx.site.url}/api/og?path=${encodeURIComponent(entry.path)}`;
}

/** `now` est injectable pour rendre `%year%` déterministe en test. */
export function resolveSeo(ctx: SeoContext, entry: PageEntry, now: Date = new Date()): { title: string; description: string } {
  const vars = {
    sitename: ctx.site.name,
    tagline: ctx.site.tagline,
    pagetitle: entry.title,
    description: entry.description,
    section: entry.section,
    sep: "|",
    year: String(now.getFullYear()),
  };
  return {
    title: renderTemplate(TITLE_TEMPLATES[entry.type], vars),
    description: truncate(renderTemplate(DESCRIPTION_TEMPLATES[entry.type], vars), DESCRIPTION_MAX),
  };
}

export function buildMetadata(ctx: SeoContext, path: string, overrides: Partial<PageEntry> = {}): SeoMetadata {
  const base = getPage(ctx, path) ?? fallbackEntry(ctx, path);
  const entry: PageEntry = { ...base, ...overrides };
  const { title, description } = resolveSeo(ctx, entry);
  const url = absoluteUrl(ctx, entry.path);
  const image = buildOgImageUrl(ctx, entry);
  const generated = image.includes("/api/og");
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    robots: entry.noindex ? { index: false, follow: false } : undefined,
    openGraph: {
      type: entry.type === "article" ? "article" : "website",
      url,
      siteName: ctx.site.name,
      locale: ctx.site.locale,
      title,
      description,
      images: [generated ? { url: image, width: 1200, height: 630, alt: title } : { url: image, alt: title }],
      ...(entry.type === "article" && entry.datePublished ? { publishedTime: entry.datePublished } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
      ...(ctx.site.twitterHandle ? { site: ctx.site.twitterHandle } : {}),
    },
  };
}

export function buildRootMetadata(ctx: SeoContext): SeoMetadata {
  return {
    metadataBase: new URL(ctx.site.url),
    applicationName: ctx.site.name,
    ...(ctx.site.googleSiteVerification ? { verification: { google: ctx.site.googleSiteVerification } } : {}),
    ...buildMetadata(ctx, "/"),
  };
}

export type { Env };
