# ClosedClaw

> Encrypted Credential Vault for OpenClaw

ClosedClaw stores API keys and service credentials in an AES-256-GCM encrypted vault. It integrates with OpenClaw's SecretRef system to provide credentials on demand, without storing them in plaintext.

## How It Works

ClosedClaw is a pure CLI tool. No daemon, no proxy, no HTTP server.

### Single-Credential Skills (Exec Provider)

For skills with a `primaryEnv` / `apiKey` field (e.g., Overseerr):

```
OpenClaw needs credentials for a skill
  -> Spawns: closedclaw exec-provider
  -> Sends JSON request on stdin: { ids: ["overseerr-api-key"] }
  -> ClosedClaw decrypts vault, returns JSON on stdout
  -> OpenClaw injects as env var for skill execution
  -> Env var cleaned up after skill runs
```

### Multi-Credential Skills (SystemD EnvironmentFile)

For skills needing multiple credentials (e.g., Uptime Kuma with username + password), where the `env` field doesn't support SecretRef:

```
Gateway service starts
  -> ExecStartPre runs load-env.sh
  -> load-env.sh reads secrets from vault via closedclaw get
  -> Writes to EnvironmentFile (mode 0600, atomic write via mktemp + mv)
  -> Gateway inherits env vars, skill scripts inherit from gateway
  -> No plaintext credentials in openclaw.json
```

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

# List stored providers
closedclaw list
```

## OpenClaw Integration

### Step 1: Configure ClosedClaw as a secrets provider

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

### Step 2: Map single-credential skills to SecretRef

For skills with a `primaryEnv` field (like Overseerr):

```json
{
  "skills": {
    "entries": {
      "overseerr": {
        "apiKey": {
          "source": "exec",
          "provider": "closedclaw",
          "id": "overseerr-api-key"
        },
        "env": {
          "OVERSEERR_URL": "http://192.168.0.221:5055"
        }
      }
    }
  }
}
```

### Step 3: Multi-credential skills via EnvironmentFile

For skills needing multiple credentials, a loader script reads secrets from the vault at service start:

**Loader script** (`~/.closedclaw/load-env.sh`, mode 0700):
```bash
#!/bin/bash
set -euo pipefail

VAULT="/opt/closedclaw/bin/closedclaw.js"
PF="/root/.closedclaw/passphrase"
ENV="/root/.closedclaw/openclaw-env"

TMPENV=$(mktemp "${ENV}.XXXXXX")
trap 'rm -f "$TMPENV"' EXIT

echo "UPTIME_KUMA_URL=http://192.168.0.33:3001" > "$TMPENV"
echo "UPTIME_KUMA_USERNAME=$(node $VAULT get uptime-kuma-username --passphrase-file $PF)" >> "$TMPENV"
echo "UPTIME_KUMA_PASSWORD=$(node $VAULT get uptime-kuma-password --passphrase-file $PF)" >> "$TMPENV"

chmod 600 "$TMPENV"
mv "$TMPENV" "$ENV"
trap - EXIT
```

**SystemD service additions:**
```ini
[Service]
ExecStartPre=/root/.closedclaw/load-env.sh
EnvironmentFile=/root/.closedclaw/openclaw-env
```

The skill's `env` in `openclaw.json` only needs non-sensitive config. The gateway process inherits the sensitive vars from the EnvironmentFile, and skill scripts inherit them from the gateway.

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

## CLI Commands

| Command | Description |
|---------|-------------|
| `closedclaw init` | Initialize a new encrypted vault with master passphrase |
| `closedclaw store <provider> [key]` | Store a credential (prompts for hidden input if key omitted) |
| `closedclaw get <provider>` | Retrieve raw credential value to stdout |
| `closedclaw exec-provider` | OpenClaw exec provider (JSON stdin/stdout protocol) |
| `closedclaw list` | List stored credential provider names |
| `closedclaw delete <provider>` | Remove a stored credential |
| `closedclaw status` | Show vault status and configuration |
| `closedclaw config` | View/update configuration paths |
| `closedclaw audit [-n N]` | View recent audit log entries (default: 20) |

### Passphrase Resolution

Commands resolve the passphrase in priority order:
1. `--passphrase-file <path>` -- file must be mode 0600 or 0400, no symlinks
2. `CLOSEDCLAW_PASSPHRASE` environment variable (deleted from env after use)
3. Interactive prompt (hidden input via TTY)

## Security

| Feature | Implementation |
|---------|---------------|
| Encryption | AES-256-GCM (authenticated encryption) |
| Key Derivation | scrypt (N=16384, r=8, p=1) |
| File Permissions | All files created with 0600 (owner-only) |
| Memory Safety | Passphrase stored as Buffer, zeroed on lock |
| Audit Trail | All credential access logged (NDJSON) |
| Rate Limiting | Exponential backoff after 5 failed attempts (30s to 5min) |
| Timing Safety | `timingSafeEqual()` for hash comparison |
| Generic Errors | Avoids leaking credential existence |
| Passphrase File | Rejects symlinks, wrong ownership, group/other permissions |
| EnvironmentFile | Mode 0600, atomic writes, regenerated from vault on restart |

## File Locations

| File | Location | Purpose |
|------|----------|---------|
| Config | `~/.closedclaw/config.json` | Settings |
| Vault | `~/.closedclaw/vault.enc` | Encrypted credentials |
| Passphrase | `~/.closedclaw/passphrase` | Optional passphrase file for non-interactive use |
| Audit | `~/.closedclaw/audit.log` | Access log |
| Lockout | `~/.closedclaw/lockout.json` | Rate limiting state |
| Env Loader | `~/.closedclaw/load-env.sh` | Vault-to-env loader script |
| Env File | `~/.closedclaw/openclaw-env` | Generated env vars (regenerated on restart) |

## Deployment

```bash
# Deploy to OpenClaw LXC
./deploy/deploy.sh
```

The script builds, rsyncs to the LXC, installs production deps, deploys the env loader script, and creates the `/usr/local/bin/closedclaw` symlink.

## Development

```bash
npm install
npm run dev      # Watch mode
npm run build    # Production build
npm test         # Run tests
npm run typecheck
```

## License

MIT
