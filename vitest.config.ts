import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  // the integration tests share one Postgres, so files run one after another (counts and trash are global)
  test: { include: ["tests/**/*.test.ts"], environment: "node", fileParallelism: false },
});
