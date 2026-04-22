# Security Policy

## Supported Versions

Security fixes are applied to the latest release line on `main`. Older published versions may not receive fixes.

## Reporting A Vulnerability

If you find a security issue:

- prefer GitHub Security Advisories / private reporting if enabled for the repo
- otherwise open a private maintainer contact through GitHub before publishing details

Please include:

- affected version
- impact
- reproduction steps
- whether the issue leaks secrets, weakens alert correctness, or breaks trust guarantees

## Security Model

`capped-cost` is intentionally small and read-only:

- it reads spend from provider admin APIs
- it does not proxy model traffic
- it does not store secrets remotely
- it does not ship telemetry
- it does not depend on runtime packages

The main security boundary is secret handling.

### Admin keys

This package uses organization/admin spend endpoints. That means the keys are sensitive and should be treated like production secrets.

Recommended handling:

- store secrets in CI secret managers, shell env, or local-only files
- use the safe `init` flow if you want a local file
- keep `.env.capped.local` out of version control
- rotate keys if you believe they were exposed

### Browser and extension usage

This package is not a safe excuse to ship admin keys to a browser or public extension.

Unsafe patterns:

- embedding admin keys in frontend bundles
- shipping keys in Chrome extension source or config
- writing real secrets to tracked example files

Safer patterns:

- a backend or worker that keeps keys server-side
- local-only internal tooling where the operator controls the machine

### Alerting correctness

`capped-cost alert` persists dedupe state locally. If that state is not persisted between runs, repeated alerts can occur. That is an operational correctness issue, not a secret exposure issue, but it still affects trust.

Use persistent storage or cache restore/save in ephemeral CI environments.

## Known Non-Goals

- hardened secret vault behavior
- multi-tenant auth boundaries
- encrypted state storage
- server-side budget enforcement

Those are outside the scope of this package by design.
