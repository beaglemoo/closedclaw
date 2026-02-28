# ClosedClaw

> Encrypted Credential Vault for OpenClaw

ClosedClaw stores API keys and service credentials in an AES-256-GCM encrypted vault. It integrates with OpenClaw's SecretRef system to provide credentials on demand, without storing them in plaintext.

## How It Works

```
OpenClaw skill needs credentials
  -> SecretRef: exec "closedclaw get overseerr-api-key"
  -> ClosedClaw decrypts vault, outputs key to stdout
  -> OpenClaw injects it as env var (e.g., OVERSEERR_API_KEY)
  -> Skill runs with the credential
  -> Env var cleaned up after execution
```

ClosedClaw is a pure CLI tool. No daemon, no proxy, no HTTP server.

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

Configure OpenClaw's `openclaw.json` to use ClosedClaw via SecretRef exec:

```json
{
  "skills": {
    "entries": {
      "overseerr": {
        "env": {
          "OVERSEERR_URL": "http://192.168.0.221:5055",
          "OVERSEERR_API_KEY": {
            "$ref": "exec:closedclaw get overseerr-api-key --passphrase-file /root/.closedclaw/passphrase"
          }
        }
      },
      "proxmox-ops": {
        "env": {
          "PROXMOX_HOST": "https://192.168.0.61:8006",
          "PROXMOX_TOKEN_ID": {
            "$ref": "exec:closedclaw get proxmox-token-id --passphrase-file /root/.closedclaw/passphrase"
          },
          "PROXMOX_TOKEN_SECRET": {
            "$ref": "exec:closedclaw get proxmox-token-secret --passphrase-file /root/.closedclaw/passphrase"
          }
        }
      },
      "uptime-kuma": {
        "env": {
          "UPTIME_KUMA_URL": "http://192.168.0.33:3001",
          "UPTIME_KUMA_USERNAME": {
            "$ref": "exec:closedclaw get uptime-kuma-username --passphrase-file /root/.closedclaw/passphrase"
          },
          "UPTIME_KUMA_PASSWORD": {
            "$ref": "exec:closedclaw get uptime-kuma-password --passphrase-file /root/.closedclaw/passphrase"
          }
        }
      }
    }
  }
}
```

## CLI Commands

### `closedclaw init`
Initialize a new encrypted vault with a master passphrase.

### `closedclaw store <provider> [key]`
Store a credential. If key is omitted, prompts with hidden input (recommended).

### `closedclaw get <provider>`
Retrieve a credential value. Outputs raw key to stdout for SecretRef exec integration. All errors go to stderr.

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
