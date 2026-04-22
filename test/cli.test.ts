import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/cli.js";
import { MemoryStream, makeOpenAIFetch, makeTempDir } from "./helpers.js";

const ENV_KEYS = [
  "OPENAI_ADMIN_KEY",
  "ANTHROPIC_ADMIN_KEY",
  "CAPPED_CAP_USD",
  "CAPPED_WEBHOOK_URL",
  "CAPPED_ALERT_THRESHOLDS",
  "CAPPED_ALERT_COOLDOWN_MS",
  "CAPPED_COST_STATE_FILE",
] as const;

const envSnapshot = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = envSnapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("runCli", () => {
  it("emits stable JSON with schemaVersion", async () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();
    const exitCode = await runCli(["check", "--provider=openai", "--format=json"], {
      env: {
        OPENAI_ADMIN_KEY: "sk-admin-test",
      },
      fetch: makeOpenAIFetch(12.34) as typeof fetch,
      stderr,
      stdout,
    });

    const json = JSON.parse(stdout.output);
    expect(exitCode).toBe(0);
    expect(json.schemaVersion).toBe(1);
    expect(json.command).toBe("check");
    expect(json.provider).toBe("openai");
    expect(json.totalUsd).toBe(12.34);
    expect(stderr.output).toBe("");
  });

  it("dedupes alert webhooks via the local state file", async () => {
    const cwd = makeTempDir("capped-alert");
    const calls: string[] = [];
    const fetch = async (url: string | URL): Promise<Response> => {
      const value = String(url);
      calls.push(value);
      if (value.includes("api.openai.com")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                start_time: Math.floor(Date.UTC(2026, 3, 1) / 1000),
                results: [{ amount: { value: 90, currency: "usd" } }],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (value.includes("hooks.slack.com")) {
        return new Response("ok", { status: 200 });
      }
      throw new Error(`Unexpected URL: ${value}`);
    };

    const baseArgs = [
      "alert",
      "--provider=openai",
      "--cap=100",
      "--thresholds=0.8",
      "--state-file=.state.json",
      "--webhook-url=https://hooks.slack.com/services/T/B/C",
    ];

    const first = await runCli(baseArgs, {
      cwd,
      env: { OPENAI_ADMIN_KEY: "sk-admin-test" },
      fetch: fetch as typeof globalThis.fetch,
      now: new Date(Date.UTC(2026, 3, 10, 12, 0, 0)),
      stderr: new MemoryStream(),
      stdout: new MemoryStream(),
    });
    const second = await runCli(baseArgs, {
      cwd,
      env: { OPENAI_ADMIN_KEY: "sk-admin-test" },
      fetch: fetch as typeof globalThis.fetch,
      now: new Date(Date.UTC(2026, 3, 10, 13, 0, 0)),
      stderr: new MemoryStream(),
      stdout: new MemoryStream(),
    });

    expect(first).toBe(0);
    expect(second).toBe(0);
    expect(calls.filter((value) => value.includes("hooks.slack.com"))).toHaveLength(1);
    expect(readFileSync(`${cwd}/.state.json`, "utf8")).toContain('"lastObservedPct"');
  });

  it("treats provider failures separately from alert conditions", async () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();
    const exitCode = await runCli(
      ["alert", "--provider=openai", "--cap=100", "--webhook-url=https://hooks.slack.com/services/T/B/C", "--format=json"],
      {
        env: { OPENAI_ADMIN_KEY: "sk-admin-test" },
        fetch: (async (url: string | URL): Promise<Response> => {
          const value = String(url);
          if (value.includes("api.openai.com")) {
            return new Response("nope", { status: 401 });
          }
          throw new Error(`Unexpected URL: ${value}`);
        }) as typeof fetch,
        stderr,
        stdout,
      }
    );

    const json = JSON.parse(stdout.output);
    expect(exitCode).toBe(2);
    expect(json.status).toBe("provider-failure");
    expect(json.ok).toBe(false);
  });

  it("returns exit code 2 when check thresholds are reached", async () => {
    const exitCode = await runCli(["check", "--provider=openai", "--cap=100", "--threshold=0.8"], {
      env: {
        OPENAI_ADMIN_KEY: "sk-admin-test",
      },
      fetch: makeOpenAIFetch(85) as typeof fetch,
      stderr: new MemoryStream(),
      stdout: new MemoryStream(),
    });

    expect(exitCode).toBe(2);
  });

  it("does not advance alert state when webhook delivery fails", async () => {
    const cwd = makeTempDir("capped-webhook-failure");
    const webhookCalls: string[] = [];
    const providerResponse = new Response(
      JSON.stringify({
        data: [
          {
            start_time: Math.floor(Date.UTC(2026, 3, 1) / 1000),
            results: [{ amount: { value: 90, currency: "usd" } }],
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );

    const args = [
      "alert",
      "--provider=openai",
      "--cap=100",
      "--thresholds=0.8",
      "--state-file=.state.json",
      "--webhook-url=https://hooks.slack.com/services/T/B/C",
    ];

    const firstExitCode = await runCli(args, {
      cwd,
      env: { OPENAI_ADMIN_KEY: "sk-admin-test" },
      fetch: (async (url: string | URL): Promise<Response> => {
        const value = String(url);
        if (value.includes("api.openai.com")) return providerResponse.clone();
        webhookCalls.push(value);
        return new Response("nope", { status: 500 });
      }) as typeof fetch,
      now: new Date(Date.UTC(2026, 3, 10, 12, 0, 0)),
      stderr: new MemoryStream(),
      stdout: new MemoryStream(),
    });

    const secondExitCode = await runCli(args, {
      cwd,
      env: { OPENAI_ADMIN_KEY: "sk-admin-test" },
      fetch: (async (url: string | URL): Promise<Response> => {
        const value = String(url);
        if (value.includes("api.openai.com")) return providerResponse.clone();
        webhookCalls.push(value);
        return new Response("ok", { status: 200 });
      }) as typeof fetch,
      now: new Date(Date.UTC(2026, 3, 10, 13, 0, 0)),
      stderr: new MemoryStream(),
      stdout: new MemoryStream(),
    });

    expect(firstExitCode).toBe(3);
    expect(secondExitCode).toBe(0);
    expect(webhookCalls).toHaveLength(2);
    expect(() => readFileSync(`${cwd}/.state.json`, "utf8")).not.toThrow();
  });

  it("loads local secrets from .env.capped.local automatically", async () => {
    const cwd = makeTempDir("capped-env");
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(`${cwd}/.env.capped.local`, "OPENAI_ADMIN_KEY=sk-admin-from-file\n", "utf8")
    );

    delete process.env.OPENAI_ADMIN_KEY;

    const exitCode = await runCli(["check", "--provider=openai", "--format=json"], {
      cwd,
      fetch: makeOpenAIFetch(5) as typeof fetch,
      stderr,
      stdout,
    });

    const json = JSON.parse(stdout.output);
    expect(exitCode).toBe(0);
    expect(json.totalUsd).toBe(5);
    expect(stderr.output).toBe("");
  });
});
