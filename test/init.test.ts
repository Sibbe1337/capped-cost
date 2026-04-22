import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { runInit } from "../src/cli-init.js";
import { createBufferedPrompter } from "../src/terminal.js";
import { MemoryStream, makeTempDir } from "./helpers.js";

describe("runInit", () => {
  it("uses secret prompts and keeps .env.example placeholder-only", async () => {
    const cwd = makeTempDir("capped-init");
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();
    const secret = "sk-admin-super-secret";
    const webhook = "https://hooks.slack.com/services/T000/B000/SECRET";
    const prompter = createBufferedPrompter([
      true,
      secret,
      false,
      "250",
      true,
      webhook,
      false,
    ]);

    const exitCode = await runInit([], {
      colorEnabled: false,
      cwd,
      fetchOpenAI: async () => ({ dailyCents: new Map(), totalCents: 1234 }),
      prompter,
      stderr,
      stdout,
    });

    const example = readFileSync(`${cwd}/.env.example`, "utf8");

    expect(exitCode).toBe(0);
    expect(prompter.calls.some((call) => call.kind === "secret" && call.message.includes("OpenAI"))).toBe(true);
    expect(prompter.calls.some((call) => call.kind === "secret" && call.message.includes("webhook"))).toBe(true);
    expect(example).toContain("OPENAI_ADMIN_KEY=sk-admin-your-org-admin-key");
    expect(example).not.toContain(secret);
    expect(example).not.toContain(webhook);
    expect(stdout.output).not.toContain(secret);
    expect(stderr.output).not.toContain(secret);
    expect(existsSync(`${cwd}/.env.capped.local`)).toBe(false);
  });

  it("writes real secrets only to the explicit local file", async () => {
    const cwd = makeTempDir("capped-init-local");
    const secret = "sk-ant-admin01-secret";

    const exitCode = await runInit(
      [
        "--anthropic-key=" + secret,
        "--cap=120",
        "--skip-verify",
        "--write-secrets-file",
        "--yes",
      ],
      {
        colorEnabled: false,
        cwd,
        stderr: new MemoryStream(),
        stdout: new MemoryStream(),
      }
    );

    const example = readFileSync(`${cwd}/.env.example`, "utf8");
    const local = readFileSync(`${cwd}/.env.capped.local`, "utf8");

    expect(exitCode).toBe(0);
    expect(example).not.toContain(secret);
    expect(local).toContain(secret);
  });
});
