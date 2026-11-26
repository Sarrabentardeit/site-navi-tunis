import { appendFile, mkdtemp, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { verifySignature } from "@navi/security";
import { aggregate } from "../src/aggregate";
import { runCycle, type State } from "../src/agent";
import { classifyUserAgent, verifyBot, type DnsResolver } from "../src/bots";
import { parseLine } from "../src/parse";
import { readNewLines } from "../src/reader";

const line = (ip: string, ua: string, p = "/odoo", status = 200, time = "15/Nov/2026:10:00:00 +0000"): string =>
  `${ip} - - [${time}] "GET ${p} HTTP/1.1" ${status} 512 "-" "${ua}"`;

describe("parseLine", () => {
  it("lit une ligne combined, retire la query, convertit le fuseau", () => {
    const e = parseLine(line("66.249.66.1", "Googlebot/2.1", "/a/b?x=1#f", 404, "15/Nov/2026:12:30:00 +0200"))!;
    expect(e).toMatchObject({ ip: "66.249.66.1", method: "GET", path: "/a/b", status: 404, userAgent: "Googlebot/2.1" });
    expect(e.timestamp.toISOString()).toBe("2026-11-15T10:30:00.000Z");
  });
  it("rejette les lignes invalides ou aux chemins suspects", () => {
    expect(parseLine("n'importe quoi")).toBeUndefined();
    expect(parseLine(line("1.1.1.1", "x", "/a\u0001b"))).toBeUndefined();
    expect(parseLine('1.1.1.1 - - [32/Foo/2026:10:00:00 +0000] "GET / HTTP/1.1" 200 1 "-" "x"')).toBeUndefined();
  });
});

describe("classifyUserAgent", () => {
  it("distingue entraînement, recherche et visite déclenchée par un utilisateur", () => {
    expect(classifyUserAgent("Mozilla/5.0 (compatible; GPTBot/1.1)")).toMatchObject({ name: "GPTBot", class: "training" });
    expect(classifyUserAgent("... OAI-SearchBot/1.0")).toMatchObject({ class: "search" });
    expect(classifyUserAgent("... ChatGPT-User/1.0")).toMatchObject({ class: "user_triggered" });
    expect(classifyUserAgent("Claude-SearchBot")).toMatchObject({ name: "Claude-SearchBot", class: "search" });
    expect(classifyUserAgent("ClaudeBot/1.0")).toMatchObject({ name: "ClaudeBot", class: "training" });
    expect(classifyUserAgent("Mozilla/5.0 Chrome/120")).toBeUndefined();
  });
});

describe("verifyBot", () => {
  const google = classifyUserAgent("Googlebot")!;
  const dns = (rev: string[], fwd: string[]): DnsResolver => ({ reverse: async () => rev, forward: async () => fwd });
  it("vérifié : suffixe attendu ET résolution directe vers la même IP", async () => {
    expect(await verifyBot(google, "66.249.66.1", dns(["crawl-66-249-66-1.googlebot.com."], ["66.249.66.1"]))).toBe("verified");
  });
  it("échec : usurpation (mauvais suffixe ou IP différente)", async () => {
    expect(await verifyBot(google, "6.6.6.6", dns(["evil.example.com"], ["6.6.6.6"]))).toBe("failed");
    expect(await verifyBot(google, "6.6.6.6", dns(["x.googlebot.com"], ["1.2.3.4"]))).toBe("failed");
  });
  it("jamais « verified » sans moyen de preuve, ni sur panne DNS", async () => {
    expect(await verifyBot(classifyUserAgent("GPTBot")!, "1.1.1.1", dns([], []))).toBe("claimed_unverified");
    expect(await verifyBot(google, "1.1.1.1", { reverse: async () => { throw new Error("SERVFAIL"); }, forward: async () => [] })).toBe("claimed_unverified");
  });
});

describe("aggregate", () => {
  it("regroupe par jour UTC et ne contient ni IP ni user-agent", () => {
    const o = (iso: string) => ({ timestamp: new Date(iso), bot: "GPTBot", botClass: "training" as const, verification: "claimed_unverified" as const, path: "/x", status: 200 });
    const rows = aggregate([o("2026-11-15T23:59:00Z"), o("2026-11-15T01:00:00Z"), o("2026-11-16T00:00:01Z")]);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.date === "2026-11-15")?.hits).toBe(2);
    expect(JSON.stringify(rows)).not.toMatch(/ip|userAgent|user_agent/);
  });
});

describe("readNewLines", () => {
  it("lit l'incrément, garde la ligne incomplète, détecte la rotation", async () => {
    const d = await mkdtemp(path.join(tmpdir(), "agent-"));
    const f = path.join(d, "access.log");
    await writeFile(f, "a\nb\npartielle");
    const r1 = await readNewLines(f, undefined);
    expect(r1.lines).toEqual(["a", "b"]);
    await appendFile(f, " fin\nc\n");
    const r2 = await readNewLines(f, r1.next);
    expect(r2.lines).toEqual(["partielle fin", "c"]);
    expect((await readNewLines(f, r2.next)).lines).toEqual([]);
    await rename(f, `${f}.1`);
    await writeFile(f, "nouveau\n");
    expect((await readNewLines(f, r2.next)).lines).toEqual(["nouveau"]);
  });
});

describe("runCycle", () => {
  const dns: DnsResolver = { reverse: async () => ["c.googlebot.com"], forward: async () => ["66.249.66.1"] };
  it("envoie un lot signé, n'inclut que les robots, n'avance les offsets qu'en cas de succès", async () => {
    const d = await mkdtemp(path.join(tmpdir(), "agent-"));
    const f = path.join(d, "access.log");
    await writeFile(f, [line("66.249.66.1", "Googlebot/2.1"), line("1.2.3.4", "Mozilla/5.0 Chrome"), line("5.6.7.8", "GPTBot/1.1", "/llms.txt")].join("\n") + "\n");
    const sent: { headers: Record<string, string>; body: string }[] = [];
    const secret = "k".repeat(40);
    const deps = { siteId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", secret, ingestUrl: "https://x/api", dns, fetch: async (_u: string, init: { headers: Record<string, string>; body: string }) => (sent.push(init), { ok: true, status: 202 }) };
    const r = await runCycle([f], {}, deps);
    expect(r.sent).toBe(2);
    expect(r.skipped).toBe(1);
    const batch = JSON.parse(sent[0]!.body);
    expect(batch.rows.map((x: { bot: string }) => x.bot).sort()).toEqual(["GPTBot", "Googlebot"]);
    expect(batch.rows.find((x: { bot: string }) => x.bot === "Googlebot").verification).toBe("verified");
    expect(sent[0]!.body).not.toContain("66.249.66.1");
    expect(verifySignature(sent[0]!.body, secret, sent[0]!.headers["x-navi-timestamp"], sent[0]!.headers["x-navi-signature"])).toBe(true);

    // Échec d'ingestion : exception, et l'appelant garde l'ancien état (les lignes seront relues).
    const failing = { ...deps, fetch: async () => ({ ok: false, status: 503 }) };
    await expect(runCycle([f], {} as State, failing)).rejects.toThrow("503");
    // Succès : le cycle suivant ne renvoie rien (offset avancé).
    expect((await runCycle([f], r.state, deps)).sent).toBe(0);
  });
});
