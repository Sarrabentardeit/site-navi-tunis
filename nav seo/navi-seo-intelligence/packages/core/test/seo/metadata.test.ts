import { describe, expect, it } from "vitest";
import { buildMetadata, buildOgImageUrl, getPage, pages, resolveSeo, siteConfig } from "../legacy";

describe("buildMetadata", () => {
  it("reproduit le title et la description actuels de l'accueil", () => {
    const m = buildMetadata("/");
    expect(m.title).toEqual({ absolute: "Navitrends UK | Operational Systems, Automation, Data & AI" });
    expect(m.description).toBe(siteConfig.description);
    expect(m.alternates?.canonical).toBe("https://navitrends.uk");
  });
  it("applique le template des pages internes", () => {
    expect(buildMetadata("/odoo").title).toEqual({ absolute: "Odoo Implementation & Customisation | Navitrends UK" });
  });
  it("fournit un fallback pour une page inconnue", () => {
    const m = buildMetadata("/nouvelle-page-test");
    expect(m.title).toEqual({ absolute: "Nouvelle Page Test | Navitrends UK" });
    expect(m.description).toBe(siteConfig.description);
  });
  it("génère l'image OG dynamique sauf pour l'accueil", () => {
    expect(buildOgImageUrl(getPage("/odoo")!)).toBe("https://navitrends.uk/api/og?path=%2Fodoo");
    expect(buildOgImageUrl(getPage("/")!)).toBe("https://navitrends.uk/images/software-dashboard.jpg");
  });
  it("accepte des surcharges (pages dynamiques)", () => {
    const m = buildMetadata("/insights/x", { type: "article", title: "Mon article", description: "Desc", datePublished: "2026-11-01" });
    expect(m.openGraph).toMatchObject({ type: "article", publishedTime: "2026-11-01" });
  });
  it("marque noindex quand demandé", () => {
    expect(buildMetadata("/x", { noindex: true }).robots).toEqual({ index: false, follow: false });
  });
  it("respecte les longueurs recommandées pour toutes les pages", () => {
    for (const p of pages) {
      const { title, description } = resolveSeo(p);
      expect(title.length, `${p.path} title`).toBeLessThanOrEqual(65);
      expect(title.length, `${p.path} title`).toBeGreaterThanOrEqual(30);
      expect(description.length, `${p.path} description`).toBeLessThanOrEqual(160);
    }
  });
});
