# Changelog

All notable changes to ClosedClaw will be documented in this file.

## [0.2.0] - 2026-02-28

### Added
- OpenClaw exec-provider integration (JSON stdin/stdout protocol)
- Batch credential retrieval for exec-provider
- `get` command for single credential retrieval (raw stdout)
- `audit` command for viewing audit log entries
- Brute force protection with exponential backoff (5 attempts, 30s-5min lockout)
- Passphrase file support (`--passphrase-file`) with symlink and permission checks
- Timing-safe hash comparison for passphrase verification
- Generic error messages to prevent credential existence leaking
- SystemD EnvironmentFile integration for multi-credential skills
- Vault-to-env loader script (`load-env.sh`) with atomic writes
- Deploy script step for loader script deployment

### Changed
- Replaced daemon proxy with pure CLI architecture (no HTTP server)
- Provider names validated against `[a-zA-Z0-9._-]{1,64}` pattern
- Audit log rejects symlinks and checks file permissions

### Removed
- Daemon proxy server (`start`/`stop` commands)
- HTTP-based credential retrieval

## [0.1.0] - 2026-02-01

### Added
- Initial release
- AES-256-GCM encrypted credential vault
- CLI commands: init, store, list, delete, start, stop, status, config
- Daemon proxy server for OpenClaw integration
- scrypt key derivation with high memory cost
- Secure file permissions (0600)
- Passphrase verification without decryption
- Password change functionality
