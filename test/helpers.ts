import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";

export class MemoryStream extends Writable {
  output = "";

  _write(
    chunk: string | Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ) {
    this.output += chunk.toString();
    callback();
  }
}

export function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `${prefix}-`));
}

export function makeOpenAIFetch(totalUsd: number) {
  return async (url: string | URL): Promise<Response> => {
    const value = typeof url === "string" ? url : String(url);
    if (!value.includes("api.openai.com")) {
      throw new Error(`Unexpected URL: ${value}`);
    }
    return new Response(
      JSON.stringify({
        data: [
          {
            start_time: Math.floor(Date.UTC(2026, 3, 1) / 1000),
            results: [{ amount: { value: totalUsd, currency: "usd" } }],
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };
}
