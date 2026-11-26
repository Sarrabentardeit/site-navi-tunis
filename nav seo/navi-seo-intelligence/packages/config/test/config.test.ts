import { describe, expect, it } from "vitest";
import { EnvError, globalCapUsd, loadLogAgentEnv, loadWebEnv, loadWorkerEnv } from "../src";

const web = {
  DATABASE_URL: "postgres://navi_app:x@localhost:5432/navi",
  APP_BASE_URL: "https://seo.example.com",
  SESSION_SECRET: "s".repeat(32),
  IP_HASH_SECRET: "i".repeat(32),
  CREDENTIALS_KEYRING: "1:abc",
  GLOBAL_MONTHLY_CAP_EUR: "100",
  EUR_USD_RATE: "1.1",
};

describe("loadWebEnv", () => {
  it("accepte une configuration complète et applique les défauts", () => {
    const e = loadWebEnv(web);
    expect(e.SESSION_TTL_HOURS).toBe(12);
    expect(e.SEO_ENV).toBe("development");
    expect(e.GLOBAL_MONTHLY_CAP_EUR).toBe(100);
  });
  it("liste toutes les variables en défaut, sans valeur de secret", () => {
    try {
      loadWebEnv({ ...web, SESSION_SECRET: "court", DATABASE_URL: "mysql://x", EUR_USD_RATE: undefined });
      throw new Error("aurait dû échouer");
    } catch (e) {
      expect(e).toBeInstanceOf(EnvError);
      const m = (e as EnvError).message;
      expect(m).toContain("SESSION_SECRET");
      expect(m).toContain("DATABASE_URL");
      expect(m).toContain("EUR_USD_RATE");
      expect(m).not.toContain("court");
    }
  });
  it("n'invente pas de taux de change", () => {
    expect(() => loadWebEnv({ ...web, EUR_USD_RATE: undefined })).toThrow(EnvError);
  });
});

describe("loadWorkerEnv", () => {
  it("DataForSEO reste à 1 appel simultané par défaut", () => {
    const e = loadWorkerEnv({ DATABASE_URL_WORKER: "postgres://w@h/d", CREDENTIALS_KEYRING: "1:abc", GLOBAL_MONTHLY_CAP_EUR: "100", EUR_USD_RATE: "1.1" });
    expect(e.DATAFORSEO_CONCURRENCY).toBe(1);
  });
});

describe("loadLogAgentEnv", () => {
  it("exige un SITE_ID uuid et un secret solide", () => {
    expect(() => loadLogAgentEnv({ INGEST_URL: "https://x.test/api/ingest", SITE_ID: "pas-un-uuid", INGEST_SECRET: "x".repeat(32), LOG_FILES: "/var/log/apache2/access.log", STATE_DIR: "/var/lib/navi-agent" })).toThrow(EnvError);
  });
});

describe("globalCapUsd", () => {
  it("convertit le plafond de 100 € sans jamais le dépasser", () => {
    expect(globalCapUsd({ GLOBAL_MONTHLY_CAP_EUR: 100, EUR_USD_RATE: 1.0837 })).toBe(108.37);
    expect(globalCapUsd({ GLOBAL_MONTHLY_CAP_EUR: 100, EUR_USD_RATE: 1.08379 })).toBe(108.37);
  });
});
