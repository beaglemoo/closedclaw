/**
 * ClosedClaw Encryption Module
 * AES-256-GCM encryption for secure credential storage
 */

import {
    createCipheriv,
    createDecipheriv,
    randomBytes,
    scryptSync,
    timingSafeEqual,
} from 'node:crypto';

export interface EncryptedPayload {
    version: number;
    iv: string;
    salt: string;
    data: string;
    tag: string;
}

export interface EncryptionConfig {
    algorithm: 'aes-256-gcm';
    keyLength: 32;
    ivLength: 16;
    saltLength: 32;
    tagLength: 16;
}

const DEFAULT_CONFIG: EncryptionConfig = {
    algorithm: 'aes-256-gcm',
    keyLength: 32,
    ivLength: 16,
    saltLength: 32,
    tagLength: 16,
};

/**
 * Derive encryption key from passphrase using scrypt
 */
export function deriveKey(
    passphrase: string,
    salt: Buffer,
    keyLength: number = DEFAULT_CONFIG.keyLength
): Buffer {
    return scryptSync(passphrase, salt, keyLength, {
        N: 16384, // CPU/memory cost parameter
        r: 8,     // Block size
        p: 1,     // Parallelization
    });
}

/**
 * Encrypt data using AES-256-GCM
 */
export function encrypt(data: string, passphrase: string): EncryptedPayload {
    const salt = randomBytes(DEFAULT_CONFIG.saltLength);
    const iv = randomBytes(DEFAULT_CONFIG.ivLength);
    const key = deriveKey(passphrase, salt, DEFAULT_CONFIG.keyLength);

    const cipher = createCipheriv(DEFAULT_CONFIG.algorithm, key, iv, {
        authTagLength: DEFAULT_CONFIG.tagLength,
    });

    const encrypted = Buffer.concat([
        cipher.update(data, 'utf8'),
        cipher.final(),
    ]);

    return {
        version: 1,
        iv: iv.toString('hex'),
        salt: salt.toString('hex'),
        data: encrypted.toString('hex'),
        tag: cipher.getAuthTag().toString('hex'),
    };
}

/**
 * Decrypt data using AES-256-GCM
 */
export function decrypt(payload: EncryptedPayload, passphrase: string): string {
    const salt = Buffer.from(payload.salt, 'hex');
    const iv = Buffer.from(payload.iv, 'hex');
    const encryptedData = Buffer.from(payload.data, 'hex');
    const authTag = Buffer.from(payload.tag, 'hex');
    const key = deriveKey(passphrase, salt, DEFAULT_CONFIG.keyLength);

    const decipher = createDecipheriv(DEFAULT_CONFIG.algorithm, key, iv, {
        authTagLength: DEFAULT_CONFIG.tagLength,
    });

    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
        decipher.update(encryptedData),
        decipher.final(),
    ]);

    return decrypted.toString('utf8');
}

/**
 * Generate a random master key for new vault initialization
 */
export function generateMasterKey(): string {
    return randomBytes(32).toString('hex');
}

/**
 * Verify passphrase by attempting to decrypt a known value
 */
export function verifyPassphrase(
    payload: EncryptedPayload,
    passphrase: string
): boolean {
    try {
        decrypt(payload, passphrase);
        return true;
    } catch {
        return false;
    }
}

/**
 * Hash passphrase for storage (to verify without decrypting)
 */
export function hashPassphrase(passphrase: string): { hash: string; salt: string } {
    const salt = randomBytes(32);
    const hash = scryptSync(passphrase, salt, 64);
    return {
        hash: hash.toString('hex'),
        salt: salt.toString('hex'),
    };
}

/**
 * Verify passphrase hash
 */
export function verifyPassphraseHash(
    passphrase: string,
    storedHash: string,
    storedSalt: string
): boolean {
    const salt = Buffer.from(storedSalt, 'hex');
    const expectedHash = Buffer.from(storedHash, 'hex');
    const actualHash = scryptSync(passphrase, salt, 64);
    return timingSafeEqual(expectedHash, actualHash);
}
