#!/bin/bash
# ClosedClaw Deployment Script
# Deploys ClosedClaw to the OpenClaw LXC container

set -euo pipefail

TARGET_HOST="root@192.168.0.226"
TARGET_DIR="/opt/closedclaw"
RSYNC="/opt/homebrew/bin/rsync"
SYMLINK="/usr/local/bin/closedclaw"

echo "ClosedClaw Deployment"
echo "====================="
echo ""
echo "Target: ${TARGET_HOST}:${TARGET_DIR}"
echo ""

# Step 1: Build
echo "[1/5] Building project..."
npm run build
echo "  Build complete."

# Step 2: Sync to target
echo "[2/5] Syncing to ${TARGET_HOST}:${TARGET_DIR}..."
${RSYNC} -avz --delete \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='src' \
    --exclude='tsconfig.json' \
    --exclude='tsup.config.ts' \
    --info=progress2 \
    ./ "${TARGET_HOST}:${TARGET_DIR}/"
echo "  Sync complete."

# Step 3: Install production dependencies and fix ownership on target
echo "[3/5] Installing production dependencies on target..."
ssh ${TARGET_HOST} "chown -R root:root ${TARGET_DIR} && cd ${TARGET_DIR} && npm install --production --ignore-scripts 2>&1 | tail -3"
echo "  Dependencies installed."

# Step 4: Create symlink
echo "[4/5] Creating symlink..."
ssh ${TARGET_HOST} "chmod +x ${TARGET_DIR}/bin/closedclaw.js && ln -sf ${TARGET_DIR}/bin/closedclaw.js ${SYMLINK}"
echo "  Symlink created: ${SYMLINK} -> ${TARGET_DIR}/bin/closedclaw.js"

# Step 5: Verify
echo "[5/5] Verifying installation..."
ssh ${TARGET_HOST} "closedclaw --version"
echo ""

# Check if vault is initialized
VAULT_STATUS=$(ssh ${TARGET_HOST} "closedclaw status 2>&1" || true)
if echo "${VAULT_STATUS}" | grep -q "Initialized: No"; then
    echo "Vault is not initialized on the target."
    echo "SSH into the target and run: closedclaw init"
    echo ""
    echo "Then store your credentials:"
    echo "  closedclaw store overseerr-api-key"
    echo "  closedclaw store proxmox-token-id"
    echo "  closedclaw store proxmox-token-secret"
    echo "  closedclaw store uptime-kuma-username"
    echo "  closedclaw store uptime-kuma-password"
else
    echo "Vault is already initialized."
fi

echo ""
echo "Deployment complete."
