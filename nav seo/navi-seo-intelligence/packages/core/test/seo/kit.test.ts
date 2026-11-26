import { describe, expect, it } from "vitest";
import { createSeoKit } from "../../src/kit";
import { navitrendsPages, navitrendsSite } from "../fixtures/navitrends";
import type { PageEntry, SiteConfig } from "../../src/types";

const otherSite: SiteConfig = { ...navitrendsSite, name: "Autre Client", url: "https://autre.example", tagline: "Autre slogan", description: "Description du second site pour prouver l'isolation de configuration." };
const otherPages: readonly PageEntry[] = [
  { path: "/", type: "home", title: "Autre Client", description: otherSite.description },
  { path: "/offre", type: "service", title: "Notre offre", description: "Une offre." },
];

describe("createSeoKit (multi-sites)", () => {
  const a = createSeoKit({ site: navitrendsSite, pages: navitrendsPages });
  const b = createSeoKit({ site: otherSite, pages: otherPages });

  it("deux kits cohabitent sans partager d'état", () => {
    expect(a.buildMetadata("/").alternates.canonical).toBe("https://navitrends.uk");
    expect(b.buildMetadata("/").alternates.canonical).toBe("https://autre.example");
    expect(b.buildMetadata("/offre").title.absolute).toBe("Notre offre | Autre Client");
    expect(a.getPage("/offre")).toBeUndefined();
  });
  it("le graphe JSON-LD utilise l'origine du site du kit", () => {
    const ids = b.buildGraph("/offre")["@graph"].map((n) => String(n["@id"]));
    expect(ids.every((id) => id.startsWith("https://autre.example"))).toBe(true);
  });
  it("llms.txt et robots reflètent le site du kit", () => {
    expect(b.buildLlmsTxt()).toContain("# Autre Client");
    expect(b.buildRobots({ SEO_ENV: "production" }).sitemap).toEqual(["https://autre.example/sitemap.xml"]);
  });
  it("refuse une configuration invalide", () => {
    expect(() => createSeoKit({ site: { ...otherSite, url: "https://autre.example/" }, pages: otherPages })).toThrow();
    expect(() => createSeoKit({ site: otherSite, pages: [...otherPages, otherPages[1]!] })).toThrow();
    expect(() => createSeoKit({ site: otherSite, pages: [{ path: "/x/", type: "page", title: "x", description: "y" }] })).toThrow();
  });
});
