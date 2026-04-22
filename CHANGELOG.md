# Changelog

All notable changes to this project will be documented here.

## 0.4.0 - 2026-04-22

### Added

- dedicated `alert` CLI command with threshold crossing, cooldown, and local dedupe state
- forecast strategies: `linear`, `rolling-7d`, and `weighted-recent`
- stable machine-readable JSON output with `schemaVersion`
- non-interactive `init` flags for safer automation
- `SECURITY.md`, `CONTRIBUTING.md`, and a release-grade README
- CI coverage for Node 18, 20, and 22 plus package verification

### Changed

- `init` now writes placeholder-only `.env.example`
- real secrets are only written to `.env.capped.local` when explicitly requested
- CLI version is derived from package metadata instead of a duplicated hardcoded string
- GitHub Actions example now uses the dedicated alert path instead of shell `|| curl`
- forecast output now explains the strategy, observation window, and caveats

### Fixed

- secret input is no longer echoed visibly in the setup wizard
- real secrets are redacted from wizard logs and not written to example env files
- provider/config failures are separated from budget alert conditions
- webhook failures no longer consume alert dedupe state

No intentional breaking public API changes were introduced in this release.
