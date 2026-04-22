# capped-cost

[![npm](https://img.shields.io/npm/v/capped-cost)](https://www.npmjs.com/package/capped-cost)
[![CI](https://github.com/Sibbe1337/capped-cost/actions/workflows/ci.yml/badge.svg)](https://github.com/Sibbe1337/capped-cost/actions/workflows/ci.yml)
[![bundle size](https://img.shields.io/bundlephobia/minzip/capped-cost)](https://bundlephobia.com/package/capped-cost)

Fetch monthly OpenAI and Anthropic API spend. Library, CLI, per-model breakdown, end-of-month forecast, and Slack/Discord webhook alerts. Zero runtime dependencies.

```bash
npm install capped-cost
```

Built alongside [Capped](https://getcapped.app) — a Chrome extension that watches your OpenAI and Anthropic spend and alerts you at 80/100/150% of a monthly cap. If you want the budgeting + alerting without writing the cron yourself, try the extension. If you want to build something custom, this package is the primitive.

---

## 60-second quickstart

```bash
# Install globally
npm install -g capped-cost

# Run the setup wizard — tests your keys live, writes .env.example
capped-cost init

# Check current spend
capped-cost

# Per-model breakdown
capped-cost breakdown

# Projected end-of-month
capped-cost forecast --cap=100
```

That's it. Set `OPENAI_ADMIN_KEY` and/or `ANTHROPIC_ADMIN_KEY` in your environment (or let `init` write an `.env.example` for you) and every command works.

---

## What you get

- **Library** — `fetchOpenAICost`, `fetchAnthropicCost`, `fetchAllCosts`. Normalized output, cents everywhere.
- **CLI** — `capped-cost` binary with four subcommands: `init`, `breakdown`, `forecast`, and the default spend check.
- **Per-model breakdown** — `fetchOpenAICostBreakdown`, `fetchAnthropicCostBreakdown`, `fetchAllBreakdowns` group spend by model/line-item.
- **Forecast** — `forecast()` projects your run rate to end-of-month and classifies it as `under`, `on-pace`, or `over`.
- **Better errors** — `explainOpenAIError` / `explainAnthropicError` map HTTP status codes to human-readable hints (wrong key type, missing permissions, rate limits).
- **Webhook helpers** — Slack + Discord, auto-detected. `postCostAlert` + `checkAndAlert` for one-shot cron alerts.
- **GitHub Actions template** — drop-in hourly cron workflow in `examples/`.

~6 KB gzipped. Zero runtime deps. Works on Node 18+, Bun, Deno, browsers, Chrome extensions.

---

## 1. Library

### OpenAI only

```ts
import { fetchOpenAICost } from "capped-cost";

const result = await fetchOpenAICost(process.env.OPENAI_ADMIN_KEY!);

if ("error" in result) {
  console.error(result.error);
} else {
  console.log(`Month to date: $${(result.totalCents / 100).toFixed(2)}`);
  for (const [day, cents] of result.dailyCents) {
    console.log(`  ${day}: $${(cents / 100).toFixed(2)}`);
  }
}
```

### Anthropic only

```ts
import { fetchAnthropicCost } from "capped-cost";
// same shape as fetchOpenAICost
```

### Both providers in parallel

```ts
import { fetchAllCosts } from "capped-cost";

const { totalCents, dailyCents, providers } = await fetchAllCosts({
  openai: process.env.OPENAI_ADMIN_KEY,
  anthropic: process.env.ANTHROPIC_ADMIN_KEY,
});

console.log(`Combined month to date: $${(totalCents / 100).toFixed(2)}`);
```

### Per-model breakdown

```ts
import { fetchAllBreakdowns } from "capped-cost";

const breakdown = await fetchAllBreakdowns({
  openai: process.env.OPENAI_ADMIN_KEY,
  anthropic: process.env.ANTHROPIC_ADMIN_KEY,
});

if (breakdown.openai && !("error" in breakdown.openai)) {
  for (const [model, cents] of breakdown.openai.byLineItem) {
    console.log(`  ${model}: $${(cents / 100).toFixed(2)}`);
  }
}
```

### End-of-month forecast

```ts
import { fetchAllCosts, forecast } from "capped-cost";

const { totalCents } = await fetchAllCosts({ openai: process.env.OPENAI_ADMIN_KEY });
const f = forecast({ totalCents, capUsd: 100 });

console.log(`Day ${f.dayOfMonth}/${f.daysInMonth}`);
console.log(`Projected EOM: $${f.projectedEomUsd.toFixed(2)}`);
console.log(`Status: ${f.status}`); // "under" | "on-pace" | "over"
```

### Better error messages

```ts
import { explainOpenAIError, formatErrorForTerminal } from "capped-cost";

// Map HTTP status + message to actionable hints
const explained = explainOpenAIError(401, "Invalid authentication");
// explained.hint → ["Make sure you're using an Organization Admin Key, not a standard API key", ...]

// Format for terminal output
console.error(formatErrorForTerminal(explained));
```

---

## 2. CLI

```bash
npm install -g capped-cost
```

### `capped-cost init` — first-time setup wizard

Guides you through getting admin keys from both providers, tests each key live, and writes an `.env.example` you can copy directly into CI or your deployment platform.

```
$ capped-cost init
? Do you have an OpenAI Organization Admin Key? (y/n) › y
? Paste your OpenAI Admin Key: › sk-admin-...
  Testing... ✓ Key works — current spend: $12.40
? Do you have an Anthropic Admin Key? (y/n) › y
...
  .env.example written.
```

### `capped-cost` — check current spend

```bash
# Minimum
export OPENAI_ADMIN_KEY=sk-admin-...
export ANTHROPIC_ADMIN_KEY=...
capped-cost

# With a cap; exits 2 when month-to-date >= 80% of $100
capped-cost --cap=100

# Strict: alert when at 50% of cap
capped-cost --cap=100 --threshold=0.5

# JSON output
capped-cost --json | jq '.totalUsd'

# Include per-day breakdown
capped-cost --daily
```

### `capped-cost breakdown` — spend by model

```bash
capped-cost breakdown
# openai      $  34.12  ████████████ 68%
#   gpt-4o                   $24.10
#   gpt-4o-mini              $ 8.40
#   gpt-4-turbo              $ 1.62
#
# anthropic   $  15.88  ████░░░░░░░░ 32%
#   claude-3-7-sonnet        $10.20
#   claude-3-5-haiku         $ 5.68
#
# total      $50.00

capped-cost breakdown --json | jq '.openai.byLineItem'
```

### `capped-cost forecast` — projected end-of-month

```bash
capped-cost forecast
# Day 12 of 30
# Month-to-date: $20.00
# Daily average: $1.67
# Projected EOM: $50.00

capped-cost forecast --cap=100
# ...
# Cap:           $100.00 (projected 50%)
# Comfortably under cap.

capped-cost forecast --cap=100 --json
```

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Under threshold (or no cap set) |
| `1` | Config or API error |
| `2` | At or above threshold |

### Cron example

```bash
0 * * * * capped-cost --cap=100 || curl -X POST \
  -H 'Content-Type: application/json' \
  -d '{"text":"AI spend alert — check the usage dashboard"}' \
  "$SLACK_WEBHOOK_URL"
```

For a cleaner alert pipeline, use the webhook module below. For a drop-in GitHub Actions workflow, see [`examples/github-action-cost-check.yml`](examples/github-action-cost-check.yml).

---

## 3. Webhook helpers

Post a formatted alert to Slack or Discord. Provider auto-detected from URL.

### One-shot check + alert

```ts
import { checkAndAlert } from "capped-cost/webhook";

const result = await checkAndAlert({
  keys: {
    openai: process.env.OPENAI_ADMIN_KEY,
    anthropic: process.env.ANTHROPIC_ADMIN_KEY,
  },
  capUsd: 100,
  threshold: 0.8,                    // optional, default 0.8
  webhookUrl: process.env.SLACK_WEBHOOK_URL!,
  label: "production",               // optional; appears in alert text
});

console.log(`Total: $${result.totalUsd.toFixed(2)} (${(result.pct * 100).toFixed(0)}%)`);
if (result.alerted) {
  console.log(result.webhookResult?.ok ? "alerted" : `alert failed: ${result.webhookResult?.error}`);
}
```

### Lower-level primitives

```ts
import { postCostAlert, formatAlertMessage } from "capped-cost/webhook";

// Just format, don't send — drop into your own pipeline
const text = formatAlertMessage({
  totalUsd: 87.23,
  capUsd: 100,
  threshold: 0.8,
  label: "production",
});
// → ":warning: AI spend alert (production)\nMonth-to-date: $87.23 / $100.00 cap — 87% used\nThreshold: 80%"

// Or send directly
await postCostAlert(
  { url: process.env.SLACK_WEBHOOK_URL! },
  { totalUsd: 87.23, capUsd: 100, threshold: 0.8, label: "production" }
);
```

### Complete 10-line cron job

```ts
// budget-check.ts — run from cron
import { checkAndAlert } from "capped-cost/webhook";

const r = await checkAndAlert({
  keys: {
    openai: process.env.OPENAI_ADMIN_KEY,
    anthropic: process.env.ANTHROPIC_ADMIN_KEY,
  },
  capUsd: Number(process.env.CAP_USD || 100),
  webhookUrl: process.env.SLACK_WEBHOOK_URL!,
});

if (r.alerted && !r.webhookResult?.ok) process.exit(1);
```

---

## Admin keys

Both providers require an **Organization Admin Key** — different from a standard API key. Admin keys can read usage but cannot make model calls or spend money.

- **OpenAI**: https://platform.openai.com/settings/organization/admin-keys (requires Organization Owner role)
- **Anthropic**: https://console.anthropic.com/settings/admin-keys

Store admin keys the same way you store any production secret. `capped-cost` does not proxy, log, or transmit them anywhere outside the direct call to the provider.

---

## API reference

```ts
// Cost fetching
fetchOpenAICost(adminKey: string, options?: FetchOptions): Promise<CostResult | CostError>
fetchAnthropicCost(adminKey: string, options?: FetchOptions): Promise<CostResult | CostError>
fetchAllCosts(keys, options?: FetchOptions): Promise<CombinedCostResult>

// Per-model breakdown
fetchOpenAICostBreakdown(adminKey: string, options?: FetchOptions): Promise<BreakdownResult | BreakdownError>
fetchAnthropicCostBreakdown(adminKey: string, options?: FetchOptions): Promise<BreakdownResult | BreakdownError>
fetchAllBreakdowns(keys, options?: FetchOptions): Promise<CombinedBreakdown>

// Forecast
forecast(input: ForecastInput): ForecastResult

// Error helpers
explainOpenAIError(status: number, message: string): ExplainedError
explainAnthropicError(status: number, message: string): ExplainedError
formatErrorForTerminal(error: ExplainedError): string

// Webhook (import from "capped-cost/webhook")
checkAndAlert(options: CheckAndAlertOptions): Promise<CheckAndAlertResult>
postCostAlert(target, payload): Promise<{ ok: boolean; status?: number; error?: string }>
formatAlertMessage(payload: AlertPayload): string

// Types
interface CostResult { dailyCents: Map<string, number>; totalCents: number; }
interface CostError { error: string; hint?: string[]; }
interface BreakdownResult { totalCents: number; byLineItem: Map<string, number>; }
interface ForecastResult { dayOfMonth: number; daysInMonth: number; totalUsd: number; dailyAvgUsd: number; projectedEomUsd: number; projectedPctOfCap?: number; overCapUsd?: number; status: "under" | "on-pace" | "over"; }
interface ExplainedError { error: string; status?: number; hint?: string[]; }
interface FetchOptions { fetch?: typeof globalThis.fetch; signal?: AbortSignal; }
```

---

## Runtime support

- Node 18+ (native `fetch`)
- Bun
- Deno
- Every modern browser (CORS permitting)
- Chrome extensions (service workers + content scripts)

---

## Roadmap

- [ ] Gemini adapter (via Google Cloud Billing API) — [#2](https://github.com/Sibbe1337/capped-cost/issues/2)
- [ ] AWS Bedrock adapter (via Cost Explorer) — [#3](https://github.com/Sibbe1337/capped-cost/issues/3)
- [ ] Rate-limit metrics output (requests/day + tokens/day) — [#1](https://github.com/Sibbe1337/capped-cost/issues/1)

PRs welcome. Gemini and Bedrock each need provider-specific auth flows that would break the zero-deps promise of this package — if built, they'll likely ship as separate companion packages (`capped-cost-gemini`, `capped-cost-bedrock`) so this core stays lean.

---

## License

MIT.

## Related reading

- [What does the OpenAI API actually cost in 2026?](https://getcapped.app/openai-api-cost)
- [Why is my OpenAI bill so high? 7 common causes](https://getcapped.app/why-is-my-openai-bill-so-high)
- [How to reduce OpenAI API costs in 2026](https://getcapped.app/reduce-openai-api-costs)
- [OpenAI vs Claude API pricing comparison](https://getcapped.app/openai-vs-claude-api-pricing)
