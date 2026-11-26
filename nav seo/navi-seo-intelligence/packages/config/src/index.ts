/**
 * Validation des variables d'environnement (zod). Chaque processus appelle UNE fonction au démarrage
 * et échoue immédiatement, avec la liste des variables en défaut, si la configuration est incomplète.
 * Aucun secret n'a de valeur par défaut.
 */
import { z } from "zod";

const secret = (min: number): z.ZodString => z.string().min(min, `au moins ${min} caractères`);
const url = z.string().url();
const pgUrl = z.string().regex(/^postgres(ql)?:\/\//, "URL PostgreSQL attendue (postgres://…)");

const common = {
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SEO_ENV: z.enum(["production", "staging", "development"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
};

/** Plafonds budgétaires : le plafond global est exprimé en EUR (décision produit), le registre est tenu en USD (schéma §5.2). */
const budget = {
  GLOBAL_MONTHLY_CAP_EUR: z.coerce.number().positive().max(100_000),
  /** Taux EUR→USD à renseigner explicitement et à réviser (aucune valeur par défaut : pas de chiffre inventé). */
  EUR_USD_RATE: z.coerce.number().min(0.5).max(2),
};

export const webEnvSchema = z.object({
  ...common,
  DATABASE_URL: pgUrl,
  APP_BASE_URL: url,
  SESSION_SECRET: secret(32),
  /** Sel du hachage d'IP du journal d'audit. */
  IP_HASH_SECRET: secret(32),
  /** Trousseau AES-256-GCM : "1:<base64 32 octets>,2:…" */
  CREDENTIALS_KEYRING: z.string().min(1),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(12),
  /** Ingestion des logs (apps/log-agent) : secret partagé par site, en JSON {"<site_id>":"<secret>"} — voir docs. */
  LOG_INGEST_SECRETS: z.string().default("{}"),
  ...budget,
});

export const workerEnvSchema = z.object({
  ...common,
  DATABASE_URL_WORKER: pgUrl,
  CREDENTIALS_KEYRING: z.string().min(1),
  /** Concurrence maximale d'un fournisseur ; DataForSEO reste à 1 tant que le budget n'est pas calibré. */
  DATAFORSEO_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(1),
  RAW_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(90),
  N8N_WEBHOOK_URL: url.optional(),
  N8N_WEBHOOK_SECRET: secret(16).optional(),
  ...budget,
});

export const migratorEnvSchema = z.object({
  DATABASE_URL_MIGRATOR: pgUrl,
  /** Mots de passe des rôles applicatifs créés par la migration 0001. */
  NAVI_APP_PASSWORD: secret(16),
  NAVI_WORKER_PASSWORD: secret(16),
});

export const logAgentEnvSchema = z.object({
  INGEST_URL: url,
  SITE_ID: z.string().uuid(),
  INGEST_SECRET: secret(32),
  /** Fichier(s) access.log à lire (séparés par des virgules). */
  LOG_FILES: z.string().min(1),
  /** Dossier d'état (offsets de lecture) — doit être inscriptible par l'agent. */
  STATE_DIR: z.string().min(1),
  /** Domaines de site pour lesquels les chemins sont rapportés (info seulement). */
  FLUSH_INTERVAL_SEC: z.coerce.number().int().min(5).max(3600).default(60),
});

export type WebEnv = z.infer<typeof webEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;
export type MigratorEnv = z.infer<typeof migratorEnvSchema>;
export type LogAgentEnv = z.infer<typeof logAgentEnvSchema>;

export class EnvError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Configuration invalide :\n- ${issues.join("\n- ")}`);
    this.name = "EnvError";
  }
}

type Source = Readonly<Record<string, string | undefined>>;

function parse<S extends z.ZodTypeAny>(schema: S, env: Source): z.infer<S> {
  const r = schema.safeParse(env);
  if (!r.success) throw new EnvError(r.error.issues.map((i) => `${i.path.join(".") || "(racine)"} : ${i.message}`));
  return r.data;
}

export const loadWebEnv = (env: Source = process.env): WebEnv => parse(webEnvSchema, env);
export const loadWorkerEnv = (env: Source = process.env): WorkerEnv => parse(workerEnvSchema, env);
export const loadMigratorEnv = (env: Source = process.env): MigratorEnv => parse(migratorEnvSchema, env);
export const loadLogAgentEnv = (env: Source = process.env): LogAgentEnv => parse(logAgentEnvSchema, env);

/** Plafond global converti en USD, arrondi au cent supérieur de sécurité (jamais au-dessus du plafond réel). */
export const globalCapUsd = (env: { GLOBAL_MONTHLY_CAP_EUR: number; EUR_USD_RATE: number }): number =>
  Math.floor(env.GLOBAL_MONTHLY_CAP_EUR * env.EUR_USD_RATE * 100) / 100;
