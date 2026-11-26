/** Générateurs XML pour les sitemaps News et Vidéo. */
import type { NewsItem, SeoContext, VideoItem } from "./types";
import { absoluteUrl } from "./pages";

/** Échappe les caractères spéciaux XML. */
export function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** Sitemap Google News : uniquement les articles des 2 derniers jours (règle Google). */
export function buildNewsSitemap(ctx: SeoContext, items: readonly NewsItem[], now: Date = new Date()): string {
  const limit = now.getTime() - 2 * 24 * 60 * 60 * 1000;
  const recent = items.filter((i) => new Date(i.publishedAt).getTime() >= limit);
  const body = recent
    .map(
      (i) => `  <url>
    <loc>${escapeXml(absoluteUrl(ctx, i.path))}</loc>
    <news:news>
      <news:publication><news:name>${escapeXml(ctx.site.name)}</news:name><news:language>en</news:language></news:publication>
      <news:publication_date>${escapeXml(i.publishedAt)}</news:publication_date>
      <news:title>${escapeXml(i.title)}</news:title>
    </news:news>
  </url>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${body}
</urlset>
`;
}

/** Sitemap vidéo. */
export function buildVideoSitemap(ctx: SeoContext, items: readonly VideoItem[]): string {
  const body = items
    .map((v) => {
      const lines = [
        `      <video:thumbnail_loc>${escapeXml(v.thumbnailUrl)}</video:thumbnail_loc>`,
        `      <video:title>${escapeXml(v.title)}</video:title>`,
        `      <video:description>${escapeXml(v.description)}</video:description>`,
      ];
      if (v.contentUrl) lines.push(`      <video:content_loc>${escapeXml(v.contentUrl)}</video:content_loc>`);
      if (v.playerUrl) lines.push(`      <video:player_loc>${escapeXml(v.playerUrl)}</video:player_loc>`);
      if (v.duration !== undefined) lines.push(`      <video:duration>${Math.round(v.duration)}</video:duration>`);
      if (v.publishedAt) lines.push(`      <video:publication_date>${escapeXml(v.publishedAt)}</video:publication_date>`);
      return `  <url>\n    <loc>${escapeXml(absoluteUrl(ctx, v.pagePath))}</loc>\n    <video:video>\n${lines.join("\n")}\n    </video:video>\n  </url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
${body}
</urlset>
`;
}
