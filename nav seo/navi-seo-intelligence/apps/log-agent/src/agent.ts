/** Un cycle de l'agent : lire → classer → vérifier → agréger → envoyer. Les offsets ne avancent qu'après un envoi réussi. */
import { randomUUID } from "node:crypto";
import { signBody } from "@navi/security";
import { aggregate, type BotHitRow, type Observation } from "./aggregate";
import { classifyUserAgent, verifyBot, type DnsResolver, type Verification } from "./bots";
import { parseLine } from "./parse";
import { readNewLines, type FileState } from "./reader";

export interface AgentDeps {
  readonly siteId: string;
  readonly secret: string;
  readonly ingestUrl: string;
  readonly dns: DnsResolver;
  readonly fetch: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number }>;
  readonly now?: () => number;
}

export type State = Record<string, FileState>;

export interface BatchPayload {
  readonly batch_id: string;
  readonly site_id: string;
  readonly rows: readonly BotHitRow[];
}

/** Cache par IP : une IP de robot revient des milliers de fois, un seul couple de requêtes DNS suffit. */
function cachedVerifier(dns: DnsResolver): (botName: string, ip: string, bot: NonNullable<ReturnType<typeof classifyUserAgent>>) => Promise<Verification> {
  const cache = new Map<string, Verification>();
  return async (botName, ip, bot) => {
    const key = `${botName}|${ip}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const v = await verifyBot(bot, ip, dns);
    cache.set(key, v);
    return v;
  };
}

export async function runCycle(files: readonly string[], state: State, deps: AgentDeps): Promise<{ state: State; sent: number; skipped: number }> {
  const verify = cachedVerifier(deps.dns);
  const observations: Observation[] = [];
  const nextState: State = { ...state };
  let skipped = 0;
  for (const file of files) {
    const { lines, next } = await readNewLines(file, state[file]);
    nextState[file] = next;
    for (const line of lines) {
      const e = parseLine(line);
      const bot = e ? classifyUserAgent(e.userAgent) : undefined;
      if (!e || !bot) {
        skipped += 1;
        continue;
      }
      observations.push({ timestamp: e.timestamp, bot: bot.name, botClass: bot.class, verification: await verify(bot.name, e.ip, bot), path: e.path, status: e.status });
    }
  }
  const rows = aggregate(observations);
  if (rows.length === 0) return { state: nextState, sent: 0, skipped };

  const payload: BatchPayload = { batch_id: randomUUID(), site_id: deps.siteId, rows };
  const body = JSON.stringify(payload);
  const { timestamp, signature } = signBody(body, deps.secret, deps.now?.());
  const res = await deps.fetch(deps.ingestUrl, { method: "POST", headers: { "content-type": "application/json", "x-navi-site": deps.siteId, "x-navi-timestamp": timestamp, "x-navi-signature": signature }, body });
  // Échec : on renvoie l'ancien état, les mêmes lignes seront relues au prochain cycle.
  if (!res.ok) throw new Error(`ingestion refusée (HTTP ${res.status})`);
  return { state: nextState, sent: rows.length, skipped };
}
