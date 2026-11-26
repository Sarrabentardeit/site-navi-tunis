#!/usr/bin/env tsx
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lintRls } from "../src/lint-rls";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const files = Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().map((f) => [f, readFileSync(path.join(dir, f), "utf8")]));
const r = lintRls(files);
console.log(`${r.tables.length} tables, dont ${r.tenantTables.length} avec org_id.`);
if (r.errors.length > 0) {
  console.error(r.errors.map((e) => `✗ ${e}`).join("\n"));
  process.exit(1);
}
console.log("✓ RLS : toutes les tables portant org_id sont protégées.");
