import { describe, expect, it } from "vitest";
import { signBody } from "@navi/security";
import { budgetRows } from "../src/lib/budget-view";
import { handleLogIngest } from "../src/lib/ingest";
import { MODULES, moduleViews, visibleModules } from "../src/modules";

describe("modules", () => {
  it("un module non livré est « Bientôt », jamais « disponible »", () => {
    for (const m of moduleViews()) expect(m.state).toBe(m.shipped ? "available" : "coming_soon");
    expect(moduleViews().find((m) => m.id === "geo")?.state).toBe("coming_soon");
  });
  it("Phase 1 : seuls Dashboard, Technical SEO et Settings sont livrés", () => {
    expect(MODULES.filter((m) => m.shipped).map((m) => m.id)).toEqual(["dashboard", "seo-audit", "settings"]);
  });
  it("modules_enabled restreint les modules livrés mais garde Dashboard et Settings", () => {
    const ids = visibleModules(["seo-audit"]).filter((m) => m.state === "available").map((m) => m.id);
    expect(ids).toEqual(["dashboard", "seo-audit", "settings"]);
    expect(visibleModules(["geo"]).filter((m) => m.state === "available").map((m) => m.id)).toEqual(["dashboard", "settings"]);
  });
});

describe("budgetRows", () => {
  const line = { provider: "dataforseo", capUsd: 50, hardStop: true, enabled: true };
  it("niveaux ok / warning / exceeded / disabled", () => {
    expect(budgetRows([{ ...line, spentUsd: 10 }])[0]?.level).toBe("ok");
    expect(budgetRows([{ ...line, spentUsd: 40 }])[0]?.level).toBe("warning");
    expect(budgetRows([{ ...line, spentUsd: 50 }])[0]?.level).toBe("exceeded");
    expect(budgetRows([{ ...line, spentUsd: 0, enabled: false }])[0]?.level).toBe("disabled");
  });
  it("plafond nul : pas de division par zéro", () => {
    expect(budgetRows([{ ...line, capUsd: 0, spentUsd: 0 }])[0]).toMatchObject({ ratio: null, level: "ok" });
    expect(budgetRows([{ ...line, capUsd: 0, spentUsd: 1 }])[0]?.level).toBe("exceeded");
  });
});

describe("handleLogIngest", () => {
  const SITE = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
  const SECRET = "s".repeat(40);
  const NOW = 1_700_000_000_000;
  const payload = { batch_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3310", site_id: SITE, rows: [{ date: "2026-11-15", bot: "GPTBot", bot_class: "training", verification: "claimed_unverified", path: "/x", status: 200, hits: 1 }] };
  const make = (stored: boolean[] = []) => ({ secretFor: async (id: string) => (id === SITE ? SECRET : null), store: async () => (stored.push(true), true), now: () => NOW });
  const req = (body: string, secret = SECRET, site: string | null = SITE) => {
    const { timestamp, signature } = signBody(body, secret, NOW);
    return { body, timestamp, signature, siteIdHeader: site };
  };

  it("accepte un lot signé et le dépose", async () => {
    const stored: boolean[] = [];
    expect(await handleLogIngest(make(stored), req(JSON.stringify(payload)))).toEqual({ status: 202, body: { ok: true } });
    expect(stored).toHaveLength(1);
  });
  it("signale un doublon (renvoi) sans erreur", async () => {
    const deps = { ...make(), store: async () => false };
    expect((await handleLogIngest(deps, req(JSON.stringify(payload)))).body).toEqual({ ok: true, duplicate: true });
  });
  it("401 identique pour mauvaise signature et site inconnu (pas d'oracle)", async () => {
    const bad = await handleLogIngest(make(), req(JSON.stringify(payload), "x".repeat(40)));
    const unknown = await handleLogIngest(make(), req(JSON.stringify(payload), SECRET, "3f2504e0-4f89-41d3-9a0c-0305e82c3399"));
    const noHeader = await handleLogIngest(make(), req(JSON.stringify(payload), SECRET, null));
    expect([bad, unknown, noHeader].map((r) => [r.status, r.body.error])).toEqual([[401, "signature invalide"], [401, "signature invalide"], [401, "signature invalide"]]);
  });
  it("ne dépose rien si le corps est invalide, trop gros, ou vise un autre site que l'en-tête signé", async () => {
    const stored: boolean[] = [];
    expect((await handleLogIngest(make(stored), req("pas du json"))).status).toBe(400);
    expect((await handleLogIngest(make(stored), req(JSON.stringify({ ...payload, rows: [] })))).status).toBe(400);
    expect((await handleLogIngest(make(stored), req(JSON.stringify({ ...payload, site_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3399" })))).status).toBe(400);
    expect((await handleLogIngest(make(stored), req("x".repeat(3 * 1024 * 1024)))).status).toBe(413);
    expect(stored).toHaveLength(0);
  });
  it("rejette un horodatage rejoué (fenêtre de 5 minutes)", async () => {
    const body = JSON.stringify(payload);
    const { timestamp, signature } = signBody(body, SECRET, NOW - 10 * 60_000);
    expect((await handleLogIngest(make(), { body, timestamp, signature, siteIdHeader: SITE })).status).toBe(401);
  });
});

import { normalizeDomain } from "../src/lib/domain";
describe("normalizeDomain", () => {
  it("normalise les saisies courantes", () => {
    expect(normalizeDomain("https://Navitrends.UK/")).toBe("navitrends.uk");
    expect(normalizeDomain(" exemple.co.uk ")).toBe("exemple.co.uk");
    expect(normalizeDomain("xn--caf-dma.example")).toBe("xn--caf-dma.example");
  });
  it("refuse IP, localhost, ports, chemins, identifiants, espaces, tirets en bordure", () => {
    for (const bad of ["127.0.0.1", "localhost", "exemple.com:8080", "exemple.com/chemin", "user@exemple.com", "exe mple.com", "-a.com", "a-.com", "café.com", "", "a..com"]) expect(normalizeDomain(bad), bad).toBeUndefined();
  });
});
