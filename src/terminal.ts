import { Writable } from "node:stream";
import { createInterface } from "node:readline/promises";
import * as readline from "node:readline";

export interface StyleOptions {
  colorEnabled: boolean;
}

function colorize(enabled: boolean, value: string, code: string): string {
  if (!enabled) return value;
  return `\x1b[${code}m${value}\x1b[0m`;
}

export function createStyles(options: StyleOptions) {
  const { colorEnabled } = options;
  return {
    bold: (value: string) => colorize(colorEnabled, value, "1"),
    cyan: (value: string) => colorize(colorEnabled, value, "36"),
    dim: (value: string) => colorize(colorEnabled, value, "2"),
    green: (value: string) => colorize(colorEnabled, value, "32"),
    red: (value: string) => colorize(colorEnabled, value, "31"),
    yellow: (value: string) => colorize(colorEnabled, value, "33"),
  };
}

export interface PromptSpec {
  defaultValue?: string;
  message: string;
}

export interface Prompter {
  close(): void;
  confirm(spec: PromptSpec & { defaultYes?: boolean }): Promise<boolean>;
  secret(spec: PromptSpec): Promise<string>;
  text(spec: PromptSpec): Promise<string>;
}

class MutedOutput extends Writable {
  muted = false;

  _write(
    chunk: string | Buffer,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ) {
    if (!this.muted) process.stdout.write(chunk, encoding);
    callback();
  }
}

export function createTerminalPrompter(): Prompter {
  const muted = new MutedOutput();
  const rl = createInterface({
    input: process.stdin,
    output: muted,
    terminal: true,
  });

  async function ask(message: string): Promise<string> {
    return (await rl.question(message)).trim();
  }

  return {
    close() {
      rl.close();
    },
    async confirm({ message, defaultYes = true }) {
      const marker = defaultYes ? "Y/n" : "y/N";
      const value = (await ask(`${message} (${marker}): `)).toLowerCase();
      if (!value) return defaultYes;
      return value === "y" || value === "yes";
    },
    async secret({ defaultValue, message }) {
      const suffix = defaultValue ? ` (default ${defaultValue})` : "";
      muted.muted = true;
      try {
        const value = await ask(`${message}${suffix}: `);
        process.stdout.write("\n");
        return value || defaultValue || "";
      } finally {
        muted.muted = false;
      }
    },
    async text({ defaultValue, message }) {
      const suffix = defaultValue ? ` (default ${defaultValue})` : "";
      const value = await ask(`${message}${suffix}: `);
      return value || defaultValue || "";
    },
  };
}

export function createBufferedPrompter(answers: Array<string | boolean>) {
  const calls: Array<{ kind: "text" | "secret" | "confirm"; message: string }> = [];

  function shift<T>(): T {
    if (!answers.length) throw new Error("No buffered prompt answers left.");
    return answers.shift() as T;
  }

  const prompter: Prompter & {
    calls: typeof calls;
  } = {
    calls,
    close() {},
    async confirm({ message }) {
      calls.push({ kind: "confirm", message });
      return Boolean(shift<boolean>());
    },
    async secret({ message }) {
      calls.push({ kind: "secret", message });
      return String(shift<string>());
    },
    async text({ message }) {
      calls.push({ kind: "text", message });
      return String(shift<string>());
    },
  };

  return prompter;
}

export function supportsColor(noColor = false): boolean {
  return Boolean(process.stdout.isTTY && !noColor && !process.env.NO_COLOR);
}

export function hideCursorLine(): void {
  readline.clearLine(process.stdout, 0);
  readline.cursorTo(process.stdout, 0);
}
