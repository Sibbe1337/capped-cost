/**
 * Slack + Discord webhook helpers. Zero dependencies.
 *
 * `checkAndAlert` now uses threshold evaluation + optional dedupe state so
 * callers can keep alert semantics separate from provider/config failures.
 */

import { evaluateAlert, type AlertState, type AlertTriggerReason } from "./alert.js";
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
  /** Fraction of cap that triggered. */
  threshold: number;
  /** Optional label (e.g. "production", "my-side-project"). */
  label?: string;
  /** Why this alert fired. */
  reason?: AlertTriggerReason;
  /** Whether this was a fresh crossing or a cooldown reminder. */
  status?: "threshold-crossed" | "threshold-reached";
}

/**
 * Format the human-readable message sent to Slack/Discord.
 * Exported so you can re-use it in custom alerting paths.
 */
export function formatAlertMessage(a: AlertPayload): string {
  const pct = Math.round((a.totalUsd / a.capUsd) * 100);
  const thresholdPct = Math.round(a.threshold * 100);
  const icon =
    pct >= 100
      ? ":rotating_light:"
      : pct >= thresholdPct
      ? ":warning:"
      : ":chart_with_upwards_trend:";
  const lbl = a.label ? ` (${a.label})` : "";
  const reason =
    a.status === "threshold-crossed"
      ? `Crossed ${thresholdPct}%`
      : a.reason === "cooldown"
      ? `Still above ${thresholdPct}% after cooldown`
      : `Threshold: ${thresholdPct}%`;
  return (
    `${icon} AI spend alert${lbl}\n` +
    `Month-to-date: $${a.totalUsd.toFixed(2)} / $${a.capUsd.toFixed(2)} cap — ${pct}% used\n` +
    `${reason}`
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
  capUsd: number;
  /** Defaults to 0.8 for backward compatibility. */
  threshold?: number;
  /** Preferred multi-threshold form for deduped alerting. */
  thresholds?: number[];
  /** Optional cooldown before a repeated in-threshold reminder fires again. */
  cooldownMs?: number;
  fetch?: typeof globalThis.fetch;
  keys: AllKeys;
  /** Optional label sent in the alert (e.g. project name). */
  label?: string;
  now?: Date;
  signal?: AbortSignal;
  state?: AlertState | null;
  /** Slack or Discord webhook URL. */
  webhookUrl: string;
}

export interface CheckAndAlertResult {
  alerted: boolean;
  capUsd: number;
  fetchErrors: Record<string, string>;
  nextState?: AlertState;
  pct: number;
  status:
    | "under-threshold"
    | "threshold-reached"
    | "threshold-crossed"
    | "provider-failure"
    | "webhook-failure";
  threshold?: number;
  totalUsd: number;
  triggerReason?: AlertTriggerReason;
  webhookResult?: { ok: boolean; status?: number; error?: string };
}

/**
 * One-shot: fetch current spend from all supplied providers, compute total
 * vs cap, and if over threshold, post to the webhook. Returns a structured
 * result so you can log, persist state, or chain further logic.
 */
export async function checkAndAlert(
  options: CheckAndAlertOptions
): Promise<CheckAndAlertResult> {
  const {
    keys,
    capUsd,
    threshold = 0.8,
    thresholds,
    cooldownMs,
    webhookUrl,
    label,
    fetch: fetchImpl,
    now,
    signal,
    state,
  } = options;

  const fetchOpts: FetchOptions = { fetch: fetchImpl, signal };
  const combined = await fetchAllCosts(keys, fetchOpts);
  const totalUsd = combined.totalCents / 100;
  const pct = totalUsd / capUsd;

  const fetchErrors: Record<string, string> = {};
  for (const [name, result] of Object.entries(combined.providers)) {
    if (!result || !("error" in result)) continue;
    fetchErrors[name] = result.error;
  }
  if (Object.keys(fetchErrors).length > 0) {
    return {
      alerted: false,
      capUsd,
      fetchErrors,
      pct,
      status: "provider-failure",
      totalUsd,
    };
  }

  const evaluation = evaluateAlert({
    capUsd,
    cooldownMs,
    now,
    previousState: state,
    thresholds: thresholds && thresholds.length > 0 ? thresholds : [threshold],
    totalCents: combined.totalCents,
  });

  if (!evaluation.shouldAlert) {
    return {
      alerted: false,
      capUsd,
      fetchErrors,
      nextState: evaluation.state,
      pct,
      status: evaluation.status,
      threshold: evaluation.threshold,
      totalUsd,
    };
  }

  const webhookResult = await postCostAlert(
    { url: webhookUrl, fetch: fetchImpl },
    {
      capUsd,
      label,
      reason: evaluation.triggerReason,
      status:
        evaluation.status === "threshold-crossed"
          ? "threshold-crossed"
          : "threshold-reached",
      threshold: evaluation.threshold || threshold,
      totalUsd,
    }
  );

  if (!webhookResult.ok) {
    return {
      alerted: false,
      capUsd,
      fetchErrors,
      nextState: state ?? undefined,
      pct,
      status: "webhook-failure",
      threshold: evaluation.threshold,
      totalUsd,
      triggerReason: evaluation.triggerReason,
      webhookResult,
    };
  }

  return {
    alerted: true,
    capUsd,
    fetchErrors,
    nextState: evaluation.state,
    pct,
    status: evaluation.status,
    threshold: evaluation.threshold,
    totalUsd,
    triggerReason: evaluation.triggerReason,
    webhookResult,
  };
}
