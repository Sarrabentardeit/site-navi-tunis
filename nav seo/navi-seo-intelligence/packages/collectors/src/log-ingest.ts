/** Contrat du lot envoyé par apps/log-agent, partagé par le serveur web (réception) et le worker (agrégation). Entrée non fiable : toujours validée. */
import { z } from "zod";

export const botHitRowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  bot: z.string().min(1).max(60),
  bot_class: z.enum(["search", "training", "user_triggered", "other", "unknown"]),
  verification: z.enum(["verified", "claimed_unverified", "failed"]),
  path: z.string().startsWith("/").max(300),
  status: z.number().int().min(100).max(599),
  hits: z.number().int().min(1).max(10_000_000),
});

export const logBatchSchema = z.object({
  batch_id: z.string().uuid(),
  site_id: z.string().uuid(),
  rows: z.array(botHitRowSchema).min(1).max(5000),
});

export type BotHitRowInput = z.infer<typeof botHitRowSchema>;
export type LogBatch = z.infer<typeof logBatchSchema>;

/** Taille maximale acceptée du corps (octets), avant tout parsing. */
export const MAX_LOG_BATCH_BYTES = 2 * 1024 * 1024;
