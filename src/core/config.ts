/**
 * ClosedClaw Configuration
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface ClosedClawConfig {
    version: number;
    vault: {
        initialized: boolean;
        passphraseHash?: string;
        passphraseSalt?: string;
        verificationPayload?: string; // Encrypted known value for passphrase verification
    };
    daemon: {
        port: number;
        host: string;
        autoStart: boolean;
        pidFile: string;
    };
    openclaw: {
        configPath: string;
        gatewayUrl: string;
        gatewayPort: number;
    };
}

const DEFAULT_CONFIG: ClosedClawConfig = {
    version: 1,
    vault: {
        initialized: false,
    },
    daemon: {
        port: 3847, // CLAW on phone keypad
        host: '127.0.0.1',
        autoStart: false,
        pidFile: 'closedclaw.pid',
    },
    openclaw: {
        configPath: join(homedir(), '.openclaw', 'openclaw.json'),
        gatewayUrl: 'http://127.0.0.1',
        gatewayPort: 3000,
    },
};

export function getConfigDir(): string {
    const dir = join(homedir(), '.closedclaw');
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true, mode: 0o700 }); // Only owner can read/write
    }
    return dir;
}

export function getConfigPath(): string {
    return join(getConfigDir(), 'config.json');
}

export function getVaultPath(): string {
    return join(getConfigDir(), 'vault.enc');
}

export function loadConfig(): ClosedClawConfig {
    const configPath = getConfigPath();

    if (!existsSync(configPath)) {
        return { ...DEFAULT_CONFIG };
    }

    try {
        const content = readFileSync(configPath, 'utf8');
        const loaded = JSON.parse(content);
        return { ...DEFAULT_CONFIG, ...loaded };
    } catch {
        return { ...DEFAULT_CONFIG };
    }
}

export function saveConfig(config: ClosedClawConfig): void {
    const configPath = getConfigPath();
    writeFileSync(configPath, JSON.stringify(config, null, 2), {
        mode: 0o600, // Only owner can read/write
    });
}

export function isVaultInitialized(): boolean {
    const config = loadConfig();
    return config.vault.initialized && existsSync(getVaultPath());
}
