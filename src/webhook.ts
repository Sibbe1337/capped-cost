/**
 * Slack + Discord webhook helpers. Zero dependencies.
 *
 * The common pattern is: (a) run a scheduled cost check, (b) if spend is
 * above threshold, fire a webhook to alert the team. `checkAndAlert`
 * composes both steps so you can wire it up in a single cron line.
 */

import { fetchAllCosts, type AllKeys } from "./combined.js";
import type { FetchOptions } from "./types.js";

export interface WebhookTarget {
  /** Slack or Discord incoming webhook URL. Provider auto-detected. */
  url: string;
  /** Custom fetch implementation (optional; defaults to globalThis.fetch). */
  fetch?: typeof globalThis.fetch;
}

export interface AlertPayload {
  /** Current month-to-date spend in USD. */
  totalUsd: number;
  /** User-set monthly cap in USD. */
  capUsd: number;
  /** Fraction of cap that triggers (e.g. 0.8 = 80%). */
  threshold: number;
  /** Optional label (e.g. "production", "my-side-project"). */
  label?: string;
}

/**
 * Format the human-readable message sent to Slack/Discord.
 * Exported so you can re-use it in custom alerting paths.
 */
export function formatAlertMessage(a: AlertPayload): string {
  const pct = Math.round((a.totalUsd / a.capUsd) * 100);
  const thresholdPct = Math.round(a.threshold * 100);
  const icon =
    pct >= 100 ? ":rotating_light:" : pct >= thresholdPct ? ":warning:" : ":chart_with_upwards_trend:";
  const lbl = a.label ? ` (${a.label})` : "";
  return (
    `${icon} AI spend alert${lbl}\n` +
    `Month-to-date: $${a.totalUsd.toFixed(2)} / $${a.capUsd.toFixed(2)} cap — ${pct}% used\n` +
    `Threshold: ${thresholdPct}%`
  );
}

function detectProvider(url: string): "slack" | "discord" | "generic" {
  if (url.includes("hooks.slack.com")) return "slack";
  if (url.includes("discord.com/api/webhooks")) return "discord";
  if (url.includes("discordapp.com/api/webhooks")) return "discord";
  return "generic";
}

/**
 * Post an alert to a Slack or Discord webhook. Auto-detects provider from
 * the URL shape and formats the payload accordingly.
 */
export async function postCostAlert(
  target: WebhookTarget,
  payload: AlertPayload
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const { url, fetch: fetchImpl = globalThis.fetch } = target;
  if (!url) return { ok: false, error: "webhook url is required" };
  if (!fetchImpl) return { ok: false, error: "fetch is not available" };

  const text = formatAlertMessage(payload);
  const provider = detectProvider(url);

  // Slack uses `text`, Discord uses `content`. Generic gets both to
  // maximize compatibility with arbitrary webhook receivers.
  const body =
    provider === "slack"
      ? { text }
      : provider === "discord"
      ? { content: text }
      : { text, content: text };

  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      return {
        ok: false,
        status: res.status,
        error: `${res.status}: ${errBody.slice(0, 200)}`,
      };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface CheckAndAlertOptions {
  keys: AllKeys;
  capUsd: number;
  /** Defaults to 0.8 (alert at 80% of cap). */
  threshold?: number;
  /** Slack or Discord webhook URL. */
  webhookUrl: string;
  /** Optional label sent in the alert (e.g. project name). */
  label?: string;
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
}

export interface CheckAndAlertResult {
  totalUsd: number;
  capUsd: number;
  pct: number;
  alerted: boolean;
  webhookResult?: { ok: boolean; status?: number; error?: string };
  fetchErrors: Record<string, string>;
}

/**
 * One-shot: fetch current spend from all supplied providers, compute total
 * vs cap, and if over threshold, post to the webhook. Returns a structured
 * result so you can log, exit non-zero, or chain further logic.
 *
 * @example
 *   import { checkAndAlert } from "capped-cost/webhook";
 *
 *   const r = await checkAndAlert({
 *     keys: {
 *       openai: process.env.OPENAI_ADMIN_KEY,
 *       anthropic: process.env.ANTHROPIC_ADMIN_KEY,
 *     },
 *     capUsd: 100,
 *     threshold: 0.8,
 *     webhookUrl: process.env.SLACK_WEBHOOK_URL!,
 *   });
 *
 *   if (r.alerted && !r.webhookResult?.ok) process.exit(1);
 */
export async function checkAndAlert(
  options: CheckAndAlertOptions
): Promise<CheckAndAlertResult> {
  const {
    keys,
    capUsd,
    threshold = 0.8,
    webhookUrl,
    label,
    fetch: fetchImpl,
    signal,
  } = options;

  const fetchOpts: FetchOptions = { fetch: fetchImpl, signal };
  const combined = await fetchAllCosts(keys, fetchOpts);
  const totalUsd = combined.totalCents / 100;
  const pct = totalUsd / capUsd;

  const fetchErrors: Record<string, string> = {};
  for (const [name, r] of Object.entries(combined.providers)) {
    if (!r) continue;
    if ((r as { error?: string }).error) {
      fetchErrors[name] = (r as { error: string }).error;
    }
  }

  if (pct < threshold) {
    return {
      totalUsd,
      capUsd,
      pct,
      alerted: false,
      fetchErrors,
    };
  }

  const webhookResult = await postCostAlert(
    { url: webhookUrl, fetch: fetchImpl },
    { totalUsd, capUsd, threshold, label }
  );

  return {
    totalUsd,
    capUsd,
    pct,
    alerted: true,
    webhookResult,
    fetchErrors,
  };
}
