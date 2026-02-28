#!/usr/bin/env node
/**
 * Integration test for ClosedClaw
 * Tests vault operations, get command, and exec-provider protocol
 */

import { execSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_DIR = join(tmpdir(), 'closedclaw-test-' + Date.now());
const PASSPHRASE = 'test-passphrase-secure-123';
const CLI = join(import.meta.dirname, 'dist', 'cli.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`  [PASS] ${name}`);
        passed++;
    } catch (err) {
        console.log(`  [FAIL] ${name}`);
        console.log(`         ${err.message}`);
        failed++;
    }
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function run(args, opts = {}) {
    const env = {
        ...process.env,
        HOME: TEST_DIR,
        CLOSEDCLAW_PASSPHRASE: opts.passphrase ?? PASSPHRASE,
        NO_COLOR: '1',       // Strip chalk colors from output
        FORCE_COLOR: '0',    // Disable ora spinner colors
    };
    if (opts.noPassphrase) delete env.CLOSEDCLAW_PASSPHRASE;

    return execFileSync('node', [CLI, ...args], {
        env,
        input: opts.stdin,
        encoding: 'utf8',
        timeout: 30000,
    }).trim();
}

// Setup
console.log('\nClosedClaw Integration Tests');
console.log('============================\n');
console.log(`Test dir: ${TEST_DIR}`);
mkdirSync(TEST_DIR, { recursive: true });

// Passphrase file path (created after vault init)
const closedclawDir = join(TEST_DIR, '.closedclaw');
const passphraseFile = join(closedclawDir, 'passphrase');

// ---- Test: Vault initialization (using API directly) ----
console.log('\n1. Vault Operations\n');

// Initialize vault programmatically using a temp script file
test('Initialize vault', () => {
    const initScriptPath = join(TEST_DIR, 'init-vault.mjs');
    const initScript = `
import { Vault } from '${CLI.replace('cli.js', 'index.js')}';
process.env.HOME = '${TEST_DIR}';
const vault = new Vault();
vault.initialize('${PASSPHRASE}');
vault.lock();
console.log('OK');
`;
    writeFileSync(initScriptPath, initScript);
    const result = execFileSync('node', [initScriptPath], {
        encoding: 'utf8',
        env: { ...process.env, HOME: TEST_DIR },
        timeout: 30000,
    }).trim();
    assert(result === 'OK', `Expected OK, got: ${result}`);
});

// Create passphrase file after vault init (so the .closedclaw dir exists)
test('Create passphrase file', () => {
    assert(existsSync(closedclawDir), `.closedclaw dir should exist after init`);
    writeFileSync(passphraseFile, PASSPHRASE, { mode: 0o600 });
    assert(existsSync(passphraseFile), 'Passphrase file should exist');
});

test('Status shows initialized', () => {
    const out = run(['status']);
    assert(out.includes('Initialized') && out.includes('Yes'), `Vault should be initialized. Got: ${out}`);
});

// ---- Test: Store and retrieve credentials ----
console.log('\n2. Store and Retrieve\n');

test('Store credential: overseerr-api-key', () => {
    const out = run(['store', 'overseerr-api-key', 'test-overseerr-key-abc123']);
    assert(out.includes('stored') || out.includes('encrypted') || out.includes('saved'),
        `Unexpected output: ${out}`);
});

test('Store credential: proxmox-token-id', () => {
    const out = run(['store', 'proxmox-token-id', 'openclaw@pve!reboot']);
    assert(out.includes('stored') || out.includes('encrypted') || out.includes('saved'),
        `Unexpected output: ${out}`);
});

test('Store credential: uptime-kuma-password', () => {
    const out = run(['store', 'uptime-kuma-password', 's3cret-p@ss']);
    assert(out.includes('stored') || out.includes('encrypted') || out.includes('saved'),
        `Unexpected output: ${out}`);
});

test('List shows all 3 providers', () => {
    const out = run(['list']);
    assert(out.includes('overseerr-api-key'), 'Missing overseerr-api-key');
    assert(out.includes('proxmox-token-id'), 'Missing proxmox-token-id');
    assert(out.includes('uptime-kuma-password'), 'Missing uptime-kuma-password');
});

// ---- Test: Get command ----
console.log('\n3. Get Command (raw stdout)\n');

test('Get returns raw credential value', () => {
    const out = run(['get', 'overseerr-api-key']);
    assert(out === 'test-overseerr-key-abc123', `Expected key, got: "${out}"`);
});

test('Get with special characters', () => {
    const out = run(['get', 'uptime-kuma-password']);
    assert(out === 's3cret-p@ss', `Expected password, got: "${out}"`);
});

test('Get nonexistent credential returns error', () => {
    try {
        run(['get', 'nonexistent']);
        throw new Error('Should have thrown');
    } catch (err) {
        if (err.message === 'Should have thrown') throw err;
        assert(err.status === 1, `Should exit with code 1, got: ${err.status}`);
    }
});

// ---- Test: Get with --passphrase-file ----
console.log('\n4. Passphrase File\n');

test('Get with --passphrase-file works', () => {
    const out = run(['get', 'overseerr-api-key', '--passphrase-file', passphraseFile], { noPassphrase: true });
    assert(out === 'test-overseerr-key-abc123', `Expected key, got: "${out}"`);
});

test('Get rejects passphrase file with wrong permissions', () => {
    const badFile = join(TEST_DIR, 'bad-passphrase');
    writeFileSync(badFile, PASSPHRASE, { mode: 0o644 });
    try {
        run(['get', 'overseerr-api-key', '--passphrase-file', badFile], { noPassphrase: true });
        throw new Error('Should have thrown');
    } catch (err) {
        if (err.message === 'Should have thrown') throw err;
        assert(err.status === 1, `Should exit with code 1, got: ${err.status}`);
    }
});

// ---- Test: Exec provider protocol ----
console.log('\n5. Exec Provider (JSON protocol)\n');

test('Exec provider: single credential', () => {
    const request = JSON.stringify({
        protocolVersion: 1,
        provider: 'closedclaw',
        ids: ['overseerr-api-key'],
    });
    const out = run(['exec-provider', '--passphrase-file', passphraseFile], { stdin: request, noPassphrase: true });
    const response = JSON.parse(out);
    assert(response.protocolVersion === 1, 'Wrong protocol version');
    assert(response.values['overseerr-api-key'] === 'test-overseerr-key-abc123', 'Wrong value');
});

test('Exec provider: batch credentials', () => {
    const request = JSON.stringify({
        protocolVersion: 1,
        provider: 'closedclaw',
        ids: ['overseerr-api-key', 'proxmox-token-id', 'uptime-kuma-password'],
    });
    const out = run(['exec-provider', '--passphrase-file', passphraseFile], { stdin: request, noPassphrase: true });
    const response = JSON.parse(out);
    assert(Object.keys(response.values).length === 3, `Expected 3 values, got ${Object.keys(response.values).length}`);
    assert(response.values['overseerr-api-key'] === 'test-overseerr-key-abc123', 'Wrong overseerr value');
    assert(response.values['proxmox-token-id'] === 'openclaw@pve!reboot', 'Wrong proxmox value');
    assert(response.values['uptime-kuma-password'] === 's3cret-p@ss', 'Wrong uptime-kuma value');
});

test('Exec provider: missing credential returns error', () => {
    const request = JSON.stringify({
        protocolVersion: 1,
        provider: 'closedclaw',
        ids: ['overseerr-api-key', 'nonexistent-key'],
    });
    const out = run(['exec-provider', '--passphrase-file', passphraseFile], { stdin: request, noPassphrase: true });
    const response = JSON.parse(out);
    assert(response.values['overseerr-api-key'] === 'test-overseerr-key-abc123', 'Should return found key');
    assert(response.errors?.['nonexistent-key']?.message === 'Secret not found', 'Should report missing key');
});

test('Exec provider: invalid JSON request', () => {
    try {
        run(['exec-provider', '--passphrase-file', passphraseFile], { stdin: 'not json', noPassphrase: true });
        throw new Error('Should have thrown');
    } catch (err) {
        if (err.message === 'Should have thrown') throw err;
        assert(err.status === 1, `Should exit with code 1, got: ${err.status}`);
    }
});

// ---- Test: Delete ----
console.log('\n6. Delete\n');

test('Delete credential', () => {
    const out = run(['delete', 'uptime-kuma-password']);
    assert(out.includes('deleted'), `Unexpected output: ${out}`);
});

test('List shows 2 after delete', () => {
    const out = run(['list']);
    assert(!out.includes('uptime-kuma-password'), 'Should not contain deleted credential');
    assert(out.includes('overseerr-api-key'), 'Should still have overseerr');
});

// ---- Test: Provider name validation ----
console.log('\n7. Security\n');

test('Reject invalid provider name', () => {
    try {
        run(['store', '../../../etc/passwd', 'malicious']);
        throw new Error('Should have thrown');
    } catch (err) {
        if (err.message === 'Should have thrown') throw err;
        assert(err.status === 1, 'Should reject invalid provider name');
    }
});

test('Audit log has entries', () => {
    const out = run(['audit']);
    assert(out.includes('credential_store'), 'Should have store entries');
    assert(out.includes('credential_get'), 'Should have get entries');
});

// Cleanup
console.log('\n---');
rmSync(TEST_DIR, { recursive: true, force: true });

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
