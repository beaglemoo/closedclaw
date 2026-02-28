import { describe, it, expect } from 'vitest';
import {
    encrypt,
    decrypt,
    deriveKey,
    hashPassphrase,
    verifyPassphrase,
    verifyPassphraseHash,
} from '../encryption.js';

describe('encrypt / decrypt', () => {
    const passphrase = 'test-passphrase-12345';

    it('round-trips plaintext correctly', () => {
        const plaintext = 'Hello, ClosedClaw!';
        const payload = encrypt(plaintext, passphrase);
        const result = decrypt(payload, passphrase);
        expect(result).toBe(plaintext);
    });

    it('handles empty string', () => {
        const payload = encrypt('', passphrase);
        const result = decrypt(payload, passphrase);
        expect(result).toBe('');
    });

    it('handles JSON data', () => {
        const data = JSON.stringify({ key: 'sk-test-123', provider: 'openrouter' });
        const payload = encrypt(data, passphrase);
        const result = decrypt(payload, passphrase);
        expect(JSON.parse(result)).toEqual({ key: 'sk-test-123', provider: 'openrouter' });
    });

    it('handles unicode and special characters', () => {
        const plaintext = 'p@$$w0rd!#%^&*()_+-=[]{}|;:,.<>?/~`';
        const payload = encrypt(plaintext, passphrase);
        const result = decrypt(payload, passphrase);
        expect(result).toBe(plaintext);
    });

    it('produces different ciphertext each time (unique salt/IV)', () => {
        const plaintext = 'same data';
        const payload1 = encrypt(plaintext, passphrase);
        const payload2 = encrypt(plaintext, passphrase);
        expect(payload1.data).not.toBe(payload2.data);
        expect(payload1.salt).not.toBe(payload2.salt);
        expect(payload1.iv).not.toBe(payload2.iv);
    });

    it('fails to decrypt with wrong passphrase', () => {
        const payload = encrypt('secret', passphrase);
        expect(() => decrypt(payload, 'wrong-passphrase')).toThrow();
    });

    it('fails to decrypt with tampered data', () => {
        const payload = encrypt('secret', passphrase);
        payload.data = payload.data.replace(/^./, 'f');
        expect(() => decrypt(payload, passphrase)).toThrow();
    });

    it('fails to decrypt with tampered auth tag', () => {
        const payload = encrypt('secret', passphrase);
        payload.tag = payload.tag.replace(/^./, 'f');
        expect(() => decrypt(payload, passphrase)).toThrow();
    });

    it('includes version number in payload', () => {
        const payload = encrypt('test', passphrase);
        expect(payload.version).toBe(1);
    });
});

describe('deriveKey', () => {
    it('produces consistent keys for same inputs', () => {
        const salt = Buffer.from('a'.repeat(64), 'hex');
        const key1 = deriveKey('passphrase', salt);
        const key2 = deriveKey('passphrase', salt);
        expect(key1.equals(key2)).toBe(true);
    });

    it('produces different keys for different passphrases', () => {
        const salt = Buffer.from('a'.repeat(64), 'hex');
        const key1 = deriveKey('passphrase1', salt);
        const key2 = deriveKey('passphrase2', salt);
        expect(key1.equals(key2)).toBe(false);
    });

    it('produces different keys for different salts', () => {
        const salt1 = Buffer.from('a'.repeat(64), 'hex');
        const salt2 = Buffer.from('b'.repeat(64), 'hex');
        const key1 = deriveKey('passphrase', salt1);
        const key2 = deriveKey('passphrase', salt2);
        expect(key1.equals(key2)).toBe(false);
    });

    it('produces 32-byte keys by default', () => {
        const salt = Buffer.from('a'.repeat(64), 'hex');
        const key = deriveKey('passphrase', salt);
        expect(key.length).toBe(32);
    });
});

describe('hashPassphrase / verifyPassphraseHash', () => {
    it('verifies correct passphrase', () => {
        const { hash, salt } = hashPassphrase('my-passphrase');
        expect(verifyPassphraseHash('my-passphrase', hash, salt)).toBe(true);
    });

    it('rejects wrong passphrase', () => {
        const { hash, salt } = hashPassphrase('my-passphrase');
        expect(verifyPassphraseHash('wrong-passphrase', hash, salt)).toBe(false);
    });

    it('produces different hashes for different passphrases', () => {
        const result1 = hashPassphrase('passphrase1');
        const result2 = hashPassphrase('passphrase2');
        expect(result1.hash).not.toBe(result2.hash);
    });

    it('produces different salts each time', () => {
        const result1 = hashPassphrase('same-passphrase');
        const result2 = hashPassphrase('same-passphrase');
        expect(result1.salt).not.toBe(result2.salt);
    });
});

describe('verifyPassphrase', () => {
    it('returns true for correct passphrase', () => {
        const payload = encrypt('CLOSEDCLAW_VAULT_OK', 'correct');
        expect(verifyPassphrase(payload, 'correct')).toBe(true);
    });

    it('returns false for wrong passphrase', () => {
        const payload = encrypt('CLOSEDCLAW_VAULT_OK', 'correct');
        expect(verifyPassphrase(payload, 'wrong')).toBe(false);
    });
});
