# 🔐 ClosedClaw

> **Encrypted Credential Vault & Security Layer for OpenClaw**

ClosedClaw protects your API keys and sensitive credentials by storing them in an AES-256-GCM encrypted vault. It runs as a daemon that sits between you and OpenClaw, injecting credentials at runtime without ever storing them in plaintext.

## 🚀 Quick Start

```bash
# Install globally
npm install -g closedclaw

# Initialize your vault
closedclaw init

# Store your API keys
closedclaw store anthropic sk-ant-api03-xxxxx
closedclaw store openai sk-xxxxx
closedclaw store elevenlabs xxxxx

# Start the daemon
closedclaw start

# Check status
closedclaw status
```

## 📖 How It Works

```
┌──────────────┐      ┌───────────────┐      ┌──────────────┐
│   You/Apps   │ ───▶ │  ClosedClaw   │ ───▶ │   OpenClaw   │
│              │      │   (Daemon)    │      │   Gateway    │
└──────────────┘      └───────────────┘      └──────────────┘
                              │
                              ▼
                      ┌───────────────┐
                      │  Encrypted    │
                      │    Vault      │
                      │  (AES-256)    │
                      └───────────────┘
```

1. **Initialize**: Create an encrypted vault with your master passphrase
2. **Store**: Add API keys - they're encrypted immediately
3. **Start**: Launch the daemon, unlock with your passphrase
4. **Use**: The daemon injects credentials into OpenClaw requests

## 🛡️ Security Features

| Feature | Description |
|---------|-------------|
| **AES-256-GCM** | Military-grade encryption for all stored data |
| **scrypt KDF** | Passphrase-derived keys with high memory cost |
| **Secure Permissions** | Files created with 0600 mode (owner-only) |
| **Memory Safety** | Credentials cleared from memory when locked |
| **No Plaintext** | API keys never written to disk unencrypted |

## 📋 CLI Commands

### `closedclaw init`
Initialize a new encrypted vault. You'll create a master passphrase.

### `closedclaw store <provider> <key>`
Store an API key for a provider (e.g., `anthropic`, `openai`, `elevenlabs`).

### `closedclaw list`
List all stored providers (keys are never displayed).

### `closedclaw delete <provider>`
Remove a stored credential.

### `closedclaw start [-f|--foreground]`
Start the daemon. Use `-f` to run in foreground.

### `closedclaw stop`
Stop the running daemon.

### `closedclaw status`
Show vault and daemon status.

### `closedclaw config [options]`
View or update configuration.
- `--daemon-port <port>`: Set ClosedClaw's port (default: 3847)
- `--openclaw-port <port>`: Set OpenClaw gateway port (default: 3000)

## ⚙️ Configuration

ClosedClaw stores its config at `~/.closedclaw/config.json`:

```json
{
  "daemon": {
    "port": 3847,
    "host": "127.0.0.1"
  },
  "openclaw": {
    "gatewayUrl": "http://127.0.0.1",
    "gatewayPort": 3000
  }
}
```

## 🔧 Integration with OpenClaw

Update your OpenClaw configuration to use ClosedClaw as the gateway:

```json
{
  "gateway": {
    "port": 3847
  }
}
```

Or set the environment variable:
```bash
export OPENCLAW_GATEWAY_URL=http://127.0.0.1:3847
```

## 📁 File Locations

| File | Location | Purpose |
|------|----------|---------|
| Config | `~/.closedclaw/config.json` | Settings & preferences |
| Vault | `~/.closedclaw/vault.enc` | Encrypted credentials |
| PID | `~/.closedclaw/closedclaw.pid` | Daemon process ID |

## 🏗️ Development

```bash
# Clone the repo
git clone https://github.com/closedclaw/closedclaw.git
cd closedclaw

# Install dependencies
pnpm install

# Run in dev mode
pnpm dev

# Build
pnpm build

# Test
pnpm test
```

## 📜 License

MIT © ClosedClaw Team

---

<p align="center">
  <b>🦞 OpenClaw + 🔐 ClosedClaw = Secure AI</b>
</p>
