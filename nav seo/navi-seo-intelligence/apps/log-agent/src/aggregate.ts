import type { BotClass, Verification } from "./bots";

export interface BotHitRow {
  readonly date: string;
  readonly bot: string;
  readonly bot_class: BotClass;
  readonly verification: Verification;
  readonly path: string;
  readonly status: number;
  readonly hits: number;
}

export interface Observation {
  readonly timestamp: Date;
  readonly bot: string;
  readonly botClass: BotClass;
  readonly verification: Verification;
  readonly path: string;
  readonly status: number;
}

/** Agrégation journalière (UTC). Ne contient ni IP ni user-agent complet : c'est ce qui quitte le serveur. */
export function aggregate(observations: readonly Observation[]): BotHitRow[] {
  const map = new Map<string, BotHitRow>();
  for (const o of observations) {
    const date = o.timestamp.toISOString().slice(0, 10);
    const key = [date, o.bot, o.verification, o.path, o.status].join("\u0000");
    const cur = map.get(key);
    map.set(key, cur ? { ...cur, hits: cur.hits + 1 } : { date, bot: o.bot, bot_class: o.botClass, verification: o.verification, path: o.path, status: o.status, hits: 1 });
  }
  return [...map.values()];
}
