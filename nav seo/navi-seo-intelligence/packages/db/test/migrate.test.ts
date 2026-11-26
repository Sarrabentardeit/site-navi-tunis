import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyMigrations, checksum, planMigrations, quoteLiteral, readMigrations, type MigrationFile } from "../src/migrate";
const HERE = path.dirname(fileURLToPath(import.meta.url));

const mig = (version: string, sql = "select 1"): MigrationFile => ({ version, name: "x", sql, checksum: checksum(sql) });

describe("planMigrations", () => {
  it("applique uniquement les nouvelles migrations, dans l'ordre", () => {
    expect(planMigrations([mig("0001"), mig("0002"), mig("0003")], [{ version: "0001", checksum: checksum("select 1") }]).map((m) => m.version)).toEqual(["0002", "0003"]);
  });
  it("refuse une migration modifiée après application", () => {
    expect(() => planMigrations([mig("0001", "select 2")], [{ version: "0001", checksum: checksum("select 1") }])).toThrow("modifiée");
  });
  it("refuse une migration appliquée mais disparue", () => {
    expect(() => planMigrations([], [{ version: "0001", checksum: "x" }])).toThrow("absente");
  });
  it("refuse une migration insérée avant une migration déjà appliquée", () => {
    expect(() => planMigrations([mig("0001"), mig("0002")], [{ version: "0002", checksum: checksum("select 1") }])).toThrow("précède");
  });
});

describe("readMigrations", () => {
  it("lit et trie les fichiers, refuse les noms invalides et les doublons", async () => {
    const d = await mkdtemp(path.join(tmpdir(), "mig-"));
    await writeFile(path.join(d, "0002_b.sql"), "select 2");
    await writeFile(path.join(d, "0001_a.sql"), "select 1");
    expect((await readMigrations(d)).map((m) => m.version)).toEqual(["0001", "0002"]);
    await writeFile(path.join(d, "mauvais.sql"), "x");
    await expect(readMigrations(d)).rejects.toThrow("invalide");
    const d2 = await mkdtemp(path.join(tmpdir(), "mig-"));
    await writeFile(path.join(d2, "0001_a.sql"), "x");
    await writeFile(path.join(d2, "0001_b.sql"), "x");
    await expect(readMigrations(d2)).rejects.toThrow("dupliquée");
  });
  it("les vraies migrations du dépôt sont numérotées sans trou", async () => {
    const files = await readMigrations(path.join(HERE, "..", "migrations"));
    expect(files.map((f) => f.version)).toEqual(files.map((_, i) => String(i + 1).padStart(4, "0")));
  });
});

describe("quoteLiteral", () => {
  it("double les apostrophes et refuse NUL", () => {
    expect(quoteLiteral("a'b")).toBe("'a''b'");
    expect(quoteLiteral("x'; drop table users; --")).toBe("'x''; drop table users; --'");
    expect(() => quoteLiteral("a\0b")).toThrow();
  });
});

describe("applyMigrations (client factice)", () => {
  it("verrouille, applique chaque migration en transaction, pose les mots de passe, déverrouille", async () => {
    const log: string[] = [];
    const client = {
      query: async (text: string) => {
        log.push(text.split("\n")[0]!.slice(0, 60));
        return { rows: text.startsWith("select version") ? [] : [] };
      },
    };
    const done = await applyMigrations(client, [mig("0001"), mig("0002")], { appPassword: "p'1234567890123456", workerPassword: "w1234567890123456" });
    expect(done).toEqual(["0001_x", "0002_x"]);
    expect(log[0]).toContain("pg_advisory_lock");
    expect(log.filter((l) => l === "begin")).toHaveLength(2);
    expect(log.filter((l) => l === "commit")).toHaveLength(2);
    expect(log.some((l) => l.startsWith("alter role navi_app login password 'p''1234"))).toBe(true);
    expect(log.at(-1)).toContain("pg_advisory_unlock");
  });
  it("annule la transaction et déverrouille en cas d'échec", async () => {
    const log: string[] = [];
    const client = {
      query: async (text: string) => {
        log.push(text.split("\n")[0]!.slice(0, 40));
        if (text === "select boom") throw new Error("syntax error");
        return { rows: [] };
      },
    };
    await expect(applyMigrations(client, [mig("0001", "select boom")], { appPassword: "x".repeat(16), workerPassword: "y".repeat(16) })).rejects.toThrow("échec de la migration 0001_x");
    expect(log).toContain("rollback");
    expect(log.at(-1)).toContain("pg_advisory_unlock");
  });
});
