/**
 * ClosedClaw Audit Logger
 * Logs credential access events to ~/.closedclaw/audit.log
 */

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from './config.js';

export type AuditAction =
    | 'vault_init'
    | 'vault_unlock'
    | 'vault_lock'
    | 'credential_store'
    | 'credential_get'
    | 'credential_delete'
    | 'credential_list';

interface AuditEntry {
    timestamp: string;
    action: AuditAction;
    provider?: string;
    detail?: string;
}

function getAuditLogPath(): string {
    return join(getConfigDir(), 'audit.log');
}

/**
 * Log an audit event
 */
export function auditLog(action: AuditAction, provider?: string, detail?: string): void {
    const entry: AuditEntry = {
        timestamp: new Date().toISOString(),
        action,
        provider,
        detail,
    };

    const line = JSON.stringify(entry) + '\n';

    try {
        appendFileSync(getAuditLogPath(), line, { mode: 0o600 });
    } catch {
        // Audit logging should never prevent normal operation
    }
}

/**
 * Read recent audit log entries
 */
export function readAuditLog(limit: number = 50): AuditEntry[] {
    const logPath = getAuditLogPath();

    if (!existsSync(logPath)) {
        return [];
    }

    try {
        const content = readFileSync(logPath, 'utf8');
        const lines = content.trim().split('\n').filter(Boolean);
        const entries = lines
            .map(line => {
                try {
                    return JSON.parse(line) as AuditEntry;
                } catch {
                    return null;
                }
            })
            .filter((entry): entry is AuditEntry => entry !== null);

        return entries.slice(-limit);
    } catch {
        return [];
    }
}
