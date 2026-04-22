import { describe, it, expect } from "vitest";
import { formatAlertMessage, postCostAlert } from "../src/webhook.js";

describe("formatAlertMessage", () => {
  it("formats a warning at 80% threshold", () => {
    const msg = formatAlertMessage({
      totalUsd: 80,
      capUsd: 100,
      threshold: 0.8,
    });
    expect(msg).toContain("$80.00 / $100.00");
    expect(msg).toContain("80%");
    expect(msg).toContain("Threshold: 80%");
  });

  it("escalates icon when over 100%", () => {
    const msg = formatAlertMessage({
      totalUsd: 120,
      capUsd: 100,
      threshold: 0.8,
    });
    expect(msg).toContain(":rotating_light:");
  });

  it("includes label when provided", () => {
    const msg = formatAlertMessage({
      totalUsd: 85,
      capUsd: 100,
      threshold: 0.8,
      label: "production",
    });
    expect(msg).toContain("(production)");
  });
});

describe("postCostAlert", () => {
  it("uses `text` field for Slack URLs", async () => {
    let captured: { url: string; body: string } | null = null;
    const fakeFetch = async (
      url: string | URL,
      init?: RequestInit
    ): Promise<Response> => {
      captured = { url: String(url), body: String(init?.body ?? "") };
      return new Response("{}", { status: 200 });
    };
    const r = await postCostAlert(
      { url: "https://hooks.slack.com/services/X/Y/Z", fetch: fakeFetch as typeof fetch },
      { totalUsd: 80, capUsd: 100, threshold: 0.8 }
    );
    expect(r.ok).toBe(true);
    expect(captured!.body).toContain('"text"');
    expect(captured!.body).not.toContain('"content"');
  });

  it("uses `content` field for Discord URLs", async () => {
    let captured: { body: string } | null = null;
    const fakeFetch = async (
      _url: string | URL,
      init?: RequestInit
    ): Promise<Response> => {
      captured = { body: String(init?.body ?? "") };
      return new Response("{}", { status: 200 });
    };
    const r = await postCostAlert(
      {
        url: "https://discord.com/api/webhooks/111/ABC",
        fetch: fakeFetch as typeof fetch,
      },
      { totalUsd: 80, capUsd: 100, threshold: 0.8 }
    );
    expect(r.ok).toBe(true);
    expect(captured!.body).toContain('"content"');
  });

  it("returns { ok: false, error } when webhook is missing", async () => {
    const r = await postCostAlert(
      { url: "" },
      { totalUsd: 80, capUsd: 100, threshold: 0.8 }
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBeDefined();
  });
});
