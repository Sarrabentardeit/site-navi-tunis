import { defineConfig } from "vitest/config";

/**
 * Deux projets :
 *  - unit : aucun service externe (par défaut, tourne partout) ;
 *  - db-integration : exige un PostgreSQL réel (TEST_DATABASE_URL) — tests RLS, voir docs/DEVELOPER-GUIDE.md §7.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
          exclude: ["packages/db/test/integration/**"],
        },
      },
      {
        test: {
          name: "db-integration",
          environment: "node",
          include: ["packages/db/test/integration/**/*.test.ts"],
          testTimeout: 30_000,
        },
      },
    ],
  },
});
