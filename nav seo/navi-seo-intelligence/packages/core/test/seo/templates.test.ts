import { describe, expect, it } from "vitest";
import { renderTemplate, truncate } from "../../src/templates";

describe("renderTemplate", () => {
  it("remplace les variables", () => {
    expect(renderTemplate("%pagetitle% | %sitename%", { pagetitle: "Odoo", sitename: "Navitrends UK" })).toBe("Odoo | Navitrends UK");
  });
  it("est insensible à la casse des variables", () => {
    expect(renderTemplate("%SiteName%", { sitename: "X" })).toBe("X");
  });
  it("nettoie les séparateurs orphelins quand une variable est vide", () => {
    expect(renderTemplate("%pagetitle% | %section% | %sitename%", { pagetitle: "A", sitename: "B" })).toBe("A | B");
    expect(renderTemplate("%section% | %sitename%", { sitename: "B" })).toBe("B");
    expect(renderTemplate("%pagetitle% — %section%", { pagetitle: "A" })).toBe("A");
  });
  it("conserve les tirets dans les mots", () => {
    expect(renderTemplate("%pagetitle%", { pagetitle: "Zero-Paper ISO 9001" })).toBe("Zero-Paper ISO 9001");
  });
  it("ignore les variables inconnues", () => {
    expect(renderTemplate("A %inconnue% B", {})).toBe("A B");
  });
});

describe("truncate", () => {
  it("ne touche pas un texte court", () => expect(truncate("court", 10)).toBe("court"));
  it("coupe sur un mot et ajoute …", () => {
    const out = truncate("Un texte assez long pour dépasser la limite fixée", 25);
    expect(out.length).toBeLessThanOrEqual(25);
    expect(out.endsWith("…")).toBe(true);
  });
});
