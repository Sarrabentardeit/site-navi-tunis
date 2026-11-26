#!/usr/bin/env tsx
/** CLI : pnpm --filter @navi/audit audit -- --url=https://exemple.com --min-score=80 --max-pages=100 --out=reports/audit.md */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runAudit } from "../src";

const arg = (n: string): string | undefined => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
const url = arg("url") ?? process.env.SITE_URL;
if (!url) {
  console.error("--url=… (ou SITE_URL) obligatoire");
  process.exit(2);
}
const report = await runAudit({ baseUrl: url, maxPages: Number(arg("max-pages") ?? 150), minScore: Number(arg("min-score") ?? process.env.SEO_MIN_SCORE ?? 80), log: console.log });
const out = arg("out") ?? "reports/seo-audit.md";
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, report.markdown, "utf8");
if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, report.markdown, { flag: "a" });
console.log(`Score : ${report.score ?? "n/d"}/100 (seuil ${report.minScore}) — rapport : ${out}`);
process.exit(report.passed ? 0 : 1);
