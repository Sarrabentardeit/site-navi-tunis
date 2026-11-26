import pg from "pg";
import type { PgPoolLike } from "@navi/db";
import { getEnv } from "./env";

const g = globalThis as unknown as { __naviPool?: pg.Pool };

/** Pool unique (rôle navi_app). Réutilisé entre rechargements en développement. */
export function getPool(): PgPoolLike {
  g.__naviPool ??= new pg.Pool({ connectionString: getEnv().env.DATABASE_URL, max: 10, idleTimeoutMillis: 30_000 });
  return g.__naviPool as unknown as PgPoolLike;
}
