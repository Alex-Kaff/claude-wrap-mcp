import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/server.ts"],
  format: ["esm"],
  target: "node18",
  platform: "node",
  dts: true,
  clean: true,
  sourcemap: true,
  // The CLI entry (dist/index.js) is the `bin`; it must be directly executable.
  banner: { js: "#!/usr/bin/env node" },
});
