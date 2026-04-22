# capped-cost

[![npm](https://img.shields.io/npm/v/capped-cost)](https://www.npmjs.com/package/capped-cost)
[![CI](https://github.com/Sibbe1337/capped-cost/actions/workflows/ci.yml/badge.svg)](https://github.com/Sibbe1337/capped-cost/actions/workflows/ci.yml)
[![bundle size](https://img.shields.io/bundlephobia/minzip/capped-cost)](https://bundlephobia.com/package/capped-cost)

`capped-cost` is a small, zero-runtime-dependency library and CLI for reading monthly OpenAI and Anthropic organization spend, projecting end-of-month burn, and sending deduped Slack or Discord alerts.

It is built for scripts, cron jobs, CI, and internal tooling. It is not a billing platform, not a dashboard SaaS, and not a secret-management solution.

It is part of **Open source by Capped**: small, scriptable guardrails for developers who do not want another dashboard.

- Node 18+
- Zero runtime dependencies
- ESM + CJS
- CLI + library
- OpenAI + Anthropic
- JSON output with `schemaVersion`

```bash
npm install capped-cost
```

## What It Does

- Reads month-to-date usage cost from OpenAI and Anthropic admin APIs
- Normalizes totals and daily series across providers
- Breaks spend down by model / line item
- Projects end-of-month spend with explainable strategies
- Sends Slack or Discord alerts only on threshold crossings or cooldown expiry

## Where It Fits

Capped now has two paths:

- **Capped Extension** for the plug-and-play path
- **Open source by Capped** for cron, CI, and custom workflows

Within that open-source path:

- `capped-cost` is the opinionated spend-specific tool
- `threshold-hook` is the lower-level generic threshold primitive

## What It Does Not Do

- It does not proxy API calls for you
- It does not store long-term history in a database
- It does not block provider usage or enforce hard budgets
- It does not make client-side admin-key usage safe
- It does not replace your cloud secret store or CI secret manager

## Why Admin Keys Are Required

The spend endpoints used here are organization-level/admin endpoints. Standard model-serving API keys are not enough.

That is why the package asks for:

- `OPENAI_ADMIN_KEY`
- `ANTHROPIC_ADMIN_KEY`

If you only use one provider, you only need that provider's admin key.

## Security Model

This package is designed to be safe by default, but it still handles high-value secrets. The intended model is:

- secrets live in environment variables, CI secrets, or a local-only file
- `.env.example` is placeholder-only
- real secrets are only written to `.env.capped.local` when explicitly requested
- the local secrets file is gitignored
- the CLI avoids echoing secrets back to the terminal

This package is best used on:

- a developer machine
- a cron host
- CI with proper secret storage
- server-side automation

It is not safe to ship org admin keys to a public browser app, public website, or distributed Chrome extension.

## Browser And Extension Caveat

The fetch-based library can technically run anywhere that provides `fetch`, including browser-like environments. That does not mean it is appropriate to expose there.

If you are building a browser app or extension:

- do not embed org admin keys in shipped client code
- do not treat obfuscation as protection
- prefer a backend, worker, or other trusted boundary
- if you insist on local-only/private usage, understand that the user machine holds the secret

## Quickstart

```bash
# install globally if you want the CLI
npm install -g capped-cost

# safe setup wizard
capped-cost init

# current spend
capped-cost check

# model / line-item breakdown
capped-cost breakdown

# forecast against a cap
capped-cost forecast --cap=100

# alert only when thresholds are crossed or cooldown expires
capped-cost alert --cap=100 --webhook-url="$CAPPED_WEBHOOK_URL"
```

## Init Wizard

`capped-cost init` is intentionally conservative.

It will:

- prompt for admin keys without echoing them visibly
- optionally validate keys live
- write a placeholder-only `.env.example`
- optionally write real secrets to `.env.capped.local`

It will not:

- write your real secrets to `.env.example`
- print full secrets or webhook URLs back to the terminal
- silently create a secret-bearing file without confirmation

Examples:

```bash
# interactive
capped-cost init

# non-interactive
capped-cost init \
  --openai-key="$OPENAI_ADMIN_KEY" \
  --cap=100 \
  --webhook-url="$CAPPED_WEBHOOK_URL" \
  --write-secrets-file \
  --yes
```

## CLI

### `check`

Reads current month-to-date spend and exits non-zero only for threshold or provider/config problems.

```bash
capped-cost check --cap=100 --threshold=0.8
capped-cost check --provider=openai --format=json
capped-cost --provider=anthropic --daily
```

### `breakdown`

Groups spend by provider and model / line item.

```bash
capped-cost breakdown
capped-cost breakdown --provider=openai --format=json
```

### `forecast`

Projects end-of-month spend.

```bash
capped-cost forecast --cap=100
capped-cost forecast --strategy=rolling-7d --format=json
capped-cost forecast --strategy=weighted-recent
```

### `alert`

Runs a real alerting flow:

- fetch spend
- evaluate thresholds
- send a webhook only when needed
- persist dedupe state in `.capped-cost.state.json` by default

```bash
capped-cost alert \
  --cap=100 \
  --thresholds=0.8,1,1.5 \
  --cooldown-ms=21600000 \
  --webhook-url="$CAPPED_WEBHOOK_URL"
```

This is the command you want for cron/CI alerting. Do not use shell `|| curl` as the primary alerting mechanism. That pattern conflates budget alerts with provider failures and config failures.

## Alerting Semantics

`capped-cost alert` explicitly separates these cases:

- configuration failure
- provider failure
- under threshold
- threshold crossed
- threshold still reached after cooldown
- webhook delivery failure

Important behavior:

- provider failures do not emit budget alerts
- webhook failures do not advance the dedupe state
- state resets naturally when the month changes

Default alert thresholds are:

- `0.8`
- `1`
- `1.5`

Default cooldown is 6 hours.

## Correct Cron And CI Usage

The dedicated alert path assumes the state file persists between runs.

Good fits:

- local cron on a persistent machine
- a VM
- a container with mounted storage
- GitHub Actions with cache-backed state

GitHub-hosted runners are ephemeral, so dedupe only works if you restore and save the state file. See [`examples/github-action-cost-check.yml`](./examples/github-action-cost-check.yml) for a working pattern.

## Forecast Strategies

The forecast intentionally stays explainable. It does not claim statistical sophistication it does not have.

Available strategies:

- `linear`: project from the month-to-date average
- `rolling-7d`: project from the last 7 calendar days
- `weighted-recent`: weight recent days more heavily

Each forecast result includes:

- requested strategy
- strategy actually used
- observation window
- confidence note / caveat

If you request a recent-history strategy without daily data, the result falls back to `linear` and says so explicitly.

## Library Usage

### Fetch spend

```ts
import { fetchAllCosts } from "capped-cost";

const result = await fetchAllCosts({
  openai: process.env.OPENAI_ADMIN_KEY,
  anthropic: process.env.ANTHROPIC_ADMIN_KEY,
});

console.log(result.totalCents);
console.log(result.dailyCents);
console.log(result.providers);
```

### Forecast

```ts
import { fetchAllCosts, forecast } from "capped-cost";

const costs = await fetchAllCosts({
  openai: process.env.OPENAI_ADMIN_KEY,
});

const projection = forecast({
  totalCents: costs.totalCents,
  dailyCents: costs.dailyCents,
  capUsd: 100,
  strategy: "rolling-7d",
});

console.log(projection.projectedEomUsd);
console.log(projection.confidenceNote);
```

### Alert evaluation

```ts
import { evaluateAlert } from "capped-cost";

const evaluation = evaluateAlert({
  totalCents: 8500,
  capUsd: 100,
  thresholds: [0.8, 1, 1.5],
});

console.log(evaluation.status);
console.log(evaluation.shouldAlert);
```

### Webhook helper

```ts
import { checkAndAlert } from "capped-cost/webhook";

const result = await checkAndAlert({
  keys: {
    openai: process.env.OPENAI_ADMIN_KEY,
    anthropic: process.env.ANTHROPIC_ADMIN_KEY,
  },
  capUsd: 100,
  thresholds: [0.8, 1, 1.5],
  cooldownMs: 6 * 60 * 60 * 1000,
  webhookUrl: process.env.CAPPED_WEBHOOK_URL!,
  state: previousState,
});

if (result.status === "provider-failure") {
  console.error(result.fetchErrors);
}
```

If you use the library path, you own state persistence yourself.

## JSON Output

Every JSON-capable CLI command includes:

- `schemaVersion`
- `command`
- `status`
- `ok`

Example:

```bash
capped-cost check --provider=openai --format=json
```

```json
{
  "schemaVersion": 1,
  "command": "check",
  "status": "ok",
  "ok": true,
  "provider": "openai",
  "totalUsd": 12.34
}
```

Treat `schemaVersion` as the contract marker for automation.

## Config Precedence

Configuration is loaded in this order:

1. CLI flags
2. `process.env`
3. `.env.capped.local`
4. `.env.local`
5. `.env`

Main environment variables:

- `OPENAI_ADMIN_KEY`
- `ANTHROPIC_ADMIN_KEY`
- `CAPPED_PROVIDER`
- `CAPPED_CAP_USD`
- `CAPPED_CHECK_THRESHOLD`
- `CAPPED_FORECAST_STRATEGY`
- `CAPPED_WEBHOOK_URL`
- `CAPPED_ALERT_THRESHOLDS`
- `CAPPED_ALERT_COOLDOWN_MS`
- `CAPPED_COST_STATE_FILE`
- `CAPPED_TIMEOUT_MS`

## Exit Codes

`check` and `forecast`:

- `0`: success / under threshold
- `1`: configuration or provider failure
- `2`: threshold reached or projection over cap

`alert`:

- `0`: success, including deduped "no alert needed" runs
- `1`: configuration failure
- `2`: provider failure
- `3`: webhook delivery failure

Unhandled internal errors exit `10`.

## Development

```bash
npm ci
npm run verify
```

Tests are deterministic and should not make real network calls.

## Related Docs

- [SECURITY.md](./SECURITY.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [CHANGELOG.md](./CHANGELOG.md)

Built alongside [Capped](https://getcapped.app), but this package is intended to stand on its own as a small automation primitive.
