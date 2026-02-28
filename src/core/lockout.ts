/**
 * ClosedClaw Rate Limiting / Lockout
 * Prevents brute force passphrase attacks with exponential backoff.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from './config.js';

interface LockoutState {
    consecutiveFailures: number;
    lastFailureAt: number;
    lockoutUntil: number;
}

const MAX_ATTEMPTS = 5;
const BASE_LOCKOUT_MS = 30_000; // 30 seconds
const MAX_LOCKOUT_MS = 300_000; // 5 minutes

function getLockoutPath(): string {
    return join(getConfigDir(), 'lockout.json');
}

function loadLockoutState(): LockoutState {
    const path = getLockoutPath();
    if (!existsSync(path)) {
        return { consecutiveFailures: 0, lastFailureAt: 0, lockoutUntil: 0 };
    }

    try {
        const content = readFileSync(path, 'utf8');
        return JSON.parse(content) as LockoutState;
    } catch {
        return { consecutiveFailures: 0, lastFailureAt: 0, lockoutUntil: 0 };
    }
}

function saveLockoutState(state: LockoutState): void {
    writeFileSync(getLockoutPath(), JSON.stringify(state), { mode: 0o600 });
}

/**
 * Check if the vault is currently locked out due to too many failed attempts.
 * Returns null if OK, or number of seconds remaining if locked out.
 */
export function checkLockout(): number | null {
    const state = loadLockoutState();
    const now = Date.now();

    if (state.lockoutUntil > now) {
        return Math.ceil((state.lockoutUntil - now) / 1000);
    }

    return null;
}

/**
 * Record a failed passphrase attempt. May trigger lockout.
 */
export function recordFailure(): void {
    const state = loadLockoutState();
    state.consecutiveFailures += 1;
    state.lastFailureAt = Date.now();

    if (state.consecutiveFailures >= MAX_ATTEMPTS) {
        // Exponential backoff: 30s, 60s, 120s, 240s, 300s (capped)
        const multiplier = Math.pow(2, state.consecutiveFailures - MAX_ATTEMPTS);
        const lockoutDuration = Math.min(BASE_LOCKOUT_MS * multiplier, MAX_LOCKOUT_MS);
        state.lockoutUntil = Date.now() + lockoutDuration;
    }

    saveLockoutState(state);
}

/**
 * Reset lockout state after successful authentication.
 */
export function resetLockout(): void {
    const state: LockoutState = {
        consecutiveFailures: 0,
        lastFailureAt: 0,
        lockoutUntil: 0,
    };
    saveLockoutState(state);
}
