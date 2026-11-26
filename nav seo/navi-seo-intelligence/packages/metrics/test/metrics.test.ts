import { describe, expect, it } from "vitest";
import { auditScore, averageMentionRank, citationRate, ctr, positionChange, promptStability, rate, sentimentBreakdown, shareOfVoice, visibilityRate, weightedAveragePosition, wilsonInterval, type AiObservation } from "../src";

const obs = (promptId: string, status: AiObservation["status"], mentions: string[] = [], own = false): AiObservation => ({
  promptId,
  status,
  mentions: mentions.map((entityId, i) => ({ entityId, rank: i + 1 })),
  citations: own ? [{ domain: "navitrends.uk", isOwn: true }] : [{ domain: "autre.test", isOwn: false }],
});

describe("wilsonInterval / rate", () => {
  it("n = 0 ⇒ aucune valeur (pas de zéro inventé)", () => {
    expect(rate(0, 0)).toEqual({ rate: null, successes: 0, n: 0, ci95: null });
  });
  it("valeurs de référence", () => {
    const [lo, hi] = wilsonInterval(5, 10)!;
    expect(lo).toBeCloseTo(0.2366, 3);
    expect(hi).toBeCloseTo(0.7634, 3);
    const [l0, h0] = wilsonInterval(0, 3)!;
    expect(l0).toBe(0);
    expect(h0).toBeCloseTo(0.5615, 3);
  });
  it("rejette des effectifs incohérents", () => {
    expect(() => wilsonInterval(4, 3)).toThrow();
  });
});

describe("SEO", () => {
  it("ctr et position pondérée", () => {
    expect(ctr(5, 100)).toBe(0.05);
    expect(ctr(0, 0)).toBeNull();
    expect(weightedAveragePosition([{ position: 2, impressions: 100 }, { position: 10, impressions: 300 }])).toBe(8);
    expect(weightedAveragePosition([{ position: 3, impressions: 0 }])).toBeNull();
  });
  it("variation de position", () => {
    expect(positionChange(8, 5)).toBe(3);
    expect(positionChange(null, 5)).toBeNull();
  });
});

describe("GEO", () => {
  const data = [obs("p1", "ok", ["brand"], true), obs("p1", "ok", ["rival", "brand"]), obs("p1", "refused"), obs("p2", "ok", ["rival"]), obs("p2", "error"), obs("p2", "ok", [])];
  it("visibilité : refus et erreurs sortent du dénominateur", () => {
    const v = visibilityRate(data, "brand");
    expect(v.n).toBe(4);
    expect(v.successes).toBe(2);
    expect(v.rate).toBe(0.5);
  });
  it("part de voix", () => {
    const sov = shareOfVoice(data, ["brand", "rival"]);
    expect(sov.get("brand")?.rate).toBeCloseTo(0.5, 5);
    expect(sov.get("rival")?.successes).toBe(2);
    expect(shareOfVoice([obs("p", "ok", [])], ["brand"]).get("brand")?.rate).toBeNull();
  });
  it("taux de citation du site", () => {
    expect(citationRate(data).successes).toBe(1);
    expect(citationRate(data).n).toBe(4);
  });
  it("rang moyen : les rangs non mesurables sont comptés à part", () => {
    const withNull: AiObservation[] = [{ ...obs("p", "ok"), mentions: [{ entityId: "brand", rank: null }, { entityId: "brand", rank: 2 }] }];
    expect(averageMentionRank(withNull, "brand")).toEqual({ average: 2, measured: 1, unmeasured: 1 });
    expect(averageMentionRank(data, "brand").average).toBe(1.5);
  });
  it("sentiments", () => {
    const o: AiObservation[] = [{ ...obs("p", "ok"), mentions: [{ entityId: "b", sentiment: "positive" }, { entityId: "b" }] }];
    expect(sentimentBreakdown(o, "b")).toEqual({ positive: 1, neutral: 0, negative: 0, unknown: 1 });
  });
  it("stabilité par prompt", () => {
    // p1 : mentionné à chaque répétition exploitable ; p2 : jamais ⇒ les deux sont stables.
    expect(promptStability(data, "brand")).toEqual({ stable: 2, unstable: 0, insufficient: 0, prompts: 2 });
    // p3 : mentionné une fois sur deux ⇒ instable.
    expect(promptStability([...data, obs("p3", "ok", ["brand"]), obs("p3", "ok", [])], "brand")).toEqual({ stable: 2, unstable: 1, insufficient: 0, prompts: 3 });
    expect(promptStability([obs("solo", "ok", ["brand"])], "brand").insufficient).toBe(1);
  });
});

describe("auditScore (formule historique)", () => {
  it("100 si tout passe, null sans contrôle", () => {
    expect(auditScore([{ rule: "a", severity: "error", ok: true }])).toBe(100);
    expect(auditScore([])).toBeNull();
  });
  it("pondère par gravité et par taux de réussite de la règle", () => {
    // error: 1/2 → 3*0.5 = 1.5 ; warning: 1/1 → 2 ; total = 5 ; (3.5/5)=70
    expect(auditScore([
      { rule: "e", severity: "error", ok: true }, { rule: "e", severity: "error", ok: false },
      { rule: "w", severity: "warning", ok: true },
    ])).toBe(70);
  });
});
