/**
 * Interactive setup wizard. Guides first-time users through admin-key
 * generation, validates the keys by making a real fetch, and writes
 * a .env.example file they can copy.
 */

import { createInterface } from "node:readline/promises";
import { writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fetchOpenAICost } from "./openai.js";
import { fetchAnthropicCost } from "./anthropic.js";

function color(s: string, code: string): string {
  // Skip color in non-TTY or when NO_COLOR is set.
  if (!process.stdout.isTTY || process.env.NO_COLOR) return s;
  return `\x1b[${code}m${s}\x1b[0m`;
}

const dim = (s: string) => color(s, "2");
const bold = (s: string) => color(s, "1");
const green = (s: string) => color(s, "32");
const red = (s: string) => color(s, "31");
const cyan = (s: string) => color(s, "36");

export async function runInit(_args: string[]): Promise<number> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const ask = async (q: string, defaultValue?: string): Promise<string> => {
    const suffix = defaultValue ? dim(` (default ${defaultValue})`) : "";
    const answer = (await rl.question(`${q}${suffix}: `)).trim();
    return answer || defaultValue || "";
  };
  const askYesNo = async (q: string, defaultYes = true): Promise<boolean> => {
    const marker = defaultYes ? "Y/n" : "y/N";
    const answer = (await rl.question(`${q} (${marker}): `)).trim().toLowerCase();
    if (!answer) return defaultYes;
    return answer === "y" || answer === "yes";
  };

  console.log("");
  console.log(bold("capped-cost setup"));
  console.log(dim("Walks you through admin-key setup and writes .env.example."));
  console.log("");

  const env: Record<string, string> = {};
  let anySucceeded = false;

  // OpenAI
  const trackOpenAI = await askYesNo("Track OpenAI spend?");
  if (trackOpenAI) {
    console.log("");
    console.log(
      `  Admin keys: ${cyan("https://platform.openai.com/settings/organization/admin-keys")}`
    );
    console.log(dim("  (Requires Organization Owner role. Different from your API key.)"));
    console.log("");
    const key = await ask("  OpenAI admin key");
    if (key) {
      process.stdout.write("  Testing... ");
      const r = await fetchOpenAICost(key);
      if ("error" in r) {
        console.log(red("failed"));
        console.log(`  ${r.error}`);
        if (r.hint) for (const h of r.hint) console.log(dim(`    • ${h}`));
        console.log("");
      } else {
        console.log(green("✓"));
        console.log(
          `  Current month: $${(r.totalCents / 100).toFixed(2)}`
        );
        env.OPENAI_ADMIN_KEY = key;
        anySucceeded = true;
      }
    }
    console.log("");
  }

  // Anthropic
  const trackAnthropic = await askYesNo("Track Anthropic spend?");
  if (trackAnthropic) {
    console.log("");
    console.log(
      `  Admin keys: ${cyan("https://console.anthropic.com/settings/admin-keys")}`
    );
    console.log("");
    const key = await ask("  Anthropic admin key");
    if (key) {
      process.stdout.write("  Testing... ");
      const r = await fetchAnthropicCost(key);
      if ("error" in r) {
        console.log(red("failed"));
        console.log(`  ${r.error}`);
        if (r.hint) for (const h of r.hint) console.log(dim(`    • ${h}`));
        console.log("");
      } else {
        console.log(green("✓"));
        console.log(
          `  Current month: $${(r.totalCents / 100).toFixed(2)}`
        );
        env.ANTHROPIC_ADMIN_KEY = key;
        anySucceeded = true;
      }
    }
    console.log("");
  }

  if (!anySucceeded) {
    console.log(red("No providers configured. Exiting without writing files."));
    rl.close();
    return 1;
  }

  // Cap + alert target
  const capStr = await ask("Monthly cap in USD", "100");
  const capUsd = Number(capStr) || 100;
  env.CAPPED_CAP_USD = String(capUsd);

  const alertChoice = (
    await ask("Alert target: [1] Slack, [2] Discord, [3] None", "3")
  ).trim();
  if (alertChoice === "1" || alertChoice === "2") {
    const label = alertChoice === "1" ? "Slack" : "Discord";
    const url = await ask(`  ${label} webhook URL`);
    if (url) env.CAPPED_WEBHOOK_URL = url;
  }

  // Write .env.example (NEVER overwrite; write .env.example.new if file exists)
  const envPath = resolve(process.cwd(), ".env.example");
  const lines = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  const content = lines.join("\n") + "\n";

  let targetPath = envPath;
  if (existsSync(envPath)) {
    targetPath = resolve(process.cwd(), ".env.example.capped");
    console.log("");
    console.log(
      dim(
        ".env.example already exists; writing .env.example.capped instead."
      )
    );
  }
  writeFileSync(targetPath, content, { mode: 0o600 });

  console.log("");
  console.log(green("✓ Setup complete."));
  console.log("");
  console.log(`  Wrote: ${cyan(targetPath)}`);
  console.log("");
  console.log(bold("Next steps:"));
  console.log("  1. Copy values into your real .env or export them in your shell.");
  console.log(`  2. Run ${cyan("capped-cost")} to check current spend.`);
  console.log(
    `  3. Run ${cyan(`capped-cost --cap=${capUsd}`)} from cron or GitHub Actions.`
  );
  console.log(
    `  4. See ${cyan("capped-cost breakdown")} for per-model spend, ${cyan("capped-cost forecast")} for projections.`
  );
  console.log("");

  rl.close();
  return 0;
}
