# ClosedClaw (Fork)

> Encrypted credential vault for OpenClaw -- forked from [closed-claw/closedclaw](https://github.com/closed-claw/closedclaw) and rebuilt as a pure CLI tool.

## What Changed

The [original ClosedClaw](https://github.com/closed-claw/closedclaw) ran as an HTTP daemon on port 3847, proxying requests between apps and OpenClaw and injecting credentials at runtime. Good encryption, but the always-on daemon model added attack surface (open port, running process, single point of failure).

This fork rips out the daemon entirely and replaces it with a CLI tool that decrypts credentials on demand and exits. No HTTP server, no open port, no proxy. It also adds:

- **Brute force protection** -- exponential backoff after 5 failed attempts (30s to 5min)
- **Audit logging** -- append-only NDJSON log of every credential access
- **Passphrase file validation** -- rejects symlinks, wrong ownership, and group/other permissions
- **Timing-safe comparison** -- `timingSafeEqual()` for hash checks
- **Generic error messages** -- wrong passphrase and missing credential return the same error
- **Exec provider protocol** -- JSON stdin/stdout integration with OpenClaw's SecretRef system
- **SystemD EnvironmentFile pattern** -- vault-to-env loader for multi-credential skills

Credit to the original [ClosedClaw team](https://github.com/closed-claw/closedclaw) for the core encryption design (AES-256-GCM, scrypt KDF) and the idea of an OpenClaw credential vault.

## How It Works

ClosedClaw is a pure CLI tool. No daemon, no proxy, no HTTP server.

```
closedclaw get <key>     # Decrypt a credential, print to stdout, exit
closedclaw exec-provider # JSON stdin/stdout protocol for OpenClaw
closedclaw audit         # View credential access log
```

Three integration patterns with OpenClaw:

**1. Exec Provider** -- OpenClaw spawns ClosedClaw, sends a JSON request on stdin, gets decrypted credentials on stdout. Used for single-credential skills (e.g., Overseerr API key).

**2. SystemD EnvironmentFile** -- A loader script reads secrets from the vault at service start and writes them to a temp env file (mode 0600, atomic write). Used for multi-credential skills (e.g., Uptime Kuma username + password).

**3. Direct vault reads** -- Shell scripts call `closedclaw get` directly. Credentials exist only in the shell session's memory for the duration of the command. Used for standalone scripts (e.g., Proxmox operations).

## Quick Start

```bash
# Initialize your vault
closedclaw init

# Store credentials (interactive, hidden input)
closedclaw store overseerr-api-key
closedclaw store uptime-kuma-username
closedclaw store uptime-kuma-password

# Retrieve a credential
closedclaw get overseerr-api-key --passphrase-file ~/.closedclaw/passphrase

# View recent credential access
closedclaw audit -n 10

# List stored providers
closedclaw list
```

## OpenClaw Integration

### Step 1: Configure as a secrets provider

Add to `openclaw.json`:

```json
{
  "secrets": {
    "providers": {
      "closedclaw": {
        "source": "exec",
        "command": "/opt/closedclaw/bin/closedclaw.js",
        "args": ["exec-provider", "--passphrase-file", "/root/.closedclaw/passphrase"],
        "jsonOnly": true,
        "timeoutMs": 30000
      }
    }
  }
}
```

### Step 2: Single-credential skills (SecretRef)

Point the skill's `apiKey` at the vault instead of storing a plaintext key:

```json
{
  "skills": {
    "entries": {
      "overseerr": {
        "apiKey": {
          "source": "exec",
          "provider": "closedclaw",
          "id": "overseerr-api-key"
        }
      }
    }
  }
}
```

### Step 3: Multi-credential skills (EnvironmentFile)

For skills needing multiple credentials, a loader script reads from the vault at service start:

```bash
#!/bin/bash
set -euo pipefail

VAULT="/opt/closedclaw/bin/closedclaw.js"
PF="/root/.closedclaw/passphrase"
ENV="/root/.closedclaw/openclaw-env"

TMPENV=$(mktemp "${ENV}.XXXXXX")
trap 'rm -f "$TMPENV"' EXIT

echo "UPTIME_KUMA_USERNAME=$(node $VAULT get uptime-kuma-username --passphrase-file $PF)" > "$TMPENV"
echo "UPTIME_KUMA_PASSWORD=$(node $VAULT get uptime-kuma-password --passphrase-file $PF)" >> "$TMPENV"

chmod 600 "$TMPENV"
mv "$TMPENV" "$ENV"
trap - EXIT
```

Add to the systemd service:

```ini
[Service]
ExecStartPre=/root/.closedclaw/load-env.sh
EnvironmentFile=/root/.closedclaw/openclaw-env
```

### Step 4: Direct vault reads in scripts

For shell scripts that need credentials at runtime:

```bash
TOKEN_ID=$(closedclaw get proxmox-token-id --passphrase-file /root/.closedclaw/passphrase)
TOKEN_SECRET=$(closedclaw get proxmox-token-secret --passphrase-file /root/.closedclaw/passphrase)
```

No credentials file on disk. Values exist only in memory for the duration of the command.

### Exec Provider Protocol

The `exec-provider` command speaks OpenClaw's JSON stdin/stdout protocol:

**Request (stdin):**
```json
{ "protocolVersion": 1, "provider": "closedclaw", "ids": ["overseerr-api-key"] }
```

**Response (stdout):**
```json
{ "protocolVersion": 1, "values": { "overseerr-api-key": "abc123" } }
```

Supports batch retrieval with per-credential error reporting.

## CLI Reference

| Command | Description |
|---------|-------------|
| `closedclaw init` | Initialize a new encrypted vault with master passphrase |
| `closedclaw store <key> [value]` | Store a credential (prompts for hidden input if value omitted) |
| `closedclaw get <key>` | Retrieve raw credential value to stdout |
| `closedclaw exec-provider` | OpenClaw exec provider (JSON stdin/stdout protocol) |
| `closedclaw list` | List stored credential names |
| `closedclaw delete <key>` | Remove a stored credential |
| `closedclaw status` | Show vault status and configuration |
| `closedclaw config` | View/update configuration paths |
| `closedclaw audit [-n N]` | View recent audit log entries (default: 20) |

### Passphrase Resolution

Commands resolve the passphrase in priority order:
1. `--passphrase-file <path>` -- file must be mode 0600 or 0400, no symlinks, correct ownership
2. `CLOSEDCLAW_PASSPHRASE` environment variable (deleted from env after use)
3. Interactive prompt (hidden input via TTY)

## Security

| Feature | Implementation |
|---------|---------------|
| Encryption | AES-256-GCM (authenticated encryption) |
| Key Derivation | scrypt (N=16384, r=8, p=1) |
| Random Salt | 32 bytes per encryption |
| Random IV | 16 bytes per encryption |
| Auth Tag | 16-byte GCM tag (detects tampering) |
| File Permissions | All files created with 0600 (owner-only) |
| Memory Safety | Passphrase stored as Buffer, zeroed on lock |
| Audit Trail | All credential access logged to NDJSON file |
| Rate Limiting | Exponential backoff after 5 failed attempts (30s to 5min) |
| Timing Safety | `timingSafeEqual()` for hash comparison |
| Generic Errors | Wrong passphrase and missing credential return same error |
| Passphrase File | Rejects symlinks, wrong ownership, group/other permissions |

## File Locations

| File | Location | Purpose |
|------|----------|---------|
| Config | `~/.closedclaw/config.json` | Settings |
| Vault | `~/.closedclaw/vault.enc` | Encrypted credentials |
| Passphrase | `~/.closedclaw/passphrase` | Master passphrase for non-interactive use |
| Audit | `~/.closedclaw/audit.log` | Credential access log (NDJSON) |
| Lockout | `~/.closedclaw/lockout.json` | Rate limiting state |

## Deployment

```bash
# Deploy to target host
./deploy/deploy.sh
```

The deploy script builds TypeScript, rsyncs to the target, installs production dependencies, and creates the `/usr/local/bin/closedclaw` symlink.

## Development

```bash
npm install
npm run dev      # Watch mode
npm run build    # Production build
npm test         # Run tests
npm run typecheck
```

## License

MIT -- see [LICENSE](LICENSE)

## Credits

Forked from [closed-claw/closedclaw](https://github.com/closed-claw/closedclaw). The original project provided the core encryption design (AES-256-GCM vault with scrypt key derivation) and the concept of an encrypted credential store for OpenClaw. This fork replaces the daemon architecture with a CLI tool and adds security hardening.
