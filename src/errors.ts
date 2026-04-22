/**
 * Human-readable guidance for the most common provider errors.
 * The raw provider message is kept alongside so users can still search it.
 */

export interface ExplainedError {
  error: string;
  /** The original HTTP status from the provider. */
  status?: number;
  /** Bullet-pointed likely causes + fixes. Populated for known error codes. */
  hint?: string[];
}

export function explainOpenAIError(
  status: number,
  rawBody: string
): ExplainedError {
  const snippet = rawBody.slice(0, 200);

  if (status === 401) {
    return {
      status,
      error: `OpenAI 401: ${snippet}`,
      hint: [
        "You're likely using a regular API key (sk-...) instead of an Organization Admin Key (sk-admin-...).",
        "Admin keys are created at https://platform.openai.com/settings/organization/admin-keys and require Organization Owner role.",
        "If you already have an admin key, check it hasn't been revoked or expired.",
      ],
    };
  }

  if (status === 403) {
    return {
      status,
      error: `OpenAI 403: ${snippet}`,
      hint: [
        "Your key is valid but lacks permission to read organization costs.",
        "Admin keys must be scoped to the organization, not to a specific project.",
        "Create a new key at https://platform.openai.com/settings/organization/admin-keys with Organization Owner role.",
      ],
    };
  }

  if (status === 429) {
    return {
      status,
      error: `OpenAI 429: ${snippet}`,
      hint: [
        "Rate limit exceeded. The costs endpoint has a low request ceiling.",
        "If you're polling, reduce frequency to hourly or less.",
      ],
    };
  }

  if (status >= 500 && status < 600) {
    return {
      status,
      error: `OpenAI ${status}: ${snippet}`,
      hint: [
        "OpenAI is having trouble. Check https://status.openai.com.",
        "Retry with backoff. This is transient.",
      ],
    };
  }

  return { status, error: `OpenAI ${status}: ${snippet}` };
}

export function explainAnthropicError(
  status: number,
  rawBody: string
): ExplainedError {
  const snippet = rawBody.slice(0, 200);

  if (status === 401) {
    return {
      status,
      error: `Anthropic 401: ${snippet}`,
      hint: [
        "You're likely using a regular API key instead of an Organization Admin Key.",
        "Admin keys are created at https://console.anthropic.com/settings/admin-keys.",
        "If you already have an admin key, check it hasn't been revoked or expired.",
      ],
    };
  }

  if (status === 403) {
    return {
      status,
      error: `Anthropic 403: ${snippet}`,
      hint: [
        "Your key is valid but lacks permission to read organization costs.",
        "The admin key must belong to an organization that has billing enabled.",
      ],
    };
  }

  if (status === 429) {
    return {
      status,
      error: `Anthropic 429: ${snippet}`,
      hint: [
        "Rate limit exceeded on the cost-report endpoint.",
        "If you're polling, reduce frequency to hourly or less.",
      ],
    };
  }

  if (status >= 500 && status < 600) {
    return {
      status,
      error: `Anthropic ${status}: ${snippet}`,
      hint: [
        "Anthropic is having trouble. Check https://status.anthropic.com.",
        "Retry with backoff. This is transient.",
      ],
    };
  }

  return { status, error: `Anthropic ${status}: ${snippet}` };
}

export function formatErrorForTerminal(e: ExplainedError): string {
  const lines: string[] = [e.error];
  if (e.hint && e.hint.length > 0) {
    lines.push("");
    lines.push("Likely causes:");
    for (const h of e.hint) {
      lines.push(`  • ${h}`);
    }
  }
  return lines.join("\n");
}
