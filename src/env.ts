import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_ENV_FILES = [".env", ".env.local", ".env.capped.local"] as const;

export interface LoadedEnvFile {
  path: string;
  values: Record<string, string>;
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export function parseEnvFile(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    const value = stripQuotes(line.slice(eq + 1).trim());
    if (!key) continue;
    values[key] = value;
  }
  return values;
}

export function loadLocalEnv(
  cwd: string = process.cwd(),
  fileNames: readonly string[] = DEFAULT_ENV_FILES
): LoadedEnvFile[] {
  const loaded: LoadedEnvFile[] = [];
  const merged: Record<string, string> = {};

  for (const fileName of fileNames) {
    const path = resolve(cwd, fileName);
    if (!existsSync(path)) continue;

    const values = parseEnvFile(readFileSync(path, "utf8"));
    loaded.push({ path, values });
    Object.assign(merged, values);
  }

  for (const [key, value] of Object.entries(merged)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }

  return loaded;
}
