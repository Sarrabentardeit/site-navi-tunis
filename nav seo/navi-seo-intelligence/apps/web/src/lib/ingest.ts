/**
 * Réception des lots de apps/log-agent. Logique pure (testée sans Next ni base) ; la route HTTP ne fait que l'appeler.
 * Ordre volontaire : taille → signature (avant tout parsing JSON) → schéma → cohérence du site → dépôt.
 */
import { logBatchSchema, MAX_LOG_BATCH_BYTES } from "@navi/collectors";
import { verifySignature } from "@navi/security";

export interface IngestDeps {
  /** Secret de signature du site (null si le site est inconnu). */
  secretFor(siteId: string): Promise<string | null>;
  /** Dépose le lot ; renvoie false si le batch_id était déjà reçu (renvoi après timeout). */
  store(batch: { siteId: string; batchId: string; payload: unknown }): Promise<boolean>;
  now?: () => number;
}

export interface IngestResult {
  readonly status: 202 | 400 | 401 | 413;
  readonly body: { readonly ok: boolean; readonly duplicate?: boolean; readonly error?: string };
}

export async function handleLogIngest(deps: IngestDeps, req: { body: string; timestamp: string | null; signature: string | null; siteIdHeader: string | null }): Promise<IngestResult> {
  if (Buffer.byteLength(req.body, "utf8") > MAX_LOG_BATCH_BYTES) return { status: 413, body: { ok: false, error: "corps trop volumineux" } };
  // Le site visé est annoncé par un en-tête pour retrouver le secret ; il est re-vérifié contre le corps signé plus bas.
  const siteId = req.siteIdHeader ?? "";
  const secret = /^[0-9a-f-]{36}$/i.test(siteId) ? await deps.secretFor(siteId) : null;
  // Réponse identique pour « site inconnu » et « mauvaise signature » : pas d'oracle d'énumération des sites.
  if (!secret || !verifySignature(req.body, secret, req.timestamp, req.signature, deps.now?.())) return { status: 401, body: { ok: false, error: "signature invalide" } };
  let json: unknown;
  try {
    json = JSON.parse(req.body);
  } catch {
    return { status: 400, body: { ok: false, error: "JSON invalide" } };
  }
  const parsed = logBatchSchema.safeParse(json);
  if (!parsed.success) return { status: 400, body: { ok: false, error: "lot invalide" } };
  if (parsed.data.site_id !== siteId) return { status: 400, body: { ok: false, error: "site_id incohérent" } };
  const fresh = await deps.store({ siteId, batchId: parsed.data.batch_id, payload: parsed.data });
  return { status: 202, body: { ok: true, ...(fresh ? {} : { duplicate: true }) } };
}
