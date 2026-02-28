/**
 * ClosedClaw Daemon - Proxy Server
 * Intercepts requests to OpenClaw and injects credentials from vault
 */

import http from 'node:http';
import httpProxy from 'http-proxy';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir, loadConfig, saveConfig } from '../core/config.js';
import { getVault } from '../vault/vault.js';

export interface DaemonStatus {
    running: boolean;
    pid?: number;
    port?: number;
    uptime?: number;
    startedAt?: number;
}

/**
 * Get PID file path
 */
function getPidFilePath(): string {
    const config = loadConfig();
    return join(getConfigDir(), config.daemon.pidFile);
}

/**
 * Check if daemon is running
 */
export function isDaemonRunning(): boolean {
    const pidPath = getPidFilePath();
    if (!existsSync(pidPath)) return false;

    try {
        const pid = parseInt(readFileSync(pidPath, 'utf8'), 10);
        // Check if process exists
        process.kill(pid, 0);
        return true;
    } catch {
        // Process doesn't exist, clean up stale PID file
        try {
            unlinkSync(pidPath);
        } catch { }
        return false;
    }
}

/**
 * Get daemon status
 */
export function getDaemonStatus(): DaemonStatus {
    if (!isDaemonRunning()) {
        return { running: false };
    }

    const pidPath = getPidFilePath();
    const pid = parseInt(readFileSync(pidPath, 'utf8'), 10);
    const config = loadConfig();

    return {
        running: true,
        pid,
        port: config.daemon.port,
    };
}

/**
 * Create the proxy server
 */
export function createProxyServer(passphrase: string): http.Server {
    const config = loadConfig();
    const vault = getVault();

    // Unlock vault
    if (!vault.isInitialized()) {
        throw new Error('Vault is not initialized. Run "closedclaw init" first.');
    }

    if (!vault.unlock(passphrase)) {
        throw new Error('Invalid passphrase. Could not unlock vault.');
    }

    // Create proxy to OpenClaw gateway
    const proxy = httpProxy.createProxyServer({
        target: `${config.openclaw.gatewayUrl}:${config.openclaw.gatewayPort}`,
        changeOrigin: true,
    });

    // Handle proxy errors
    proxy.on('error', (err, _req, res) => {
        console.error('[ClosedClaw] Proxy error:', err.message);
        if (res instanceof http.ServerResponse && !res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Proxy error', message: err.message }));
        }
    });

    // Create HTTP server
    const server = http.createServer((req, res) => {
        // Health check endpoint
        if (req.url === '/_closedclaw/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'ok',
                version: '0.1.0',
                vault: {
                    initialized: vault.isInitialized(),
                    unlocked: vault.isUnlocked(),
                    providers: vault.listProviders().length,
                },
            }));
            return;
        }

        // List stored credentials (providers only, not keys)
        if (req.url === '/_closedclaw/credentials') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                providers: vault.listProviders(),
            }));
            return;
        }

        // For all other requests, forward to OpenClaw

        // Forward all other requests to OpenClaw
        proxy.web(req, res);
    });

    // Handle WebSocket upgrades
    server.on('upgrade', (req, socket, head) => {
        proxy.ws(req, socket, head);
    });

    return server;
}

/**
 * Start the daemon
 */
export async function startDaemon(passphrase: string): Promise<void> {
    if (isDaemonRunning()) {
        throw new Error('Daemon is already running');
    }

    const config = loadConfig();
    const server = createProxyServer(passphrase);

    return new Promise((resolve, reject) => {
        server.listen(config.daemon.port, config.daemon.host, () => {
            // Write PID file
            writeFileSync(getPidFilePath(), process.pid.toString(), { mode: 0o600 });

            console.log(`[ClosedClaw] Daemon started on ${config.daemon.host}:${config.daemon.port}`);
            console.log(`[ClosedClaw] Proxying to OpenClaw at ${config.openclaw.gatewayUrl}:${config.openclaw.gatewayPort}`);

            resolve();
        });

        server.on('error', (err) => {
            reject(err);
        });
    });
}

/**
 * Stop the daemon
 */
export function stopDaemon(): boolean {
    const pidPath = getPidFilePath();
    if (!existsSync(pidPath)) {
        return false;
    }

    try {
        const pid = parseInt(readFileSync(pidPath, 'utf8'), 10);
        process.kill(pid, 'SIGTERM');
        unlinkSync(pidPath);
        return true;
    } catch {
        try {
            unlinkSync(pidPath);
        } catch { }
        return false;
    }
}
