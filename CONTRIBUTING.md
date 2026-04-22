# Contributing

`capped-cost` is intentionally small. Contributions should improve safety, correctness, and trust without turning the project into a bloated platform.

## Local Setup

```bash
npm ci
npm run verify
```

## Project Standards

- zero runtime dependencies
- Node 18+ compatibility
- ESM + CJS outputs stay intact
- additive changes over rewrites
- typed, modular, testable code
- no fake TODOs or placeholder implementations

## Design Bias

Prefer:

- small focused functions
- explicit CLI behavior
- deterministic tests
- honest docs and caveats
- automation-friendly output

Avoid:

- hidden magic
- surprising side effects
- hypey README copy
- stateful behavior that is not documented
- browser-facing patterns that encourage unsafe admin-key usage

## Tests

Tests should:

- make no real network calls
- use injected `fetch`
- remain fast and deterministic
- cover exit codes and machine-readable output when behavior changes

Useful commands:

```bash
npm test
npm run typecheck
npm run build
npm pack --dry-run
```

## Docs

If you change behavior, update the docs in the same PR:

- `README.md`
- `CHANGELOG.md`
- `SECURITY.md` when the change affects trust or secret handling

## Releases

Do not ship undocumented breaking changes. If a behavioral change is security-motivated, document the before/after clearly in the changelog.
