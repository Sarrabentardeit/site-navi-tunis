import { describe, expect, it } from "vitest";
import { buildLlmsTxt, buildNewsSitemap, buildVideoSitemap } from "../legacy";
import { escapeXml } from "../../src/sitemaps-extra";

describe("sitemaps extra", () => {
  it("échappe le XML", () => expect(escapeXml(`A & B <"c">`)).toBe("A &amp; B &lt;&quot;c&quot;&gt;"));
  it("news : ne garde que les 2 derniers jours", () => {
    const now = new Date("2026-11-15T12:00:00Z");
    const xml = buildNewsSitemap([{ path: "/insights/a", title: "A & B", publishedAt: "2026-11-15T08:00:00Z" }, { path: "/insights/b", title: "B", publishedAt: "2026-10-01T08:00:00Z" }], now);
    expect(xml).toContain("https://navitrends.uk/insights/a");
    expect(xml).toContain("A &amp; B");
    expect(xml).not.toContain("/insights/b");
  });
  it("vidéo : structure complète", () => {
    const xml = buildVideoSitemap([{ pagePath: "/odoo", title: "T", description: "D", thumbnailUrl: "https://navitrends.uk/t.jpg", duration: 61.4 }]);
    expect(xml).toContain("<video:duration>61</video:duration>");
  });
  it("produit des urlset valides même vides", () => {
    expect(buildNewsSitemap([])).toContain("<urlset");
    expect(buildVideoSitemap([])).toContain("</urlset>");
  });
});

describe("llms.txt", () => {
  const txt = buildLlmsTxt();
  it("commence par un titre H1 et un résumé", () => {
    expect(txt.startsWith("# Navitrends UK\n\n> ")).toBe(true);
  });
  it("liste services, études de cas, contact", () => {
    expect(txt).toContain("## Service pages");
    expect(txt).toContain("https://navitrends.uk/odoo");
    expect(txt).toContain("## Case studies");
    expect(txt).toContain("contact@navitrends.com");
    expect(txt).toContain("5 Brayford Square");
  });
});
