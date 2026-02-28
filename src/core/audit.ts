/**
 * ClosedClaw Audit Logger
 * Logs credential access events to ~/.closedclaw/audit.log
 */

import { appendFileSync, existsSync, lstatSync, readFileSync } from 'node:fs';
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
 * Verify the audit log file is safe to write to.
 * Returns false if the file is a symlink or has wrong permissions.
 */
function verifyAuditLogSafety(logPath: string): boolean {
    if (!existsSync(logPath)) {
        return true; // Will be created with correct permissions
    }

    try {
        const stats = lstatSync(logPath);

        // Reject symlinks
        if (stats.isSymbolicLink()) {
            process.stderr.write('Warning: Audit log is a symlink. Refusing to write.\n');
            return false;
        }

        // Reject if group/other have any access
        if ((stats.mode & 0o077) !== 0) {
            process.stderr.write('Warning: Audit log has insecure permissions. Refusing to write.\n');
            return false;
        }

        return true;
    } catch {
        return false;
    }
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
    const logPath = getAuditLogPath();

    try {
        if (!verifyAuditLogSafety(logPath)) {
            return;
        }
        appendFileSync(logPath, line, { mode: 0o600 });
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
