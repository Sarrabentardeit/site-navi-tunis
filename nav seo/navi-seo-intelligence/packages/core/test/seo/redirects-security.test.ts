import { describe, expect, it } from "vitest";
import { RedirectsValidationError, parseRedirects } from "../../src/redirects/load";
import { toApacheConf } from "../../src/redirects/apache";

const bad = (r: unknown): void => expect(() => parseRedirects([r])).toThrow(RedirectsValidationError);

describe("redirections : correctifs de sécurité (Phase 1)", () => {
  it("refuse l'antislash (redirection ouverte via /\\evil.com)", () => {
    bad({ source: "/a", destination: "/\\evil.com", type: 301 });
    bad({ source: "/a\\b", destination: "/b", type: 301 });
  });
  it("refuse les sauts de ligne et espaces (injection de directives Apache)", () => {
    bad({ source: "/a\nRewriteRule ^/x$ http://evil.test [R=301]", destination: "/b", type: 301 });
    bad({ source: "/a", destination: "/b\r\nHeader set X y", type: 301 });
    bad({ source: "/a b", destination: "/b", type: 301 });
    bad({ source: "/a", destination: "/b c", type: 302 });
  });
  it("refuse les destinations absolues avec identifiants ou sans hôte", () => {
    bad({ source: "/a", destination: "https://user:pass@evil.test/", type: 301 });
    bad({ source: "/a", destination: "https:///x", type: 301 });
    bad({ source: "/a", destination: "javascript:alert(1)", type: 301 });
  });
  it("accepte les cas légitimes", () => {
    expect(parseRedirects([{ source: "/old", destination: "/new", type: 301 }, { source: "/x", destination: "https://example.com/y?z=1", type: 302 }, { source: "/gone", type: 410 }])).toHaveLength(3);
  });
  it("la configuration Apache générée ne contient qu'une directive par règle", () => {
    const conf = toApacheConf(parseRedirects([{ source: "/old", destination: "/new", type: 301 }]));
    expect(conf.split("\n").filter((l) => l.startsWith("RewriteRule"))).toHaveLength(1);
  });
});
