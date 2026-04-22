/**
 * Per-model spend breakdown. Uses group_by parameters on the provider
 * cost APIs to retrieve line-item totals grouped by model.
 */

import type { FetchOptions } from "./types.js";
import { startOfMonthUnix, startOfMonthIso } from "./time.js";
import { explainOpenAIError, explainAnthropicError } from "./errors.js";

const OPENAI_COSTS_URL = "https://api.openai.com/v1/organization/costs";
const ANTHROPIC_COSTS_URL =
  "https://api.anthropic.com/v1/organizations/cost_report";

export interface BreakdownResult {
  /** Per-line-item cents (e.g. "gpt-4o-2024-08-06" => 12400). */
  byLineItem: Map<string, number>;
  /** Grand total in cents. */
  totalCents: number;
}

export interface BreakdownError {
  error: string;
  hint?: string[];
}

export type BreakdownOutcome = BreakdownResult | BreakdownError;

interface OpenAIResultRow {
  amount?: { value?: number };
  line_item?: string;
}

interface AnthropicResultRow {
  amount?: string;
  model?: string;
}

/**
 * OpenAI spend grouped by line_item (typically model name or product).
 * The OpenAI costs endpoint supports `group_by=line_item` which returns
 * cost per SKU in each time bucket. We aggregate across all buckets.
 */
export async function fetchOpenAICostBreakdown(
  adminKey: string,
  options: FetchOptions = {}
): Promise<BreakdownOutcome> {
  const { fetch: fetchImpl = globalThis.fetch, signal } = options;
  if (!adminKey) return { error: "OpenAI admin key is required" };
  if (!fetchImpl) return { error: "fetch implementation is not available" };

  const url = `${OPENAI_COSTS_URL}?start_time=${startOfMonthUnix()}&bucket_width=1d&group_by=line_item&limit=31`;

  try {
    const res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${adminKey}` },
      signal,
    });
    if (!res.ok) {
      const body = await res.text();
      const explained = explainOpenAIError(res.status, body);
      return { error: explained.error, hint: explained.hint };
    }

    const json = (await res.json()) as { data?: Array<{ results?: OpenAIResultRow[] }> };
    const byLineItem = new Map<string, number>();
    let totalCents = 0;

    for (const bucket of json.data || []) {
      for (const r of bucket.results || []) {
        const line = r.line_item || "unspecified";
        const v = r.amount?.value;
        if (typeof v !== "number") continue;
        const cents = Math.round(v * 100);
        byLineItem.set(line, (byLineItem.get(line) || 0) + cents);
        totalCents += cents;
      }
    }
    return { byLineItem, totalCents };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Anthropic spend grouped by model. The cost-report endpoint supports
 * `group_by[]=model` (repeated query param). We aggregate across buckets.
 */
export async function fetchAnthropicCostBreakdown(
  adminKey: string,
  options: FetchOptions = {}
): Promise<BreakdownOutcome> {
  const { fetch: fetchImpl = globalThis.fetch, signal } = options;
  if (!adminKey) return { error: "Anthropic admin key is required" };
  if (!fetchImpl) return { error: "fetch implementation is not available" };

  const url = `${ANTHROPIC_COSTS_URL}?starting_at=${encodeURIComponent(
    startOfMonthIso()
  )}&bucket_width=1d&group_by[]=model`;

  try {
    const res = await fetchImpl(url, {
      headers: {
        "x-api-key": adminKey,
        "anthropic-version": "2023-06-01",
      },
      signal,
    });
    if (!res.ok) {
      const body = await res.text();
      const explained = explainAnthropicError(res.status, body);
      return { error: explained.error, hint: explained.hint };
    }

    const json = (await res.json()) as { data?: Array<{ results?: AnthropicResultRow[] }> };
    const byLineItem = new Map<string, number>();
    let totalCents = 0;

    for (const bucket of json.data || []) {
      for (const r of bucket.results || []) {
        const line = r.model || "unspecified";
        const v = parseFloat(r.amount || "0");
        if (!Number.isFinite(v)) continue;
        const cents = Math.round(v);
        byLineItem.set(line, (byLineItem.get(line) || 0) + cents);
        totalCents += cents;
      }
    }
    return { byLineItem, totalCents };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export interface CombinedBreakdown {
  openai?: BreakdownOutcome;
  anthropic?: BreakdownOutcome;
  /** Grand total across all providers that succeeded, in cents. */
  totalCents: number;
}

/**
 * Fetch per-model breakdowns from both providers in parallel.
 */
export async function fetchAllBreakdowns(
  keys: { openai?: string; anthropic?: string },
  options: FetchOptions = {}
): Promise<CombinedBreakdown> {
  const tasks: Array<Promise<void>> = [];
  const result: CombinedBreakdown = { totalCents: 0 };

  if (keys.openai) {
    tasks.push(
      fetchOpenAICostBreakdown(keys.openai, options).then((r) => {
        result.openai = r;
        if (!("error" in r)) result.totalCents += r.totalCents;
      })
    );
  }
  if (keys.anthropic) {
    tasks.push(
      fetchAnthropicCostBreakdown(keys.anthropic, options).then((r) => {
        result.anthropic = r;
        if (!("error" in r)) result.totalCents += r.totalCents;
      })
    );
  }

  await Promise.all(tasks);
  return result;
}
