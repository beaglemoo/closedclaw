# ClosedClaw

> Encrypted Credential Vault for OpenClaw

ClosedClaw stores API keys and service credentials in an AES-256-GCM encrypted vault. It integrates with OpenClaw's SecretRef system to provide credentials on demand, without storing them in plaintext.

## How It Works

```
OpenClaw needs credentials for a skill
  -> Spawns: closedclaw exec-provider
  -> Sends JSON request on stdin: { ids: ["overseerr-api-key"] }
  -> ClosedClaw decrypts vault, returns JSON on stdout
  -> OpenClaw holds credentials in memory (never written to disk)
  -> Injects as env var for skill execution
  -> Env var cleaned up in finally block after skill runs
```

ClosedClaw is a pure CLI tool. No daemon, no proxy, no HTTP server.
Credentials are never stored in plaintext on disk.

## Quick Start

```bash
# Initialize your vault
closedclaw init

# Store credentials (interactive, hidden input)
closedclaw store overseerr-api-key
closedclaw store proxmox-token-id
closedclaw store proxmox-token-secret
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
    "defaults": {
      "exec": "closedclaw"
    },
    "providers": {
      "closedclaw": {
        "source": "exec",
        "command": "/usr/local/bin/closedclaw",
        "args": ["exec-provider", "--passphrase-file", "/root/.closedclaw/passphrase"],
        "jsonOnly": true,
        "timeoutMs": 30000
      }
    }
  }
}
```

### Step 2: Map skills to SecretRef

For single-credential skills (e.g., Overseerr with `primaryEnv: OVERSEERR_API_KEY`):

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

For multi-credential skills (e.g., Uptime Kuma needing username + password),
set system env vars loaded from ClosedClaw at boot via systemd:

```bash
# /etc/systemd/system/closedclaw-env.service
[Service]
Type=oneshot
ExecStart=/bin/bash -c 'echo "UPTIME_KUMA_USERNAME=$(closedclaw get uptime-kuma-username --passphrase-file /root/.closedclaw/passphrase)" >> /etc/openclaw-secrets.env'
ExecStart=/bin/bash -c 'echo "UPTIME_KUMA_PASSWORD=$(closedclaw get uptime-kuma-password --passphrase-file /root/.closedclaw/passphrase)" >> /etc/openclaw-secrets.env'
```

### Exec Provider Protocol

The `exec-provider` command speaks OpenClaw's JSON stdin/stdout protocol:

**Request (stdin):**
```json
{ "protocolVersion": 1, "provider": "closedclaw", "ids": ["overseerr-api-key", "proxmox-token-id"] }
```

**Response (stdout):**
```json
{ "protocolVersion": 1, "values": { "overseerr-api-key": "abc123", "proxmox-token-id": "user@pve!token" } }
```

## CLI Commands

### `closedclaw init`
Initialize a new encrypted vault with a master passphrase.

### `closedclaw store <provider> [key]`
Store a credential. If key is omitted, prompts with hidden input (recommended).

### `closedclaw get <provider>`
Retrieve a single credential value. Outputs raw key to stdout. All errors go to stderr.

### `closedclaw exec-provider`
Run as an OpenClaw exec secret provider. Reads JSON request from stdin, returns JSON response on stdout. Used by OpenClaw's SecretRef system internally.

Options:
- `--passphrase-file <path>` - Read passphrase from a file (must be mode 0600/0400)

### `closedclaw list`
List all stored credential provider names (keys are never displayed).

### `closedclaw delete <provider>`
Remove a stored credential.

### `closedclaw status`
Show vault initialization status and configuration.

### `closedclaw config`
View or update configuration.
- `--auth-profiles-path <path>` - Set path to OpenClaw's auth-profiles.json
- `--openclaw-config <path>` - Set path to OpenClaw config file

### `closedclaw audit`
View recent audit log entries.
- `-n, --limit <number>` - Number of entries to show (default: 20)

## Passphrase Resolution

The passphrase is resolved in this order:
1. `--passphrase-file <path>` flag (file must be mode 0600 or 0400)
2. `CLOSEDCLAW_PASSPHRASE` environment variable
3. Interactive prompt (hidden input)

## Security

| Feature | Description |
|---------|-------------|
| AES-256-GCM | Authenticated encryption for all stored data |
| scrypt KDF | Passphrase-derived keys with high memory cost (N=16384) |
| Secure Permissions | Files created with 0600 mode (owner-only) |
| Memory Safety | Vault locked after every operation |
| No Plaintext | Credentials never written to disk unencrypted |
| Audit Trail | All credential access logged to audit.log |

## File Locations

| File | Location | Purpose |
|------|----------|---------|
| Config | `~/.closedclaw/config.json` | Settings |
| Vault | `~/.closedclaw/vault.enc` | Encrypted credentials |
| Audit | `~/.closedclaw/audit.log` | Access log |
| Passphrase | `~/.closedclaw/passphrase` | Optional passphrase file for non-interactive use |

## Deployment

```bash
# Deploy to OpenClaw LXC
./deploy/deploy.sh
```

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
