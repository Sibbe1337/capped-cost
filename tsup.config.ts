import { defineConfig } from "tsup";

export default defineConfig([
  {
    clean: true,
    dts: true,
    entry: ["src/index.ts", "src/webhook.ts"],
    format: ["esm", "cjs"],
    target: "es2022",
  },
  {
    clean: false,
    entry: ["src/cli.ts"],
    format: ["esm"],
    target: "es2022",
  },
]);
