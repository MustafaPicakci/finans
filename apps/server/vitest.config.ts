import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    setupFiles: ["./test-setup.ts"], // db.ts'in import-anı DATABASE_URL kontrolü için (bkz. dosya)
  },
});
