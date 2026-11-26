import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PageEntry, SeoContext } from "../types";

export const OG_SIZE = { width: 1200, height: 630 } as const;

async function loadFont(): Promise<{ name: string; data: ArrayBuffer; weight: 700; style: "normal" }[]> {
  // Optionnel : déposer une police .ttf dans public/fonts/og-bold.ttf (ex. IBM Plex Sans Bold).
  try {
    const buf = await readFile(path.join(process.cwd(), process.env.SEO_OG_FONT ?? "public/fonts/og-bold.ttf"));
    const ab = new ArrayBuffer(buf.byteLength);
    new Uint8Array(ab).set(buf);
    return [{ name: "OG", data: ab, weight: 700, style: "normal" }];
  } catch {
    return [];
  }
}

/** Rend l'image Open Graph 1200×630 d'une page (couleurs de marque). */
export async function renderOgImage(ctx: SeoContext, entry: PageEntry): Promise<ImageResponse> {
  const { navy, cyan } = ctx.site.brand;
  const eyebrow = entry.section ?? (entry.type === "home" ? ctx.site.tagline : ctx.site.name);
  const fonts = await loadFont();
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: navy, color: "#fff", padding: 72, fontFamily: fonts.length ? "OG" : "sans-serif" }}>
        <div style={{ display: "flex", fontSize: 30, color: cyan, letterSpacing: 2, textTransform: "uppercase" }}>{eyebrow}</div>
        <div style={{ display: "flex", fontSize: entry.title.length > 45 ? 60 : 76, fontWeight: 700, lineHeight: 1.1 }}>{entry.title}</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 28 }}>
          <span>{ctx.site.name}</span>
          <span style={{ color: cyan }}>{ctx.site.url.replace(/^https?:\/\//, "")}</span>
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      ...(fonts.length > 0 ? { fonts } : {}),
      headers: { "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400" },
    },
  );
}
