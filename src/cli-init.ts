import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { fetchAnthropicCost } from "./anthropic.js";
import { DEFAULT_SECRETS_FILE, DEFAULT_ALERT_THRESHOLDS, DEFAULT_ALERT_COOLDOWN_MS } from "./constants.js";
import { fetchOpenAICost } from "./openai.js";
import { redactText } from "./redact.js";
import { createStyles, createTerminalPrompter, type Prompter } from "./terminal.js";

interface InitValues {
  anthropicKey?: string;
  capUsd?: string;
  openaiKey?: string;
  webhookUrl?: string;
}

export interface RunInitDeps {
  colorEnabled?: boolean;
  cwd?: string;
  fetchAnthropic?: typeof fetchAnthropicCost;
  fetchOpenAI?: typeof fetchOpenAICost;
  prompter?: Prompter;
  stderr?: NodeJS.WritableStream;
  stdout?: NodeJS.WritableStream;
}

function parseArg(argv: string[], prefix: string): string | undefined {
  const match = argv.find((item) => item.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

function hasFlag(argv: string[], value: string): boolean {
  return argv.includes(value);
}

function writeLine(stream: NodeJS.WritableStream, value = ""): void {
  stream.write(`${value}\n`);
}

function placeholderEnv(selected: {
  anthropic: boolean;
  openai: boolean;
  webhook: boolean;
}): string {
  const lines = [
    "# Safe placeholder template for capped-cost.",
    "# Real secrets belong in .env.capped.local (gitignored) or your shell/CI secret store.",
    "",
  ];

  if (selected.openai) {
    lines.push("OPENAI_ADMIN_KEY=sk-admin-your-org-admin-key");
  }
  if (selected.anthropic) {
    lines.push("ANTHROPIC_ADMIN_KEY=sk-ant-admin01-your-org-admin-key");
  }
  lines.push("CAPPED_CAP_USD=100");
  lines.push(`CAPPED_ALERT_THRESHOLDS=${DEFAULT_ALERT_THRESHOLDS.join(",")}`);
  lines.push(`CAPPED_ALERT_COOLDOWN_MS=${DEFAULT_ALERT_COOLDOWN_MS}`);
  if (selected.webhook) {
    lines.push("CAPPED_WEBHOOK_URL=https://hooks.slack.com/services/your/webhook/path");
  }
  lines.push("");
  return lines.join("\n");
}

function localEnv(values: InitValues): string {
  const lines: string[] = [];
  if (values.openaiKey) lines.push(`OPENAI_ADMIN_KEY=${values.openaiKey}`);
  if (values.anthropicKey) lines.push(`ANTHROPIC_ADMIN_KEY=${values.anthropicKey}`);
  if (values.capUsd) lines.push(`CAPPED_CAP_USD=${values.capUsd}`);
  lines.push(`CAPPED_ALERT_THRESHOLDS=${DEFAULT_ALERT_THRESHOLDS.join(",")}`);
  lines.push(`CAPPED_ALERT_COOLDOWN_MS=${DEFAULT_ALERT_COOLDOWN_MS}`);
  if (values.webhookUrl) lines.push(`CAPPED_WEBHOOK_URL=${values.webhookUrl}`);
  lines.push("");
  return lines.join("\n");
}

function sanitize(message: string, secrets: string[]): string {
  return redactText(message, secrets.filter(Boolean));
}

export async function runInit(args: string[], deps: RunInitDeps = {}): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const styles = createStyles({
    colorEnabled: deps.colorEnabled ?? Boolean(process.stdout.isTTY && !process.env.NO_COLOR),
  });
  const cwd = deps.cwd ?? process.cwd();
  const fetchOpenAIImpl = deps.fetchOpenAI ?? fetchOpenAICost;
  const fetchAnthropicImpl = deps.fetchAnthropic ?? fetchAnthropicCost;
  const prompter = deps.prompter ?? createTerminalPrompter();

  const nonInteractive = hasFlag(args, "--yes");
  const skipVerify = hasFlag(args, "--skip-verify");
  const writeSecretsFile = hasFlag(args, "--write-secrets-file");
  const secretsFileName = parseArg(args, "--secrets-file=") || DEFAULT_SECRETS_FILE;
  const providedOpenAIKey = parseArg(args, "--openai-key=");
  const providedAnthropicKey = parseArg(args, "--anthropic-key=");
  const providedCapUsd = parseArg(args, "--cap=");
  const providedWebhookUrl = parseArg(args, "--webhook-url=");
  const secretValues = [
    providedOpenAIKey || "",
    providedAnthropicKey || "",
    providedWebhookUrl || "",
  ];

  async function decide(enabledByFlag: string | undefined, message: string): Promise<boolean> {
    if (enabledByFlag) return true;
    if (nonInteractive) return false;
    return prompter.confirm({ message, defaultYes: true });
  }

  async function textOrPrompt(
    provided: string | undefined,
    message: string,
    defaultValue?: string
  ): Promise<string> {
    if (provided !== undefined) return provided.trim();
    if (nonInteractive) return defaultValue || "";
    return prompter.text({ message, defaultValue });
  }

  async function secretOrPrompt(
    provided: string | undefined,
    message: string
  ): Promise<string> {
    if (provided !== undefined) return provided.trim();
    if (nonInteractive) return "";
    return prompter.secret({ message });
  }

  writeLine(stdout);
  writeLine(stdout, styles.bold("capped-cost setup"));
  writeLine(
    stdout,
    styles.dim(
      "Tests admin keys safely, writes placeholder-only .env.example, and can optionally write a local gitignored secrets file."
    )
  );
  writeLine(stdout);

  const envValues: InitValues = {};
  let anyConfigured = false;

  const useOpenAI = await decide(providedOpenAIKey, "Track OpenAI spend?");
  if (useOpenAI) {
    writeLine(stdout, `  Admin keys: ${styles.cyan("https://platform.openai.com/settings/organization/admin-keys")}`);
    writeLine(stdout, styles.dim("  Requires an Organization Admin Key (sk-admin-...), not a normal API key."));
    const key = await secretOrPrompt(providedOpenAIKey, "  OpenAI admin key");
    if (!key && nonInteractive) {
      writeLine(stderr, styles.red("Missing --openai-key for non-interactive setup."));
      prompter.close();
      return 1;
    }
    if (key) {
      secretValues.push(key);
      if (!skipVerify) {
        stdout.write("  Testing OpenAI key... ");
        const result = await fetchOpenAIImpl(key);
        if ("error" in result) {
          writeLine(stdout, styles.red("failed"));
          writeLine(stderr, sanitize(result.error, secretValues));
          if (result.hint) {
            for (const hint of result.hint) {
              writeLine(stderr, styles.dim(`    • ${sanitize(hint, secretValues)}`));
            }
          }
        } else {
          writeLine(stdout, styles.green("ok"));
          anyConfigured = true;
          envValues.openaiKey = key;
        }
      } else {
        writeLine(stdout, styles.yellow("  Skipped OpenAI verification (--skip-verify)."));
        anyConfigured = true;
        envValues.openaiKey = key;
      }
      writeLine(stdout);
    }
  }

  const useAnthropic = await decide(providedAnthropicKey, "Track Anthropic spend?");
  if (useAnthropic) {
    writeLine(stdout, `  Admin keys: ${styles.cyan("https://console.anthropic.com/settings/admin-keys")}`);
    const key = await secretOrPrompt(providedAnthropicKey, "  Anthropic admin key");
    if (!key && nonInteractive) {
      writeLine(stderr, styles.red("Missing --anthropic-key for non-interactive setup."));
      prompter.close();
      return 1;
    }
    if (key) {
      secretValues.push(key);
      if (!skipVerify) {
        stdout.write("  Testing Anthropic key... ");
        const result = await fetchAnthropicImpl(key);
        if ("error" in result) {
          writeLine(stdout, styles.red("failed"));
          writeLine(stderr, sanitize(result.error, secretValues));
          if (result.hint) {
            for (const hint of result.hint) {
              writeLine(stderr, styles.dim(`    • ${sanitize(hint, secretValues)}`));
            }
          }
        } else {
          writeLine(stdout, styles.green("ok"));
          anyConfigured = true;
          envValues.anthropicKey = key;
        }
      } else {
        writeLine(stdout, styles.yellow("  Skipped Anthropic verification (--skip-verify)."));
        anyConfigured = true;
        envValues.anthropicKey = key;
      }
      writeLine(stdout);
    }
  }

  if (!anyConfigured) {
    writeLine(stderr, styles.red("No validated providers configured. Exiting without writing files."));
    prompter.close();
    return 1;
  }

  const capUsd = await textOrPrompt(providedCapUsd, "Monthly cap in USD", "100");
  envValues.capUsd = capUsd || "100";

  const wantsWebhook = Boolean(providedWebhookUrl) || (!nonInteractive
    ? await prompter.confirm({ message: "Configure a webhook for alert delivery?", defaultYes: false })
    : false);
  if (wantsWebhook) {
    const webhookUrl = await secretOrPrompt(providedWebhookUrl, "  Slack/Discord webhook URL");
    if (webhookUrl) {
      envValues.webhookUrl = webhookUrl;
      secretValues.push(webhookUrl);
    } else if (providedWebhookUrl !== undefined || nonInteractive) {
      writeLine(stderr, styles.red("Webhook requested but no URL was provided."));
      prompter.close();
      return 1;
    }
  }

  const examplePath = resolve(cwd, ".env.example");
  const secretsPath = resolve(cwd, secretsFileName);
  const exampleContent = placeholderEnv({
    anthropic: Boolean(envValues.anthropicKey),
    openai: Boolean(envValues.openaiKey),
    webhook: Boolean(envValues.webhookUrl),
  });

  const overwriteExample =
    !existsSync(examplePath) ||
    nonInteractive ||
    (await prompter.confirm({
      message: ".env.example exists. Replace it with a safe placeholder template?",
      defaultYes: true,
    }));

  if (overwriteExample) {
    writeFileSync(examplePath, exampleContent, { mode: 0o644 });
  }

  const shouldWriteSecrets =
    writeSecretsFile ||
    (!nonInteractive &&
      (await prompter.confirm({
        message: `Write real secrets to ${secretsFileName} (gitignored local file)?`,
        defaultYes: false,
      })));

  if (shouldWriteSecrets) {
    const canOverwriteSecrets =
      !existsSync(secretsPath) ||
      nonInteractive ||
      (await prompter.confirm({
        message: `${secretsFileName} exists. Overwrite it?`,
        defaultYes: false,
      }));
    if (canOverwriteSecrets) {
      writeFileSync(secretsPath, localEnv(envValues), { mode: 0o600 });
      writeLine(stdout, styles.green(`✓ Wrote local secrets to ${styles.cyan(secretsFileName)}.`));
      writeLine(
        stdout,
        styles.dim("  Keep this file out of git. process.env still wins over file-based config.")
      );
    }
  }

  writeLine(stdout);
  writeLine(stdout, styles.green("✓ Setup complete."));
  if (overwriteExample) {
    writeLine(stdout, `  Wrote safe placeholders to ${styles.cyan(".env.example")}`);
  } else {
    writeLine(stdout, `  Left existing ${styles.cyan(".env.example")} untouched.`);
  }
  writeLine(stdout);
  writeLine(stdout, styles.bold("Next steps:"));
  writeLine(stdout, `  1. Keep real secrets in ${styles.cyan(secretsFileName)}, your shell, or your CI secret store.`);
  writeLine(stdout, `  2. Run ${styles.cyan("capped-cost")} to check current spend.`);
  writeLine(stdout, `  3. Run ${styles.cyan("capped-cost alert --cap=100 --webhook-url=<secret>")} for automation-safe alerts.`);
  writeLine(stdout, `  4. Run ${styles.cyan("capped-cost forecast --strategy=rolling-7d")} for a less naive projection.`);
  writeLine(stdout);

  prompter.close();
  return 0;
}
