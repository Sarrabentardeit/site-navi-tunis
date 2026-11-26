import { describe, expect, it } from "vitest";
import { buildGraph, homeFaq, pages } from "../legacy";
import { serializeJsonLd } from "../../src/schema/serialize";
import { validateGraph } from "../../src/schema/validate";

describe("serializeJsonLd", () => {
  it("échappe < pour empêcher la fermeture de la balise script", () => {
    const out = serializeJsonLd({ "@type": "Thing", name: "</script><script>alert(1)</script>" });
    expect(out).not.toContain("</script>");
    expect(JSON.parse(out)).toEqual({ "@type": "Thing", name: "</script><script>alert(1)</script>" });
  });
});

describe("buildGraph", () => {
  it("contient Organization, WebSite, WebPage reliés par @id", () => {
    const g = buildGraph("/");
    const types = g["@graph"].map((n) => n["@type"]);
    expect(types).toContainEqual(["Organization", "ProfessionalService"]);
    expect(types).toContain("WebSite");
    expect(types).toContain("WebPage");
  });
  it("ajoute Service + BreadcrumbList sur une page de service", () => {
    const types = buildGraph("/odoo")["@graph"].map((n) => n["@type"]);
    expect(types).toContain("Service");
    expect(types).toContain("BreadcrumbList");
  });
  it("n'ajoute pas de fil d'Ariane sur l'accueil", () => {
    expect(buildGraph("/")["@graph"].some((n) => n["@type"] === "BreadcrumbList")).toBe(false);
  });
  it("ajoute FAQPage quand des questions sont fournies", () => {
    const faq = buildGraph("/", { faq: homeFaq })["@graph"].find((n) => n["@type"] === "FAQPage");
    expect(faq?.mainEntity).toHaveLength(5);
  });
  it("valide le graphe de chaque page du registre", () => {
    for (const p of pages) expect(validateGraph(buildGraph(p.path, p.path === "/" ? { faq: homeFaq } : {})), p.path).toEqual([]);
  });
  it("détecte une référence @id cassée", () => {
    const g = buildGraph("/");
    g["@graph"].push({ "@type": "Thing", "@id": "https://x/#t", isPartOf: { "@id": "https://x/#inconnu" } });
    expect(validateGraph(g).some((i) => i.includes("introuvable"))).toBe(true);
  });
  it("valide un Article dynamique", () => {
    const g = buildGraph("/insights/test", { overrides: { type: "article", title: "Test", description: "d", datePublished: "2026-11-01" } });
    expect(validateGraph(g)).toEqual([]);
  });
});
