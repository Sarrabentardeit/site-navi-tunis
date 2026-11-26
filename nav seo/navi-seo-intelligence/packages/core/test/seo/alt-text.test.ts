import { describe, expect, it } from "vitest";
import { cleanFilename, generateAlt } from "../../src/alt-text";

describe("cleanFilename", () => {
  it("nettoie nom, extension et dimensions", () => {
    expect(cleanFilename("/images/software-dashboard.jpg")).toBe("Software dashboard");
    expect(cleanFilename("/images/team_photo-1200x800.webp")).toBe("Team photo");
  });
  it("supprime les hash", () => expect(cleanFilename("/images/hero-a1b2c3d4e5.png")).toBe("Hero"));
  it("sépare le camelCase", () => expect(cleanFilename("erpDashboardView.png")).toBe("Erp dashboard view"));
  it("décode les URLs next/image", () => {
    expect(cleanFilename("/_next/image?url=%2Fimages%2Ferp-flow.png&w=640&q=75")).toBe("Erp flow");
  });
  it("rejette les noms génériques", () => {
    expect(cleanFilename("/IMG_1234.jpg")).toBe("");
    expect(cleanFilename("/DSC0042.jpg")).toBe("");
    expect(cleanFilename("/123.png")).toBe("");
  });
});

describe("generateAlt", () => {
  it("combine nom de fichier et titre de page", () => {
    expect(generateAlt("/images/software-dashboard.jpg", { pageTitle: "Navitrends UK" })).toBe("Software dashboard — Navitrends UK");
  });
  it("utilise le fallback si le nom est inexploitable", () => {
    expect(generateAlt("/IMG_0001.jpg", { pageTitle: "Odoo", section: "Operational Systems" })).toBe("Odoo — Operational Systems");
  });
  it("retourne une chaîne vide sans aucune information", () => {
    expect(generateAlt("/IMG_0001.jpg")).toBe("");
  });
  it("respecte la longueur maximale", () => {
    const long = "mot ".repeat(60).trim();
    expect(generateAlt("/a.jpg", { pageTitle: long }).length).toBeLessThanOrEqual(125);
  });
});
