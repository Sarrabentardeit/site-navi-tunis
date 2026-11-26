import { describe, expect, it } from "vitest";
import { buildRobots } from "../legacy";
import { getBlockedAiCrawlers } from "../../src/robots";

describe("buildRobots", () => {
  it("bloque tout hors production", () => {
    expect(buildRobots({ SEO_ENV: "staging" })).toEqual({ rules: [{ userAgent: "*", disallow: "/" }] });
    expect(buildRobots({})).toEqual({ rules: [{ userAgent: "*", disallow: "/" }] });
  });
  it("autorise la production et référence le sitemap", () => {
    const r = buildRobots({ SEO_ENV: "production" });
    expect(r.sitemap).toEqual(["https://navitrends.uk/sitemap.xml"]);
    expect(JSON.stringify(r.rules)).toContain("/admin/");
  });
  it("autorise les crawlers IA par défaut", () => {
    expect(getBlockedAiCrawlers({})).toEqual([]);
  });
  it("bloque une sélection ou tous les crawlers IA", () => {
    expect(getBlockedAiCrawlers({ SEO_AI_BLOCK: "gptbot, ClaudeBot" })).toEqual(["GPTBot", "ClaudeBot"]);
    expect(getBlockedAiCrawlers({ SEO_AI_BLOCK: "all" })).toHaveLength(4);
    const r = buildRobots({ SEO_ENV: "production", SEO_AI_BLOCK: "all" });
    expect(JSON.stringify(r.rules)).toContain("Google-Extended");
  });
});
