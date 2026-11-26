import { describe, expect, it } from "vitest";
import { RedirectsValidationError, parseRedirects, toGoneRewrites, toNextRedirects } from "../../src/redirects/load";
import { toApacheConf } from "../../src/redirects/apache";
import { withNaviSeo } from "../../src/next/plugin";

describe("parseRedirects", () => {
  it("accepte un tableau ou { redirects }", () => {
    expect(parseRedirects([])).toEqual([]);
    expect(parseRedirects({ redirects: [{ source: "/a", destination: "/b", type: 301 }] })).toHaveLength(1);
    expect(parseRedirects({})).toEqual([]);
  });
  it("refuse source invalide, type inconnu, doublons, auto-redirection", () => {
    expect(() => parseRedirects([{ source: "a", destination: "/b", type: 301 }])).toThrow(RedirectsValidationError);
    expect(() => parseRedirects([{ source: "/a", destination: "/b", type: 308 }])).toThrow();
    expect(() => parseRedirects([{ source: "/a", destination: "/b", type: 301 }, { source: "/a", destination: "/c", type: 301 }])).toThrow();
    expect(() => parseRedirects([{ source: "/a", destination: "/a", type: 301 }])).toThrow();
  });
  it("refuse les boucles", () => {
    expect(() => parseRedirects([{ source: "/a", destination: "/b", type: 301 }, { source: "/b", destination: "/a", type: 302 }])).toThrow(/boucle/);
  });
  it("n'exige pas de destination pour un 410", () => {
    expect(parseRedirects([{ source: "/old", type: 410 }])[0]?.destination).toBeUndefined();
  });
  it("refuse les destinations protocol-relative (open redirect)", () => {
    expect(() => parseRedirects([{ source: "/a", destination: "//evil.com", type: 301 }])).toThrow();
  });
});

describe("conversion Next.js / Apache", () => {
  const rules = parseRedirects([
    { source: "/a", destination: "/b", type: 301 },
    { source: "/c", destination: "https://x.com", type: 307 },
    { source: "/gone", type: 410 },
    { source: "/blog/:slug", destination: "/insights/:slug", type: 301 },
  ]);
  it("produit les redirects() Next", () => {
    expect(toNextRedirects(rules)).toEqual([
      { source: "/a", destination: "/b", statusCode: 301 },
      { source: "/c", destination: "https://x.com", statusCode: 307 },
      { source: "/blog/:slug", destination: "/insights/:slug", statusCode: 301 },
    ]);
  });
  it("produit les rewrites 410", () => {
    expect(toGoneRewrites(rules)).toEqual([{ source: "/gone", destination: "/api/seo/gone" }]);
  });
  it("exporte des RewriteRule Apache en ignorant les motifs dynamiques", () => {
    const out = toApacheConf(rules);
    expect(out).toContain("RewriteRule ^/a$ /b [R=301,L,NE]");
    expect(out).toContain("RewriteRule ^/gone$ - [G,L]");
    expect(out).toContain("# ignoré (motif dynamique, géré par Next.js) : /blog/:slug");
    expect(toApacheConf(parseRedirects([{ source: "/a.html", destination: "/b", type: 302 }]))).toContain("^/a\\.html$");
  });
});

describe("withNaviSeo", () => {
  it("fusionne avec les redirects/rewrites existants", async () => {
    const cfg = withNaviSeo({ redirects: async () => [{ source: "/x", destination: "/y", permanent: true }], rewrites: async () => [{ source: "/r", destination: "/s" }] }, { redirectsFile: "/inexistant.json" });
    expect(await cfg.redirects?.()).toEqual([{ source: "/x", destination: "/y", permanent: true }]);
    expect(await cfg.rewrites?.()).toEqual({ beforeFiles: [], afterFiles: [{ source: "/r", destination: "/s" }], fallback: [] });
  });
});
