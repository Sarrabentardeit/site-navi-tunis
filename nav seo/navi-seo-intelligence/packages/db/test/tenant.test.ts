import { describe, expect, it } from "vitest";
import { withOrg, withoutOrg, type PgClientLike } from "../src/tenant";

function fakePool() {
  const log: string[] = [];
  const released: unknown[] = [];
  const client: PgClientLike = {
    query: async (text: string, values?: readonly unknown[]) => {
      log.push(values ? `${text} ${JSON.stringify(values)}` : text);
      if (text === "select boom") throw new Error("boom");
      return { rows: [], rowCount: 0 };
    },
    release: (e) => void released.push(e),
  };
  return { pool: { connect: async () => client }, log, released };
}
const ORG = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("withOrg", () => {
  it("ouvre une transaction et fixe app.org_id en local (3e argument true)", async () => {
    const { pool, log } = fakePool();
    await withOrg(pool, ORG, async (db) => void (await db.query("select 1")));
    expect(log).toEqual(["begin", `select set_config('app.org_id', $1, true) ["${ORG}"]`, "select 1", "commit"]);
  });
  it("annule et détruit la connexion en cas d'erreur", async () => {
    const { pool, log, released } = fakePool();
    await expect(withOrg(pool, ORG, async (db) => void (await db.query("select boom")))).rejects.toThrow("boom");
    expect(log.at(-1)).toBe("rollback");
    expect(released[0]).toBeInstanceOf(Error);
  });
  it("refuse un identifiant qui n'est pas un UUID (aucune connexion ouverte)", async () => {
    const { pool, log } = fakePool();
    await expect(withOrg(pool, "x'; drop table sites; --", async () => 1)).rejects.toThrow(TypeError);
    expect(log).toEqual([]);
  });
});

describe("withoutOrg", () => {
  it("n'appelle jamais set_config", async () => {
    const { pool, log } = fakePool();
    await withoutOrg(pool, async (db) => void (await db.query("select 1")));
    expect(log.some((l) => l.includes("set_config"))).toBe(false);
  });
});
