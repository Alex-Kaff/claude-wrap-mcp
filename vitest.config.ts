import { defineConfig } from "vitest/config";

export default defineConfig({
  // Source uses NodeNext-style ".js" import specifiers that point at ".ts"
  // files; map them so Vitest resolves the TypeScript sources.
  resolve: {
    extensionAlias: { ".js": [".ts", ".js"] },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
