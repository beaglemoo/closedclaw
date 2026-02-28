/**
 * ClosedClaw Vault - Encrypted Credential Storage
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
    decrypt,
    encrypt,
    hashPassphrase,
    verifyPassphrase,
    verifyPassphraseHash,
    type EncryptedPayload,
} from '../core/encryption.js';
import {
    getVaultPath,
    loadConfig,
    saveConfig,
} from '../core/config.js';

export interface Credential {
    provider: string;
    key: string;
    createdAt: number;
    updatedAt: number;
    metadata?: Record<string, string>;
}

export interface VaultData {
    version: number;
    credentials: Credential[];
    metadata: {
        createdAt: number;
        lastModified: number;
    };
}

const VERIFICATION_VALUE = 'CLOSEDCLAW_VAULT_OK';

export class Vault {
    private unlocked: boolean = false;
    private passphrase: string | null = null;
    private data: VaultData | null = null;

    /**
     * Check if vault is initialized
     */
    isInitialized(): boolean {
        const config = loadConfig();
        return config.vault.initialized && existsSync(getVaultPath());
    }

    /**
     * Check if vault is currently unlocked
     */
    isUnlocked(): boolean {
        return this.unlocked && this.data !== null;
    }

    /**
     * Initialize a new vault with a passphrase
     */
    initialize(passphrase: string): void {
        if (this.isInitialized()) {
            throw new Error('Vault is already initialized. Use reset() to reinitialize.');
        }

        // Create empty vault data
        const now = Date.now();
        const vaultData: VaultData = {
            version: 1,
            credentials: [],
            metadata: {
                createdAt: now,
                lastModified: now,
            },
        };

        // Encrypt and save vault
        const encrypted = encrypt(JSON.stringify(vaultData), passphrase);
        writeFileSync(getVaultPath(), JSON.stringify(encrypted), {
            mode: 0o600,
        });

        // Create verification payload
        const verificationPayload = encrypt(VERIFICATION_VALUE, passphrase);

        // Hash passphrase for quick verification
        const { hash, salt } = hashPassphrase(passphrase);

        // Update config
        const config = loadConfig();
        config.vault.initialized = true;
        config.vault.passphraseHash = hash;
        config.vault.passphraseSalt = salt;
        config.vault.verificationPayload = JSON.stringify(verificationPayload);
        saveConfig(config);

        // Auto-unlock after initialization
        this.passphrase = passphrase;
        this.data = vaultData;
        this.unlocked = true;
    }

    /**
     * Unlock the vault with passphrase
     */
    unlock(passphrase: string): boolean {
        if (!this.isInitialized()) {
            throw new Error('Vault is not initialized. Call initialize() first.');
        }

        // Quick check using passphrase hash
        const config = loadConfig();
        if (config.vault.passphraseHash && config.vault.passphraseSalt) {
            if (!verifyPassphraseHash(passphrase, config.vault.passphraseHash, config.vault.passphraseSalt)) {
                return false;
            }
        }

        // Verify by decrypting verification payload
        if (config.vault.verificationPayload) {
            const payload: EncryptedPayload = JSON.parse(config.vault.verificationPayload);
            if (!verifyPassphrase(payload, passphrase)) {
                return false;
            }
        }

        // Load and decrypt vault data
        try {
            const encryptedContent = readFileSync(getVaultPath(), 'utf8');
            const payload: EncryptedPayload = JSON.parse(encryptedContent);
            const decrypted = decrypt(payload, passphrase);
            this.data = JSON.parse(decrypted);
            this.passphrase = passphrase;
            this.unlocked = true;
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Lock the vault
     */
    lock(): void {
        this.unlocked = false;
        this.passphrase = null;
        this.data = null;
    }

    /**
     * Store a credential
     */
    storeCredential(provider: string, key: string, metadata?: Record<string, string>): void {
        this.ensureUnlocked();

        const now = Date.now();
        const existing = this.data!.credentials.find(c => c.provider === provider);

        if (existing) {
            existing.key = key;
            existing.updatedAt = now;
            existing.metadata = metadata;
        } else {
            this.data!.credentials.push({
                provider,
                key,
                createdAt: now,
                updatedAt: now,
                metadata,
            });
        }

        this.data!.metadata.lastModified = now;
        this.saveVault();
    }

    /**
     * Get a credential by provider
     */
    getCredential(provider: string): Credential | null {
        this.ensureUnlocked();
        return this.data!.credentials.find(c => c.provider === provider) ?? null;
    }

    /**
     * List all stored providers
     */
    listProviders(): string[] {
        this.ensureUnlocked();
        return this.data!.credentials.map(c => c.provider);
    }

    /**
     * Delete a credential
     */
    deleteCredential(provider: string): boolean {
        this.ensureUnlocked();
        const index = this.data!.credentials.findIndex(c => c.provider === provider);
        if (index === -1) return false;

        this.data!.credentials.splice(index, 1);
        this.data!.metadata.lastModified = Date.now();
        this.saveVault();
        return true;
    }

    /**
     * Get all credentials (for injection into OpenClaw config)
     */
    getAllCredentials(): Credential[] {
        this.ensureUnlocked();
        return [...this.data!.credentials];
    }

    /**
     * Export credentials as provider -> key map
     */
    exportAsMap(): Record<string, string> {
        this.ensureUnlocked();
        const map: Record<string, string> = {};
        for (const cred of this.data!.credentials) {
            map[cred.provider] = cred.key;
        }
        return map;
    }

    /**
     * Change vault passphrase
     */
    changePassphrase(oldPassphrase: string, newPassphrase: string): boolean {
        if (!this.unlock(oldPassphrase)) {
            return false;
        }

        // Re-encrypt with new passphrase
        const encrypted = encrypt(JSON.stringify(this.data), newPassphrase);
        writeFileSync(getVaultPath(), JSON.stringify(encrypted), {
            mode: 0o600,
        });

        // Update verification and hash
        const verificationPayload = encrypt(VERIFICATION_VALUE, newPassphrase);
        const { hash, salt } = hashPassphrase(newPassphrase);

        const config = loadConfig();
        config.vault.passphraseHash = hash;
        config.vault.passphraseSalt = salt;
        config.vault.verificationPayload = JSON.stringify(verificationPayload);
        saveConfig(config);

        this.passphrase = newPassphrase;
        return true;
    }

    private ensureUnlocked(): void {
        if (!this.unlocked || !this.data) {
            throw new Error('Vault is locked. Call unlock() first.');
        }
    }

    private saveVault(): void {
        if (!this.passphrase || !this.data) return;

        const encrypted = encrypt(JSON.stringify(this.data), this.passphrase);
        writeFileSync(getVaultPath(), JSON.stringify(encrypted), {
            mode: 0o600,
        });
    }
}

// Singleton instance
let vaultInstance: Vault | null = null;

export function getVault(): Vault {
    if (!vaultInstance) {
        vaultInstance = new Vault();
    }
    return vaultInstance;
}
