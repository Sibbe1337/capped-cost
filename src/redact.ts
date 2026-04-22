export function redactSecret(value: string, visiblePrefix = 4): string {
  const trimmed = value.trim();
  if (!trimmed) return "[redacted]";
  const prefix = trimmed.slice(0, Math.min(visiblePrefix, trimmed.length));
  return `${prefix}…[redacted]`;
}

export function redactText(text: string, secrets: string[]): string {
  let next = text;
  for (const secret of secrets) {
    if (!secret) continue;
    next = next.split(secret).join("[redacted]");
  }
  return next;
}
