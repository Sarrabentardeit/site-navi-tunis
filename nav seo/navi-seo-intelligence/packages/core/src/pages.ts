import type { PageEntry, SeoContext } from "./types";

/** Normalise un chemin : sans query/hash, sans slash final (sauf racine). */
export function normalizePath(input: string): string {
  const clean = (input.split(/[?#]/)[0] ?? "").trim();
  if (clean === "" || clean === "/") return "/";
  const withSlash = clean.startsWith("/") ? clean : `/${clean}`;
  return withSlash.replace(/\/+$/, "");
}

/** URL absolue canonique d'un chemin (la racine n'a pas de slash final). */
export function absoluteUrl(ctx: SeoContext, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const p = normalizePath(path);
  return p === "/" ? ctx.site.url : `${ctx.site.url}${p}`;
}

export function getPage(ctx: SeoContext, path: string): PageEntry | undefined {
  const p = normalizePath(path);
  return ctx.pages.find((entry) => entry.path === p);
}

export function getIndexablePages(ctx: SeoContext): PageEntry[] {
  return ctx.pages.filter((entry) => entry.noindex !== true);
}

/** Transforme "case-studies" en "Case Studies" (fallback pour pages non déclarées). */
export function humanizeSegment(segment: string): string {
  return segment
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
