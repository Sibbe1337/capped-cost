import type { CostResult, CostError, FetchOptions } from "./types.js";
import { startOfMonthIso, dayKeyFromIso } from "./time.js";
import { explainAnthropicError } from "./errors.js";

const ANTHROPIC_COSTS_URL =
  "https://api.anthropic.com/v1/organizations/cost_report";

interface AnthropicBucket {
  starting_at: string;
  results?: Array<{
    amount?: string;
  }>;
}

interface AnthropicCostResponse {
  data?: AnthropicBucket[];
}

/**
 * Fetch the current-month cost for an Anthropic organization.
 *
 * Requires an Organization Admin Key (distinct from a standard API key).
 * Create one at https://console.anthropic.com/settings/admin-keys — it can
 * only read usage, never make model calls or spend money.
 *
 * @param adminKey  Anthropic Organization Admin Key
 * @param options   Optional custom fetch + abort signal
 * @returns         { dailyCents, totalCents } on success; { error } on failure
 */
export async function fetchAnthropicCost(
  adminKey: string,
  options: FetchOptions = {}
): Promise<CostResult | CostError> {
  const { fetch: fetchImpl = globalThis.fetch, signal } = options;

  if (!adminKey) return { error: "Anthropic admin key is required" };
  if (!fetchImpl) return { error: "fetch implementation is not available" };

  const url = `${ANTHROPIC_COSTS_URL}?starting_at=${encodeURIComponent(
    startOfMonthIso()
  )}&bucket_width=1d`;

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

    const json = (await res.json()) as AnthropicCostResponse;
    const dailyCents = new Map<string, number>();
    let totalCents = 0;

    for (const bucket of json.data || []) {
      const day = dayKeyFromIso(bucket.starting_at);
      let sum = 0;
      for (const r of bucket.results || []) {
        // Anthropic returns amount as a decimal string in cents.
        const v = parseFloat(r.amount || "0");
        if (!Number.isNaN(v)) sum += Math.round(v);
      }
      dailyCents.set(day, (dailyCents.get(day) || 0) + sum);
      totalCents += sum;
    }

    return { dailyCents, totalCents };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
