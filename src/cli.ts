#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { evaluateAlert, type AlertState } from "./alert.js";
import { fetchAnthropicCost } from "./anthropic.js";
import { fetchAllBreakdowns } from "./breakdown.js";
import { fetchAllCosts } from "./combined.js";
import {
  DEFAULT_ALERT_COOLDOWN_MS,
  DEFAULT_ALERT_THRESHOLDS,
  DEFAULT_CHECK_THRESHOLD,
  DEFAULT_STATE_FILE,
  EXIT_CODES,
  JSON_SCHEMA_VERSION,
  type OutputFormat,
  type ProviderSelector,
} from "./constants.js";
import { loadLocalEnv } from "./env.js";
import { formatPct, formatThresholdLabel, formatUsd, formatUsdFromCents, sortedEntries, bar } from "./format.js";
import { forecast, type ForecastStrategy } from "./forecast.js";
import { runInit, type RunInitDeps } from "./cli-init.js";
import { fetchOpenAICost } from "./openai.js";
import { postCostAlert } from "./webhook.js";

const VERSION = readPackageVersion();

export interface CliRunDeps extends RunInitDeps {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof globalThis.fetch;
  now?: Date;
  stderr?: NodeJS.WritableStream;
  stdout?: NodeJS.WritableStream;
}

interface SharedOptions {
  colorEnabled: boolean;
  cwd: string;
  env: NodeJS.ProcessEnv;
  fetch?: typeof globalThis.fetch;
  format: OutputFormat;
  now: Date;
  provider: ProviderSelector;
  stderr: NodeJS.WritableStream;
  stdout: NodeJS.WritableStream;
  timeoutMs?: number;
}

type CheckStatus = "ok" | "provider-failure" | "threshold-reached";
type AlertStatus =
  | "config-failure"
  | "provider-failure"
  | "threshold-reached"
  | "threshold-crossed"
  | "under-threshold"
  | "webhook-failure";

function readPackageVersion(): string {
  const packageJsonPath = resolve(fileURLToPath(new URL("../package.json", import.meta.url)));
  const json = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: string };
  return json.version || "0.0.0";
}

function parseArg(argv: string[], prefix: string): string | undefined {
  const match = argv.find((item) => item.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

function parseFormat(argv: string[]): OutputFormat {
  if (hasFlag(argv, "--json")) return "json";
  const value = parseArg(argv, "--format=");
  if (!value) return "table";
  if (value === "json" || value === "table") return value;
  throw new Error("--format must be table or json");
}

function parseProvider(argv: string[], env: NodeJS.ProcessEnv): ProviderSelector {
  const raw = parseArg(argv, "--provider=") || env.CAPPED_PROVIDER || "all";
  if (raw === "all" || raw === "openai" || raw === "anthropic") return raw;
  throw new Error("--provider must be openai, anthropic, or all");
}

function parsePositiveNumber(
  value: string | undefined,
  message: string
): number | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(message);
  }
  return parsed;
}

function parseThreshold(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("--threshold must be a positive number");
  }
  return parsed;
}

function parseThresholdList(value: string | undefined): number[] | undefined {
  if (!value) return undefined;
  const thresholds = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => Number(item));

  if (!thresholds.length || thresholds.some((item) => !Number.isFinite(item) || item <= 0)) {
    throw new Error("--thresholds must be a comma-separated list of positive numbers");
  }

  return thresholds;
}

function parseStrategy(value: string | undefined): ForecastStrategy {
  if (!value || value === "linear" || value === "rolling-7d" || value === "weighted-recent") {
    return (value as ForecastStrategy | undefined) || "linear";
  }
  throw new Error("--strategy must be linear, rolling-7d, or weighted-recent");
}

function writeLine(stream: NodeJS.WritableStream, value = ""): void {
  stream.write(`${value}\n`);
}

function writeJson(stream: NodeJS.WritableStream, value: unknown): void {
  writeLine(stream, JSON.stringify(value, null, 2));
}

function writeError(stream: NodeJS.WritableStream, message: string): void {
  writeLine(stream, `Error: ${message}`);
}

function printHelp(stdout: NodeJS.WritableStream): void {
  writeLine(
    stdout,
    `capped-cost ${VERSION} — tiny, dependency-free AI spend tracking for automation.

USAGE
  capped-cost [command] [options]

COMMANDS
  check             Explicit spend check (same as default command)
  alert             Fetch spend, evaluate thresholds with dedupe state, and notify only when needed
  breakdown         Spend by provider and model / line item
  forecast          Projected end-of-month spend
  init              Safe setup wizard (placeholder-only .env.example + optional local secrets file)

GLOBAL OPTIONS
  --format=table|json   Output format. Default: table
  --json                Alias for --format=json
  --no-color            Disable ANSI color
  --timeout-ms=<ms>     Abort provider calls after the given timeout
  --provider=<name>     openai | anthropic | all. Default: all
  -h, --help            Show this help
  -v, --version         Show version

CHECK OPTIONS
  --cap=<usd>           Monthly cap in USD
  --threshold=<ratio>   Threshold ratio for exit code 2. Default: 0.8
  --daily               Include daily breakdown in table output

ALERT OPTIONS
  --cap=<usd>               Monthly cap in USD (required)
  --webhook-url=<url>       Slack or Discord webhook URL (or use CAPPED_WEBHOOK_URL)
  --thresholds=<list>       Comma-separated ratios. Default: 0.8,1,1.5
  --threshold=<ratio>       Backward-compatible single-threshold alias
  --cooldown-ms=<ms>        Reminder cooldown while still above threshold
  --state-file=<path>       Alert state file. Default: .capped-cost.state.json
  --label=<label>           Optional label in webhook messages

FORECAST OPTIONS
  --cap=<usd>               Monthly cap in USD
  --strategy=<name>         linear | rolling-7d | weighted-recent

INIT OPTIONS
  --openai-key=<secret>     Non-interactive OpenAI admin key
  --anthropic-key=<secret>  Non-interactive Anthropic admin key
  --cap=<usd>               Non-interactive default cap
  --webhook-url=<url>       Non-interactive webhook URL
  --write-secrets-file      Write real secrets to a local-only file
  --secrets-file=<path>     Override the local secrets file path
  --skip-verify             Skip live provider validation
  --yes                     Disable prompts where possible

CONFIG PRECEDENCE
  Flags > process.env > .env.capped.local > .env.local > .env

ENVIRONMENT
  OPENAI_ADMIN_KEY
  ANTHROPIC_ADMIN_KEY
  CAPPED_PROVIDER
  CAPPED_CAP_USD
  CAPPED_CHECK_THRESHOLD
  CAPPED_FORECAST_STRATEGY
  CAPPED_WEBHOOK_URL
  CAPPED_ALERT_THRESHOLDS
  CAPPED_ALERT_COOLDOWN_MS
  CAPPED_COST_STATE_FILE
  CAPPED_TIMEOUT_MS

EXIT CODES
  check / forecast:
    0   Success / under threshold
    1   Config or provider failure
    2   Threshold reached / projected over cap

  alert:
    0   Success (under threshold or alert handled correctly)
    1   Configuration failure
    2   Provider failure
    3   Webhook delivery failure
`
  );
}

function createTimeoutSignal(timeoutMs: number | undefined) {
  if (!timeoutMs) {
    return {
      cleanup() {},
      signal: undefined as AbortSignal | undefined,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    cleanup() {
      clearTimeout(timer);
    },
    signal: controller.signal,
  };
}

function providerKeys(env: NodeJS.ProcessEnv, provider: ProviderSelector) {
  const keys = {
    openai: env.OPENAI_ADMIN_KEY,
    anthropic: env.ANTHROPIC_ADMIN_KEY,
  };

  if (provider === "openai") {
    return { anthropic: undefined, openai: keys.openai };
  }
  if (provider === "anthropic") {
    return { anthropic: keys.anthropic, openai: undefined };
  }
  return keys;
}

function ensureKeys(
  env: NodeJS.ProcessEnv,
  provider: ProviderSelector
): string | undefined {
  const keys = providerKeys(env, provider);
  if (provider === "all") {
    if (!keys.openai && !keys.anthropic) {
      return "Set OPENAI_ADMIN_KEY and/or ANTHROPIC_ADMIN_KEY, or run `capped-cost init`.";
    }
    return undefined;
  }

  const selected = provider === "openai" ? keys.openai : keys.anthropic;
  if (!selected) {
    return `Missing ${provider.toUpperCase()}_ADMIN_KEY for --provider=${provider}.`;
  }
  return undefined;
}

function renderProviderErrors(
  stderr: NodeJS.WritableStream,
  providers: Awaited<ReturnType<typeof fetchAllCosts>>["providers"]
): boolean {
  let hadError = false;
  for (const name of ["openai", "anthropic"] as const) {
    const result = providers[name];
    if (!result || !("error" in result)) continue;
    hadError = true;
    writeLine(stderr, `${name}: ERROR — ${result.error}`);
    for (const hint of result.hint || []) {
      writeLine(stderr, `  • ${hint}`);
    }
  }
  return hadError;
}

function readStateFile(path: string): AlertState | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as AlertState;
  } catch {
    return null;
  }
}

function writeStateFile(path: string, state: AlertState): void {
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

async function runCheck(argv: string[], shared: SharedOptions): Promise<number> {
  const capUsd = parsePositiveNumber(
    parseArg(argv, "--cap=") || shared.env.CAPPED_CAP_USD,
    "--cap must be a positive number"
  );
  const threshold =
    parseThreshold(parseArg(argv, "--threshold=")) ||
    parseThreshold(shared.env.CAPPED_CHECK_THRESHOLD) ||
    DEFAULT_CHECK_THRESHOLD;
  if (threshold <= 0 || threshold > 10) {
    throw new Error("--threshold must be greater than 0");
  }

  const missingKeys = ensureKeys(shared.env, shared.provider);
  if (missingKeys) {
    if (shared.format === "json") {
      writeJson(shared.stdout, {
        command: "check",
        message: missingKeys,
        ok: false,
        schemaVersion: JSON_SCHEMA_VERSION,
        status: "config-failure",
      });
    } else {
      writeError(shared.stderr, missingKeys);
    }
    return EXIT_CODES.config;
  }

  const timeout = createTimeoutSignal(shared.timeoutMs);
  const keys = providerKeys(shared.env, shared.provider);
  try {
    const combined = await fetchAllCosts(keys, {
      fetch: shared.fetch,
      signal: timeout.signal,
    });
    const totalUsd = combined.totalCents / 100;
    const pct = capUsd ? totalUsd / capUsd : undefined;
    const over = pct !== undefined && pct >= threshold;
    const hadError =
      Object.values(combined.providers).some((result) => result && "error" in result);
    const status: CheckStatus = hadError
      ? "provider-failure"
      : over
      ? "threshold-reached"
      : "ok";

    if (shared.format === "json") {
      const dailyUsd: Record<string, number> = {};
      for (const [day, cents] of sortedEntries(combined.dailyCents)) {
        dailyUsd[day] = cents / 100;
      }
      writeJson(shared.stdout, {
        capUsd: capUsd ?? null,
        command: "check",
        dailyUsd,
        ok: !hadError,
        provider: shared.provider,
        providers: Object.fromEntries(
          Object.entries(combined.providers).map(([name, result]) => {
            if (!result) return [name, null];
            if ("error" in result) return [name, { error: result.error, hint: result.hint || [] }];
            return [name, { totalUsd: result.totalCents / 100 }];
          })
        ),
        schemaVersion: JSON_SCHEMA_VERSION,
        status,
        thresholdRatio: threshold,
        totalUsd,
      });
    } else {
      renderProviderErrors(shared.stderr, combined.providers);
      writeLine(shared.stdout, `Month to date: ${formatUsd(totalUsd)}`);
      if (capUsd) {
        writeLine(
          shared.stdout,
          `Cap:           ${formatUsd(capUsd)} (${formatPct(totalUsd / capUsd)} used, threshold ${formatPct(threshold)})`
        );
      }
      writeLine(shared.stdout);
      for (const name of ["openai", "anthropic"] as const) {
        const result = combined.providers[name];
        if (!result || "error" in result) continue;
        writeLine(shared.stdout, `  ${name.padEnd(10)} ${formatUsdFromCents(result.totalCents)}`);
      }
      if (hasFlag(argv, "--daily")) {
        writeLine(shared.stdout);
        writeLine(shared.stdout, "Daily breakdown:");
        for (const [day, cents] of sortedEntries(combined.dailyCents)) {
          writeLine(shared.stdout, `  ${day}   ${formatUsdFromCents(cents)}`);
        }
      }
      if (over) {
        writeLine(shared.stderr);
        writeLine(shared.stderr, `Threshold reached: ${formatPct(threshold)} of cap.`);
      }
    }

    if (hadError) return EXIT_CODES.config;
    if (over) return EXIT_CODES.threshold;
    return EXIT_CODES.ok;
  } finally {
    timeout.cleanup();
  }
}

async function runBreakdown(argv: string[], shared: SharedOptions): Promise<number> {
  void argv;
  const missingKeys = ensureKeys(shared.env, shared.provider);
  if (missingKeys) {
    if (shared.format === "json") {
      writeJson(shared.stdout, {
        command: "breakdown",
        message: missingKeys,
        ok: false,
        schemaVersion: JSON_SCHEMA_VERSION,
        status: "config-failure",
      });
    } else {
      writeError(shared.stderr, missingKeys);
    }
    return EXIT_CODES.config;
  }

  const timeout = createTimeoutSignal(shared.timeoutMs);
  try {
    const combined = await fetchAllBreakdowns(providerKeys(shared.env, shared.provider), {
      fetch: shared.fetch,
      signal: timeout.signal,
    });
    const hadError =
      (combined.openai && "error" in combined.openai) ||
      (combined.anthropic && "error" in combined.anthropic);
    if (shared.format === "json") {
      const out: Record<string, unknown> = {
        command: "breakdown",
        ok: !hadError,
        provider: shared.provider,
        schemaVersion: JSON_SCHEMA_VERSION,
        status: hadError ? "provider-failure" : "ok",
        totalUsd: combined.totalCents / 100,
      };
      for (const name of ["openai", "anthropic"] as const) {
        const result = combined[name];
        if (!result) continue;
        if ("error" in result) {
          out[name] = { error: result.error, hint: result.hint || [] };
        } else {
          out[name] = {
            byLineItem: Object.fromEntries(
              Array.from(result.byLineItem.entries()).map(([key, cents]) => [key, cents / 100])
            ),
            totalUsd: result.totalCents / 100,
          };
        }
      }
      writeJson(shared.stdout, out);
      return hadError ? EXIT_CODES.config : EXIT_CODES.ok;
    }

    const total = combined.totalCents / 100;
    for (const name of ["openai", "anthropic"] as const) {
      const result = combined[name];
      if (!result) continue;
      if ("error" in result) {
        writeLine(shared.stderr, `${name}: ERROR — ${result.error}`);
        for (const hint of result.hint || []) {
          writeLine(shared.stderr, `  • ${hint}`);
        }
        continue;
      }
      const providerUsd = result.totalCents / 100;
      const providerPct = total > 0 ? providerUsd / total : 0;
      writeLine(
        shared.stdout,
        `${name.padEnd(10)} ${formatUsd(providerUsd).padStart(8)}  ${bar(providerPct)} ${formatPct(providerPct)}`
      );
      const entries = Array.from(result.byLineItem.entries()).sort((a, b) => b[1] - a[1]);
      for (const [line, cents] of entries) {
        writeLine(shared.stdout, `  ${line.padEnd(26)} ${formatUsdFromCents(cents)}`);
      }
      writeLine(shared.stdout);
    }
    writeLine(shared.stdout, `total      ${formatUsd(total)}`);
    return hadError ? EXIT_CODES.config : EXIT_CODES.ok;
  } finally {
    timeout.cleanup();
  }
}

async function runForecast(argv: string[], shared: SharedOptions): Promise<number> {
  const capUsd = parsePositiveNumber(
    parseArg(argv, "--cap=") || shared.env.CAPPED_CAP_USD,
    "--cap must be a positive number"
  );
  const strategy = parseStrategy(parseArg(argv, "--strategy=") || shared.env.CAPPED_FORECAST_STRATEGY);
  const missingKeys = ensureKeys(shared.env, shared.provider);
  if (missingKeys) {
    if (shared.format === "json") {
      writeJson(shared.stdout, {
        command: "forecast",
        message: missingKeys,
        ok: false,
        schemaVersion: JSON_SCHEMA_VERSION,
        status: "config-failure",
      });
    } else {
      writeError(shared.stderr, missingKeys);
    }
    return EXIT_CODES.config;
  }

  const timeout = createTimeoutSignal(shared.timeoutMs);
  try {
    const combined = await fetchAllCosts(providerKeys(shared.env, shared.provider), {
      fetch: shared.fetch,
      signal: timeout.signal,
    });
    const hadError =
      Object.values(combined.providers).some((result) => result && "error" in result);
    const result = forecast({
      capUsd,
      dailyCents: combined.dailyCents,
      now: shared.now,
      strategy,
      totalCents: combined.totalCents,
    });

    if (shared.format === "json") {
      writeJson(shared.stdout, {
        command: "forecast",
        ok: !hadError,
        provider: shared.provider,
        result,
        schemaVersion: JSON_SCHEMA_VERSION,
        status: hadError ? "provider-failure" : result.status,
      });
    } else {
      renderProviderErrors(shared.stderr, combined.providers);
      writeLine(shared.stdout, `Day ${result.dayOfMonth} of ${result.daysInMonth}`);
      writeLine(shared.stdout, `Month-to-date: ${formatUsd(result.totalUsd)}`);
      writeLine(shared.stdout, `Modeled daily rate: ${formatUsd(result.dailyAvgUsd)}`);
      writeLine(shared.stdout, `Projected EOM: ${formatUsd(result.projectedEomUsd)}`);
      writeLine(shared.stdout, `Strategy:       ${result.strategy}`);
      writeLine(shared.stdout, `Window:         ${result.observationWindowDays} day(s)`);
      writeLine(shared.stdout, `Note:           ${result.confidenceNote}`);
      if (capUsd !== undefined) {
        writeLine(shared.stdout, `Cap:            ${formatUsd(capUsd)} (${formatPct(result.projectedPctOfCap || 0)} projected)`);
        writeLine(shared.stdout);
        if (result.status === "over") {
          writeLine(shared.stderr, `Projected to exceed cap by ${formatUsd(result.overCapUsd || 0)}.`);
        } else if (result.status === "on-pace") {
          writeLine(shared.stdout, "Close to cap — monitor the next few days.");
        } else {
          writeLine(shared.stdout, "Comfortably under cap.");
        }
      }
    }

    if (hadError) return EXIT_CODES.config;
    if (result.status === "over") return EXIT_CODES.threshold;
    return EXIT_CODES.ok;
  } finally {
    timeout.cleanup();
  }
}

async function runAlert(argv: string[], shared: SharedOptions): Promise<number> {
  const capUsd = parsePositiveNumber(
    parseArg(argv, "--cap=") || shared.env.CAPPED_CAP_USD,
    "--cap must be a positive number"
  );
  if (!capUsd) {
    const message = "--cap is required for `capped-cost alert`.";
    if (shared.format === "json") {
      writeJson(shared.stdout, {
        command: "alert",
        message,
        ok: false,
        schemaVersion: JSON_SCHEMA_VERSION,
        status: "config-failure",
      });
    } else {
      writeError(shared.stderr, message);
    }
    return EXIT_CODES.config;
  }

  const thresholds =
    parseThresholdList(parseArg(argv, "--thresholds=") || shared.env.CAPPED_ALERT_THRESHOLDS) ||
    (parseThreshold(parseArg(argv, "--threshold=")) ? [parseThreshold(parseArg(argv, "--threshold="))!] : undefined) ||
    Array.from(DEFAULT_ALERT_THRESHOLDS);
  const cooldownMs =
    parsePositiveNumber(
      parseArg(argv, "--cooldown-ms=") || shared.env.CAPPED_ALERT_COOLDOWN_MS,
      "--cooldown-ms must be a positive number"
    ) || DEFAULT_ALERT_COOLDOWN_MS;
  const webhookUrl = parseArg(argv, "--webhook-url=") || shared.env.CAPPED_WEBHOOK_URL;
  const stateFile = parseArg(argv, "--state-file=") || shared.env.CAPPED_COST_STATE_FILE || DEFAULT_STATE_FILE;
  const label = parseArg(argv, "--label=");

  if (!webhookUrl) {
    const message = "Set CAPPED_WEBHOOK_URL or pass --webhook-url for `capped-cost alert`.";
    if (shared.format === "json") {
      writeJson(shared.stdout, {
        command: "alert",
        message,
        ok: false,
        schemaVersion: JSON_SCHEMA_VERSION,
        status: "config-failure",
      });
    } else {
      writeError(shared.stderr, message);
    }
    return EXIT_CODES.config;
  }

  const missingKeys = ensureKeys(shared.env, shared.provider);
  if (missingKeys) {
    if (shared.format === "json") {
      writeJson(shared.stdout, {
        command: "alert",
        message: missingKeys,
        ok: false,
        schemaVersion: JSON_SCHEMA_VERSION,
        status: "config-failure",
      });
    } else {
      writeError(shared.stderr, missingKeys);
    }
    return EXIT_CODES.config;
  }

  const timeout = createTimeoutSignal(shared.timeoutMs);
  const previousState = readStateFile(resolve(shared.cwd, stateFile));
  try {
    const combined = await fetchAllCosts(providerKeys(shared.env, shared.provider), {
      fetch: shared.fetch,
      signal: timeout.signal,
    });

    const providerErrors: Record<string, string> = {};
    for (const [name, result] of Object.entries(combined.providers)) {
      if (!result || !("error" in result)) continue;
      providerErrors[name] = result.error;
    }
    if (Object.keys(providerErrors).length > 0) {
      if (shared.format === "json") {
        writeJson(shared.stdout, {
          command: "alert",
          errors: providerErrors,
          ok: false,
          provider: shared.provider,
          schemaVersion: JSON_SCHEMA_VERSION,
          status: "provider-failure",
        });
      } else {
        for (const [name, error] of Object.entries(providerErrors)) {
          writeLine(shared.stderr, `${name}: ERROR — ${error}`);
        }
      }
      return EXIT_CODES.provider;
    }

    const evaluation = evaluateAlert({
      capUsd,
      cooldownMs,
      now: shared.now,
      previousState,
      thresholds,
      totalCents: combined.totalCents,
    });

    let status: AlertStatus = evaluation.status;
    let alertSent = false;
    let webhookError: string | undefined;

    if (evaluation.shouldAlert) {
      const webhookResult = await postCostAlert(
        { fetch: shared.fetch, url: webhookUrl },
        {
          capUsd,
          label,
          reason: evaluation.triggerReason,
          status:
            evaluation.status === "threshold-crossed"
              ? "threshold-crossed"
              : "threshold-reached",
          threshold: evaluation.threshold || thresholds[0],
          totalUsd: evaluation.totalUsd,
        }
      );
      if (!webhookResult.ok) {
        status = "webhook-failure";
        webhookError = webhookResult.error;
      } else {
        alertSent = true;
        writeStateFile(resolve(shared.cwd, stateFile), evaluation.state);
      }
    } else {
      writeStateFile(resolve(shared.cwd, stateFile), evaluation.state);
    }

    const json = {
      alertSent,
      capUsd,
      command: "alert",
      cooldownMs,
      ok: status !== "webhook-failure",
      pctUsed: evaluation.pctUsed,
      provider: shared.provider,
      schemaVersion: JSON_SCHEMA_VERSION,
      stateFile,
      status,
      threshold: evaluation.threshold ?? null,
      thresholds,
      totalUsd: evaluation.totalUsd,
      triggerReason: evaluation.triggerReason ?? null,
      webhookError: webhookError ?? null,
    };

    if (shared.format === "json") {
      writeJson(shared.stdout, json);
    } else {
      writeLine(shared.stdout, `Status:         ${status}`);
      writeLine(shared.stdout, `Month-to-date:  ${formatUsd(evaluation.totalUsd)}`);
      writeLine(shared.stdout, `Cap:            ${formatUsd(capUsd)} (${formatPct(evaluation.pctUsed)} used)`);
      writeLine(shared.stdout, `Thresholds:     ${thresholds.map((value) => formatThresholdLabel(value)).join(", ")}`);
      writeLine(shared.stdout, `State file:     ${stateFile}`);
      if (evaluation.threshold !== undefined) {
        writeLine(shared.stdout, `Active level:   ${formatThresholdLabel(evaluation.threshold)}`);
      }
      if (evaluation.triggerReason) {
        writeLine(shared.stdout, `Trigger:        ${evaluation.triggerReason}`);
      }
      if (status === "webhook-failure" && webhookError) {
        writeLine(shared.stderr, `Webhook failed: ${webhookError}`);
      } else if (alertSent) {
        writeLine(shared.stdout, "Webhook sent.");
      } else if (status === "threshold-reached") {
        writeLine(shared.stdout, "Above threshold, but still inside cooldown. No webhook sent.");
      } else if (status === "under-threshold") {
        writeLine(shared.stdout, "Under threshold. No webhook sent.");
      }
    }

    if (status === "webhook-failure") return EXIT_CODES.webhook;
    return EXIT_CODES.ok;
  } finally {
    timeout.cleanup();
  }
}

function directInvocation(): boolean {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

export async function runCli(argv: string[], deps: CliRunDeps = {}): Promise<number> {
  if (deps.env === undefined) {
    loadLocalEnv(deps.cwd ?? process.cwd());
  }

  const shared: SharedOptions = {
    colorEnabled: deps.colorEnabled ?? !hasFlag(argv, "--no-color"),
    cwd: deps.cwd ?? process.cwd(),
    env: deps.env ?? process.env,
    fetch: deps.fetch,
    format: parseFormat(argv),
    now: deps.now ?? new Date(),
    provider: parseProvider(argv, deps.env ?? process.env),
    stderr: deps.stderr ?? process.stderr,
    stdout: deps.stdout ?? process.stdout,
    timeoutMs: parsePositiveNumber(parseArg(argv, "--timeout-ms=") || (deps.env ?? process.env).CAPPED_TIMEOUT_MS, "--timeout-ms must be a positive number"),
  };

  if (hasFlag(argv, "--help") || hasFlag(argv, "-h") || argv[0] === "help") {
    printHelp(shared.stdout);
    return 0;
  }
  if (hasFlag(argv, "--version") || hasFlag(argv, "-v")) {
    writeLine(shared.stdout, VERSION);
    return 0;
  }

  const command = argv[0];
  if (command === "init") {
    return runInit(argv.slice(1), {
      colorEnabled: shared.colorEnabled,
      cwd: shared.cwd,
      fetchAnthropic: deps.fetch
        ? (key, options) => fetchAnthropicCost(key, { ...options, fetch: deps.fetch })
        : deps.fetchAnthropic,
      fetchOpenAI: deps.fetch
        ? (key, options) => fetchOpenAICost(key, { ...options, fetch: deps.fetch })
        : deps.fetchOpenAI,
      prompter: deps.prompter,
      stderr: shared.stderr,
      stdout: shared.stdout,
    });
  }

  if (command === "alert" || (command === "check" && hasFlag(argv.slice(1), "--alert"))) {
    return runAlert(command === "alert" ? argv.slice(1) : argv.slice(1).filter((item) => item !== "--alert"), shared);
  }
  if (command === "check") {
    return runCheck(argv.slice(1), shared);
  }
  if (command === "breakdown") {
    return runBreakdown(argv.slice(1), shared);
  }
  if (command === "forecast") {
    return runForecast(argv.slice(1), shared);
  }

  return runCheck(argv, shared);
}

async function main() {
  try {
    const exitCode = await runCli(process.argv.slice(2));
    process.exit(exitCode);
  } catch (error) {
    writeError(process.stderr, error instanceof Error ? error.message : String(error));
    process.exit(EXIT_CODES.internal);
  }
}

if (directInvocation()) {
  void main();
}
