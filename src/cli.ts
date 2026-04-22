#!/usr/bin/env node

import { fetchAllCosts } from "./combined.js";
import type { CombinedCostResult, ProviderCostResult } from "./types.js";

const HELP = `
capped-cost — fetch OpenAI and Anthropic API spend from the command line.

USAGE
  capped-cost [options]

ENVIRONMENT
  OPENAI_ADMIN_KEY       OpenAI Organization Admin Key (sk-admin-...)
  ANTHROPIC_ADMIN_KEY    Anthropic Organization Admin Key

OPTIONS
  --cap=<usd>            Monthly cap in USD. If set and spend >= threshold,
                         exits with code 2 (useful for cron + alerting).
  --threshold=<ratio>    Fraction of cap that triggers alert exit code.
                         Default: 0.8 (80%). Range 0–1.
  --json                 Output JSON instead of human-readable text.
  --daily                Also print per-day breakdown.
  -h, --help             Show this help.
  -v, --version          Show version.

EXIT CODES
  0   Under threshold (or no cap set)
  1   Configuration or API error
  2   At or above threshold

EXAMPLES
  # Basic check
  capped-cost

  # With a cap; exits 2 at 80% of $100
  capped-cost --cap=100

  # Strict: exits 2 at 50% of $100
  capped-cost --cap=100 --threshold=0.5

  # JSON for piping into other tools
  capped-cost --json | jq '.totalUsd'

  # Cron: alert Slack when over cap
  0 * * * * capped-cost --cap=100 || curl -X POST -d "..." $SLACK_URL

MORE
  https://getcapped.app · https://www.npmjs.com/package/capped-cost
`;

const VERSION = "0.2.0";

function parseArg(argv: string[], prefix: string): string | undefined {
  const match = argv.find((a) => a.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

function isCostResult(
  r: ProviderCostResult
): r is { dailyCents: Map<string, number>; totalCents: number } {
  return (r as { error?: string }).error === undefined;
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(HELP);
    process.exit(0);
  }
  if (argv.includes("-v") || argv.includes("--version")) {
    console.log(VERSION);
    process.exit(0);
  }

  const json = argv.includes("--json");
  const daily = argv.includes("--daily");
  const capRaw = parseArg(argv, "--cap=");
  const thresholdRaw = parseArg(argv, "--threshold=");
  const capUsd = capRaw !== undefined ? Number(capRaw) : undefined;
  const threshold = thresholdRaw !== undefined ? Number(thresholdRaw) : 0.8;

  if (capUsd !== undefined && !(capUsd > 0)) {
    console.error("--cap must be a positive number");
    process.exit(1);
  }
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
    console.error("--threshold must be in (0, 1]");
    process.exit(1);
  }

  const openai = process.env.OPENAI_ADMIN_KEY;
  const anthropic = process.env.ANTHROPIC_ADMIN_KEY;

  if (!openai && !anthropic) {
    console.error(
      "Set OPENAI_ADMIN_KEY and/or ANTHROPIC_ADMIN_KEY. Run capped-cost --help for details."
    );
    process.exit(1);
  }

  let result: CombinedCostResult;
  try {
    result = await fetchAllCosts({ openai, anthropic });
  } catch (err) {
    console.error(
      "Unexpected error:",
      err instanceof Error ? err.message : String(err)
    );
    process.exit(1);
  }

  const totalUsd = result.totalCents / 100;
  const pct = capUsd !== undefined ? totalUsd / capUsd : undefined;
  const over = pct !== undefined && pct >= threshold;

  if (json) {
    const dailyUsd: Record<string, number> = {};
    for (const [day, cents] of result.dailyCents) {
      dailyUsd[day] = cents / 100;
    }
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
              if (!isCostResult(r)) return [name, { error: r.error }];
              return [name, { totalUsd: r.totalCents / 100 }];
            })
          ),
        },
        null,
        2
      )
    );
    process.exit(over ? 2 : 0);
  }

  // Human-readable.
  console.log(`Month to date: $${totalUsd.toFixed(2)}`);
  if (capUsd !== undefined) {
    const pctNum = (pct! * 100).toFixed(0);
    console.log(
      `Cap:            $${capUsd.toFixed(2)} (${pctNum}% used, threshold ${(threshold * 100).toFixed(0)}%)`
    );
  }
  console.log("");
  for (const [name, r] of Object.entries(result.providers)) {
    if (!r) continue;
    if (!isCostResult(r)) {
      console.error(`  ${name.padEnd(10)} ERROR — ${r.error}`);
      continue;
    }
    console.log(`  ${name.padEnd(10)} $${(r.totalCents / 100).toFixed(2)}`);
  }
  if (daily) {
    console.log("");
    console.log("Daily breakdown:");
    const days = Array.from(result.dailyCents.keys()).sort();
    for (const d of days) {
      const cents = result.dailyCents.get(d) || 0;
      console.log(`  ${d}   $${(cents / 100).toFixed(2)}`);
    }
  }

  if (over) {
    console.error("");
    console.error(
      `!!! At or over ${(threshold * 100).toFixed(0)}% of cap. Exiting 2.`
    );
    process.exit(2);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
