import type { CostResult, CostError, FetchOptions } from "./types.js";
import { startOfMonthUnix, dayKeyFromUnix } from "./time.js";

const OPENAI_COSTS_URL = "https://api.openai.com/v1/organization/costs";

interface OpenAIBucket {
  start_time: number;
  results?: Array<{
    amount?: { value?: number; currency?: string };
  }>;
}

interface OpenAICostResponse {
  data?: OpenAIBucket[];
}

/**
 * Fetch the current-month cost for an OpenAI organization.
 *
 * Requires an Organization Admin Key (distinct from a standard API key).
 * Create one at https://platform.openai.com/settings/organization/admin-keys
 * — it can only read usage, never make model calls or spend money.
 *
 * @param adminKey  OpenAI Organization Admin Key (sk-admin-...)
 * @param options   Optional custom fetch + abort signal
 * @returns         { dailyCents, totalCents } on success; { error } on failure
 */
export async function fetchOpenAICost(
  adminKey: string,
  options: FetchOptions = {}
): Promise<CostResult | CostError> {
  const { fetch: fetchImpl = globalThis.fetch, signal } = options;

  if (!adminKey) return { error: "OpenAI admin key is required" };
  if (!fetchImpl) return { error: "fetch implementation is not available" };

  const url = `${OPENAI_COSTS_URL}?start_time=${startOfMonthUnix()}&bucket_width=1d&limit=31`;

  try {
    const res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${adminKey}` },
      signal,
    });

    if (!res.ok) {
      const body = await res.text();
      return {
        error: `OpenAI ${res.status}: ${body.slice(0, 200)}`,
      };
    }

    const json = (await res.json()) as OpenAICostResponse;
    const dailyCents = new Map<string, number>();
    let totalCents = 0;

    for (const bucket of json.data || []) {
      const day = dayKeyFromUnix(bucket.start_time);
      let sum = 0;
      for (const r of bucket.results || []) {
        const v = r?.amount?.value;
        if (typeof v === "number") {
          sum += Math.round(v * 100);
        }
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
