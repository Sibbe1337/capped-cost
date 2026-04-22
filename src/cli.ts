#!/usr/bin/env node

import { fetchAllCosts } from "./combined.js";
import { fetchAllBreakdowns } from "./breakdown.js";
import { forecast } from "./forecast.js";
import { runInit } from "./cli-init.js";
import type { CombinedCostResult, ProviderCostResult } from "./types.js";

const VERSION = "0.3.0";

const HELP = `
capped-cost — track monthly OpenAI and Anthropic API spend.

USAGE
  capped-cost [command] [options]

COMMANDS
  (default)         Check current-month spend
  init              Interactive setup wizard — guides admin-key setup + writes .env.example
  breakdown         Spend by provider and model
  forecast          Projected end-of-month spend based on current run rate

GLOBAL ENVIRONMENT
  OPENAI_ADMIN_KEY       OpenAI Organization Admin Key (sk-admin-...)
  ANTHROPIC_ADMIN_KEY    Anthropic Organization Admin Key

OPTIONS (default + forecast commands)
  --cap=<usd>            Monthly cap in USD.
  --threshold=<ratio>    Fraction of cap that triggers exit code 2. Default: 0.8.
  --json                 JSON output.
  --daily                (default only) Also print per-day breakdown.
  -h, --help             Show this help.
  -v, --version          Show version.

EXAMPLES
  capped-cost init                         # first-time setup wizard
  capped-cost                              # check current spend
  capped-cost --cap=100                    # alert exit at 80% of $100
  capped-cost breakdown                    # spend by provider and model
  capped-cost forecast --cap=100           # projected end-of-month
  capped-cost --json | jq '.totalUsd'      # pipe to jq

EXIT CODES
  0   Under threshold (or no cap set)
  1   Configuration or API error
  2   At or above threshold

MORE
  https://getcapped.app · https://www.npmjs.com/package/capped-cost
`;

function parseArg(argv: string[], prefix: string): string | undefined {
  const match = argv.find((a) => a.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

function isCostResult(
  r: ProviderCostResult
): r is { dailyCents: Map<string, number>; totalCents: number } {
  return (r as { error?: string }).error === undefined;
}

async function runCheck(args: string[]): Promise<number> {
  const json = args.includes("--json");
  const daily = args.includes("--daily");
  const capRaw = parseArg(args, "--cap=");
  const thresholdRaw = parseArg(args, "--threshold=");
  const capUsd = capRaw !== undefined ? Number(capRaw) : undefined;
  const threshold = thresholdRaw !== undefined ? Number(thresholdRaw) : 0.8;

  if (capUsd !== undefined && !(capUsd > 0)) {
    console.error("--cap must be a positive number");
    return 1;
  }
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
    console.error("--threshold must be in (0, 1]");
    return 1;
  }

  const openai = process.env.OPENAI_ADMIN_KEY;
  const anthropic = process.env.ANTHROPIC_ADMIN_KEY;

  if (!openai && !anthropic) {
    console.error(
      "Set OPENAI_ADMIN_KEY and/or ANTHROPIC_ADMIN_KEY, or run `capped-cost init`."
    );
    return 1;
  }

  let result: CombinedCostResult;
  try {
    result = await fetchAllCosts({ openai, anthropic });
  } catch (err) {
    console.error(
      "Unexpected error:",
      err instanceof Error ? err.message : String(err)
    );
    return 1;
  }

  const totalUsd = result.totalCents / 100;
  const pct = capUsd !== undefined ? totalUsd / capUsd : undefined;
  const over = pct !== undefined && pct >= threshold;

  if (json) {
    const dailyUsd: Record<string, number> = {};
    for (const [day, cents] of result.dailyCents) dailyUsd[day] = cents / 100;
    console.log(
      JSON.stringify(
        {
          totalUsd,
          capUsd: capUsd ?? null,
          thresholdRatio: threshold,
          atOrOverThreshold: over ?? false,
          dailyUsd,
          providers: Object.fromEntries(
            Object.entries(result.providers).map(([name, r]) => {
              if (!r) return [name, null];
              if (!isCostResult(r)) return [name, { error: r.error, hint: r.hint }];
              return [name, { totalUsd: r.totalCents / 100 }];
            })
          ),
        },
        null,
        2
      )
    );
    return over ? 2 : 0;
  }

  console.log(`Month to date: $${totalUsd.toFixed(2)}`);
  if (capUsd !== undefined) {
    console.log(
      `Cap:            $${capUsd.toFixed(2)} (${(pct! * 100).toFixed(0)}% used, threshold ${(threshold * 100).toFixed(0)}%)`
    );
  }
  console.log("");
  let hadError = false;
  for (const [name, r] of Object.entries(result.providers)) {
    if (!r) continue;
    if (!isCostResult(r)) {
      hadError = true;
      console.error(`  ${name.padEnd(10)} ERROR — ${r.error}`);
      if (r.hint && r.hint.length > 0) {
        console.error("");
        console.error("  Likely causes:");
        for (const h of r.hint) console.error(`    • ${h}`);
        console.error("");
      }
      continue;
    }
    console.log(`  ${name.padEnd(10)} $${(r.totalCents / 100).toFixed(2)}`);
  }
  if (daily) {
    console.log("");
    console.log("Daily breakdown:");
    for (const d of Array.from(result.dailyCents.keys()).sort()) {
      const cents = result.dailyCents.get(d) || 0;
      console.log(`  ${d}   $${(cents / 100).toFixed(2)}`);
    }
  }
  if (over) {
    console.error("");
    console.error(
      `!!! At or over ${(threshold * 100).toFixed(0)}% of cap. Exiting 2.`
    );
    return 2;
  }
  return hadError ? 1 : 0;
}

async function runBreakdown(args: string[]): Promise<number> {
  const json = args.includes("--json");
  const openai = process.env.OPENAI_ADMIN_KEY;
  const anthropic = process.env.ANTHROPIC_ADMIN_KEY;
  if (!openai && !anthropic) {
    console.error(
      "Set OPENAI_ADMIN_KEY and/or ANTHROPIC_ADMIN_KEY, or run `capped-cost init`."
    );
    return 1;
  }

  const combined = await fetchAllBreakdowns({ openai, anthropic });

  if (json) {
    const out: Record<string, unknown> = { totalUsd: combined.totalCents / 100 };
    for (const name of ["openai", "anthropic"] as const) {
      const r = combined[name];
      if (!r) continue;
      if ("error" in r) {
        out[name] = { error: r.error, hint: r.hint };
      } else {
        out[name] = {
          totalUsd: r.totalCents / 100,
          byLineItem: Object.fromEntries(
            Array.from(r.byLineItem.entries()).map(([k, v]) => [k, v / 100])
          ),
        };
      }
    }
    console.log(JSON.stringify(out, null, 2));
    return 0;
  }

  const total = combined.totalCents / 100;
  let hadError = false;

  for (const name of ["openai", "anthropic"] as const) {
    const r = combined[name];
    if (!r) continue;
    if ("error" in r) {
      hadError = true;
      console.error(`${name}: ERROR — ${r.error}`);
      if (r.hint) for (const h of r.hint) console.error(`  • ${h}`);
      continue;
    }
    const providerUsd = r.totalCents / 100;
    const providerPct = total > 0 ? (providerUsd / total) * 100 : 0;
    console.log(
      `${name.padEnd(10)} $${providerUsd.toFixed(2).padStart(8)}  ${bar(providerPct)} ${providerPct.toFixed(0)}%`
    );
    const entries = Array.from(r.byLineItem.entries()).sort(
      (a, b) => b[1] - a[1]
    );
    for (const [line, cents] of entries) {
      console.log(`  ${line.padEnd(26)} $${(cents / 100).toFixed(2)}`);
    }
    console.log("");
  }
  console.log(`total      $${total.toFixed(2)}`);
  return hadError ? 1 : 0;
}

function bar(pct: number): string {
  const width = 12;
  const filled = Math.round((pct / 100) * width);
  return "█".repeat(Math.max(0, Math.min(width, filled))).padEnd(width, "░");
}

async function runForecast(args: string[]): Promise<number> {
  const json = args.includes("--json");
  const capRaw = parseArg(args, "--cap=");
  const capUsd = capRaw !== undefined ? Number(capRaw) : undefined;
  if (capUsd !== undefined && !(capUsd > 0)) {
    console.error("--cap must be a positive number");
    return 1;
  }
  const openai = process.env.OPENAI_ADMIN_KEY;
  const anthropic = process.env.ANTHROPIC_ADMIN_KEY;
  if (!openai && !anthropic) {
    console.error(
      "Set OPENAI_ADMIN_KEY and/or ANTHROPIC_ADMIN_KEY, or run `capped-cost init`."
    );
    return 1;
  }
  const combined = await fetchAllCosts({ openai, anthropic });
  const f = forecast({ totalCents: combined.totalCents, capUsd });

  if (json) {
    console.log(JSON.stringify(f, null, 2));
    return f.status === "over" ? 2 : 0;
  }

  console.log(`Day ${f.dayOfMonth} of ${f.daysInMonth}`);
  console.log(`Month-to-date: $${f.totalUsd.toFixed(2)}`);
  console.log(`Daily average: $${f.dailyAvgUsd.toFixed(2)}`);
  console.log(`Projected EOM: $${f.projectedEomUsd.toFixed(2)}`);
  if (capUsd !== undefined) {
    const pct = (f.projectedPctOfCap! * 100).toFixed(0);
    console.log(`Cap:           $${capUsd.toFixed(2)} (projected ${pct}%)`);
    console.log("");
    if (f.status === "over") {
      console.error(
        `!!! Projected to exceed cap by $${f.overCapUsd!.toFixed(2)}. Throttle or raise the cap.`
      );
    } else if (f.status === "on-pace") {
      console.log("Close to cap — monitor the next few days.");
    } else {
      console.log("Comfortably under cap.");
    }
  }
  return f.status === "over" ? 2 : 0;
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv.includes("-h") || argv.includes("--help") || argv[0] === "help") {
    console.log(HELP);
    process.exit(0);
  }
  if (argv.includes("-v") || argv.includes("--version")) {
    console.log(VERSION);
    process.exit(0);
  }

  const cmd = argv[0];
  let exitCode: number;

  try {
    if (cmd === "init") {
      exitCode = await runInit(argv.slice(1));
    } else if (cmd === "breakdown") {
      exitCode = await runBreakdown(argv.slice(1));
    } else if (cmd === "forecast") {
      exitCode = await runForecast(argv.slice(1));
    } else {
      // Default: check current spend.
      exitCode = await runCheck(argv);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    exitCode = 1;
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
