/**
 * Lint des migrations SQL (exécuté en CI, sans base) :
 *  R1  toute table portant org_id appelle navi_apply_tenant_rls(...) (ou active+force RLS et crée une politique) ;
 *  R2  toute table sans org_id est dans la liste blanche explicite ;
 *  R3  la table users reste fermée aux rôles applicatifs ;
 *  R4  aucun rôle BYPASSRLS ;
 *  R5  toute fonction SECURITY DEFINER fixe son search_path.
 * Il complète (ne remplace pas) les tests d'intégration RLS qui, eux, exigent un vrai PostgreSQL.
 */

export interface RlsLintResult {
  readonly errors: readonly string[];
  readonly tables: readonly string[];
  readonly tenantTables: readonly string[];
}

/** Tables sans org_id autorisées : `organizations` est isolée par `id` ; `users` est fermée (R3) ; le reste est technique. */
export const NO_ORG_ID_ALLOWLIST: ReadonlySet<string> = new Set(["organizations", "users", "schema_migrations"]);

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

function matchingParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

export function lintRls(files: Readonly<Record<string, string>>): RlsLintResult {
  const errors: string[] = [];
  const tables = new Map<string, { file: string; hasOrgId: boolean }>();
  const protectedTables = new Set<string>();
  let all = "";

  for (const [file, raw] of Object.entries(files)) {
    const sql = stripComments(raw);
    all += `\n${sql}`;
    const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)\s*\(/gi;
    for (let m = re.exec(sql); m; m = re.exec(sql)) {
      const name = (m[1] as string).toLowerCase();
      const open = m.index + m[0].length - 1;
      const close = matchingParen(sql, open);
      const body = close > 0 ? sql.slice(open + 1, close) : "";
      const hasOrgId = /(^|,)\s*org_id\s+uuid\b/im.test(body);
      tables.set(name, { file, hasOrgId });
    }
    const addCol = /alter\s+table\s+([a-z_][a-z0-9_]*)\s+add\s+column\s+org_id\b/gi;
    for (let m = addCol.exec(sql); m; m = addCol.exec(sql)) {
      const name = (m[1] as string).toLowerCase();
      const t = tables.get(name);
      if (t) tables.set(name, { ...t, hasOrgId: true });
    }
    const apply = /navi_apply_tenant_rls\(\s*'([a-z_][a-z0-9_]*)'/gi;
    for (let m = apply.exec(sql); m; m = apply.exec(sql)) protectedTables.add((m[1] as string).toLowerCase());
  }

  // Forme explicite : enable + force + create policy sur la même table.
  const lowerAll = all.toLowerCase();
  for (const name of tables.keys()) {
    const enable = new RegExp(`alter\\s+table\\s+${name}\\s+enable\\s+row\\s+level\\s+security`).test(lowerAll);
    const force = new RegExp(`alter\\s+table\\s+${name}\\s+force\\s+row\\s+level\\s+security`).test(lowerAll);
    const policy = new RegExp(`create\\s+policy\\s+\\w+\\s+on\\s+${name}\\b`).test(lowerAll);
    if (enable && force && policy) protectedTables.add(name);
  }

  const tenantTables: string[] = [];
  for (const [name, t] of tables) {
    if (t.hasOrgId) {
      tenantTables.push(name);
      if (!protectedTables.has(name)) errors.push(`R1 ${name} (${t.file}) : porte org_id mais n'a pas de politique RLS (appeler navi_apply_tenant_rls)`);
    } else if (!NO_ORG_ID_ALLOWLIST.has(name)) {
      errors.push(`R2 ${name} (${t.file}) : table sans org_id hors liste blanche (ajouter org_id, ou justifier dans NO_ORG_ID_ALLOWLIST)`);
    }
  }
  if (tables.has("organizations") && !protectedTables.has("organizations")) errors.push("R1 organizations : isolation par id manquante");
  if (tables.has("users") && !/revoke\s+all\s+on\s+users\s+from\s+navi_app\s*,\s*navi_worker/.test(lowerAll)) errors.push("R3 users : doit être fermée à navi_app et navi_worker (revoke all)");

  const roleRe = /(create|alter)\s+role\s+[a-z_][a-z0-9_]*[^;]*;/gi;
  for (let m = roleRe.exec(all); m; m = roleRe.exec(all)) {
    if (/(^|\s)bypassrls(\s|;|$)/i.test(m[0])) errors.push(`R4 rôle avec BYPASSRLS interdit : ${m[0].replace(/\s+/g, " ").trim()}`);
  }

  const fnRe = /create\s+(?:or\s+replace\s+)?function\s+([a-z_][a-z0-9_]*)\s*\([\s\S]*?\$\$/gi;
  for (let m = fnRe.exec(all); m; m = fnRe.exec(all)) {
    const header = m[0].toLowerCase();
    if (/security\s+definer/.test(header) && !/set\s+search_path/.test(header)) errors.push(`R5 fonction ${m[1]} : SECURITY DEFINER sans SET search_path`);
  }

  return { errors, tables: [...tables.keys()], tenantTables };
}
