/**
 * Accès base : toute requête applicative passe par `withOrg`, qui ouvre une transaction et fixe
 * `app.org_id` (local à la transaction). Oublier cet appel n'expose rien : sans organisation, la RLS ne renvoie aucune ligne.
 * Types structurels : compatibles avec `pg.Pool` sans l'importer ici (tests sans base).
 */
export interface QueryResult<R = Record<string, unknown>> {
  readonly rows: R[];
  readonly rowCount: number | null;
}
export interface PgClientLike {
  query<R = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<QueryResult<R>>;
  release(err?: Error | boolean): void;
}
export interface PgPoolLike {
  connect(): Promise<PgClientLike>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isUuid = (v: string): boolean => UUID.test(v);

export async function withOrg<T>(pool: PgPoolLike, orgId: string, fn: (db: PgClientLike) => Promise<T>): Promise<T> {
  if (!isUuid(orgId)) throw new TypeError("orgId doit être un UUID");
  const client = await pool.connect();
  let failed: Error | undefined;
  try {
    await client.query("begin");
    await client.query("select set_config('app.org_id', $1, true)", [orgId]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    failed = err instanceof Error ? err : new Error(String(err));
    try {
      await client.query("rollback");
    } catch {
      /* la connexion sera détruite par release(err) */
    }
    throw err;
  } finally {
    client.release(failed);
  }
}

/** Transaction sans organisation : réservée aux fonctions d'authentification (SECURITY DEFINER) et au planificateur du worker. */
export async function withoutOrg<T>(pool: PgPoolLike, fn: (db: PgClientLike) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let failed: Error | undefined;
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    failed = err instanceof Error ? err : new Error(String(err));
    try {
      await client.query("rollback");
    } catch {
      /* idem */
    }
    throw err;
  } finally {
    client.release(failed);
  }
}
