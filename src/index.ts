/**
 * ClosedClaw - Main Entry Point
 */

export { Vault, getVault, type Credential, type VaultData } from './vault/vault.js';
export { encrypt, decrypt, deriveKey, type EncryptedPayload } from './core/encryption.js';
export { loadConfig, saveConfig, type ClosedClawConfig } from './core/config.js';
