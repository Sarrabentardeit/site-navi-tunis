#!/usr/bin/env tsx
import { promises as dnsp } from "node:dns";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadLogAgentEnv } from "@navi/config";
import { runCycle, type State } from "./agent";

async function main(): Promise<void> {
  const env = loadLogAgentEnv();
  const files = env.LOG_FILES.split(",").map((s) => s.trim()).filter(Boolean);
  const stateFile = path.join(env.STATE_DIR, "state.json");
  await mkdir(env.STATE_DIR, { recursive: true });
  let state: State = await readFile(stateFile, "utf8").then((t) => JSON.parse(t) as State).catch(() => ({}));
  const dns = { reverse: (ip: string) => dnsp.reverse(ip), forward: async (h: string) => [...(await dnsp.resolve4(h).catch(() => [])), ...(await dnsp.resolve6(h).catch(() => []))] };
  const fetcher = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
    return { ok: r.ok, status: r.status };
  };
  for (;;) {
    try {
      const r = await runCycle(files, state, { siteId: env.SITE_ID, secret: env.INGEST_SECRET, ingestUrl: env.INGEST_URL, dns, fetch: fetcher });
      state = r.state;
      const tmp = `${stateFile}.tmp`;
      await writeFile(tmp, JSON.stringify(state), "utf8");
      await rename(tmp, stateFile);
      if (r.sent > 0) console.log(`${new Date().toISOString()} envoyé ${r.sent} ligne(s) agrégée(s)`);
    } catch (e) {
      console.error(`${new Date().toISOString()} cycle en échec :`, e instanceof Error ? e.message : e);
    }
    await new Promise((r) => setTimeout(r, env.FLUSH_INTERVAL_SEC * 1000));
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
