/**
 * ClosedClaw CLI
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { createInterface } from 'node:readline';
import { readFileSync, statSync } from 'node:fs';
import { getVault } from '../vault/vault.js';
import { loadConfig, saveConfig, isVaultInitialized } from '../core/config.js';

const program = new Command();

const logo = `
+-----------------------------------------------------------+
|   ClosedClaw                                              |
|   Encrypted Credential Vault for OpenClaw                 |
+-----------------------------------------------------------+
`;

/**
 * Prompt for password (hidden input)
 */
async function promptPassword(prompt: string): Promise<string> {
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise((resolve) => {
        process.stdout.write(prompt);

        let password = '';
        const stdin = process.stdin;
        stdin.setRawMode?.(true);
        stdin.resume();
        stdin.setEncoding('utf8');

        const onData = (char: string) => {
            switch (char) {
                case '\n':
                case '\r':
                case '\u0004':
                    stdin.setRawMode?.(false);
                    stdin.removeListener('data', onData);
                    process.stdout.write('\n');
                    rl.close();
                    resolve(password);
                    break;
                case '\u0003':
                    process.exit();
                    break;
                case '\u007F':
                    if (password.length > 0) {
                        password = password.slice(0, -1);
                        process.stdout.write('\b \b');
                    }
                    break;
                default:
                    password += char;
                    process.stdout.write('*');
                    break;
            }
        };

        stdin.on('data', onData);
    });
}

/**
 * Resolve passphrase from --passphrase-file, env var, or interactive prompt
 */
async function resolvePassphrase(options: { passphraseFile?: string }): Promise<string> {
    // Option 1: passphrase file
    if (options.passphraseFile) {
        try {
            const stats = statSync(options.passphraseFile);
            const mode = stats.mode & 0o777;
            if (mode !== 0o600 && mode !== 0o400) {
                process.stderr.write(`Error: Passphrase file permissions are too open (${mode.toString(8)}). Must be 0600 or 0400.\n`);
                process.exit(1);
            }
            return readFileSync(options.passphraseFile, 'utf8').trim();
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
                process.stderr.write(`Error: Passphrase file not found: ${options.passphraseFile}\n`);
            }
            process.exit(1);
        }
    }

    // Option 2: environment variable
    if (process.env.CLOSEDCLAW_PASSPHRASE) {
        return process.env.CLOSEDCLAW_PASSPHRASE;
    }

    // Option 3: interactive prompt
    return promptPassword(chalk.white('Enter passphrase: '));
}

program
    .name('closedclaw')
    .description('Encrypted credential vault for OpenClaw')
    .version('0.2.0');

// Init command
program
    .command('init')
    .description('Initialize a new encrypted vault')
    .action(async () => {
        console.log(chalk.cyan(logo));

        if (isVaultInitialized()) {
            console.log(chalk.yellow('Vault is already initialized.'));
            console.log(chalk.gray('Use "closedclaw reset" to reinitialize (this will delete all stored credentials).'));
            return;
        }

        console.log(chalk.bold('\nSetting up your encrypted credential vault...\n'));

        const passphrase = await promptPassword(chalk.white('Create a master passphrase: '));
        const confirm = await promptPassword(chalk.white('Confirm passphrase: '));

        if (passphrase !== confirm) {
            console.log(chalk.red('\nPassphrases do not match. Please try again.'));
            process.exit(1);
        }

        if (passphrase.length < 8) {
            console.log(chalk.red('\nPassphrase must be at least 8 characters long.'));
            process.exit(1);
        }

        const spinner = ora('Initializing encrypted vault...').start();

        try {
            const vault = getVault();
            vault.initialize(passphrase);
            spinner.succeed('Vault initialized successfully!');

            console.log(chalk.green('\nYour encrypted vault is ready.\n'));
            console.log(chalk.gray('Next steps:'));
            console.log(chalk.white('  1. Store your credentials:'));
            console.log(chalk.cyan('     closedclaw store overseerr-api-key'));
            console.log(chalk.cyan('     closedclaw store proxmox-token-secret'));
            console.log(chalk.white('  2. Retrieve a credential:'));
            console.log(chalk.cyan('     closedclaw get overseerr-api-key'));
            console.log(chalk.white('  3. List stored credentials:'));
            console.log(chalk.cyan('     closedclaw list\n'));
        } catch (error) {
            spinner.fail('Failed to initialize vault');
            console.error(chalk.red((error as Error).message));
            process.exit(1);
        }
    });

// Store command
program
    .command('store <provider> [key]')
    .description('Store a credential in the encrypted vault')
    .option('--passphrase-file <path>', 'Read passphrase from file')
    .action(async (provider: string, key: string | undefined, options: { passphraseFile?: string }) => {
        if (!isVaultInitialized()) {
            console.log(chalk.red('Vault is not initialized. Run "closedclaw init" first.'));
            process.exit(1);
        }

        // If key not provided as argument, prompt interactively
        if (!key) {
            key = await promptPassword(chalk.white(`Enter credential value for ${provider}: `));
            if (!key) {
                console.log(chalk.red('\nNo credential value provided.'));
                process.exit(1);
            }
        }

        const passphrase = await resolvePassphrase(options);
        const vault = getVault();

        if (!vault.unlock(passphrase)) {
            console.log(chalk.red('\nInvalid passphrase.'));
            process.exit(1);
        }

        const spinner = ora(`Storing ${provider} credentials...`).start();

        try {
            vault.storeCredential(provider, key);
            spinner.succeed(`${provider} credentials stored securely.`);
            console.log(chalk.green(`\n${provider} credential encrypted and saved.\n`));
        } catch (error) {
            spinner.fail('Failed to store credentials');
            console.error(chalk.red((error as Error).message));
            process.exit(1);
        } finally {
            vault.lock();
        }
    });

// Get command (for SecretRef exec integration)
program
    .command('get <provider>')
    .description('Retrieve a credential value (outputs to stdout for SecretRef exec)')
    .option('--passphrase-file <path>', 'Read passphrase from file')
    .action(async (provider: string, options: { passphraseFile?: string }) => {
        if (!isVaultInitialized()) {
            process.stderr.write('Error: Vault is not initialized. Run "closedclaw init" first.\n');
            process.exit(1);
        }

        const passphrase = await resolvePassphrase(options);
        const vault = getVault();

        if (!vault.unlock(passphrase)) {
            process.stderr.write('Error: Invalid passphrase.\n');
            process.exit(1);
        }

        try {
            const credential = vault.getCredential(provider);

            if (!credential) {
                process.stderr.write(`Error: No credential found for "${provider}".\n`);
                process.exit(1);
            }

            // Output raw key to stdout (no newline, no formatting, no colors)
            process.stdout.write(credential.key);
        } finally {
            vault.lock();
        }
    });

// List command
program
    .command('list')
    .description('List all stored credential providers')
    .option('--passphrase-file <path>', 'Read passphrase from file')
    .action(async (options: { passphraseFile?: string }) => {
        if (!isVaultInitialized()) {
            console.log(chalk.red('Vault is not initialized. Run "closedclaw init" first.'));
            process.exit(1);
        }

        const passphrase = await resolvePassphrase(options);
        const vault = getVault();

        if (!vault.unlock(passphrase)) {
            console.log(chalk.red('\nInvalid passphrase.'));
            process.exit(1);
        }

        try {
            const providers = vault.listProviders();

            if (providers.length === 0) {
                console.log(chalk.yellow('\nNo credentials stored yet.'));
                console.log(chalk.gray('Use "closedclaw store <provider>" to add credentials.\n'));
                return;
            }

            console.log(chalk.bold('\nStored Credentials:\n'));
            for (const provider of providers) {
                console.log(chalk.green(`  [x] ${provider}`));
            }
            console.log();
        } finally {
            vault.lock();
        }
    });

// Delete command
program
    .command('delete <provider>')
    .description('Delete a stored credential')
    .option('--passphrase-file <path>', 'Read passphrase from file')
    .action(async (provider: string, options: { passphraseFile?: string }) => {
        if (!isVaultInitialized()) {
            console.log(chalk.red('Vault is not initialized. Run "closedclaw init" first.'));
            process.exit(1);
        }

        const passphrase = await resolvePassphrase(options);
        const vault = getVault();

        if (!vault.unlock(passphrase)) {
            console.log(chalk.red('\nInvalid passphrase.'));
            process.exit(1);
        }

        try {
            if (vault.deleteCredential(provider)) {
                console.log(chalk.green(`\n${provider} credentials deleted.\n`));
            } else {
                console.log(chalk.yellow(`\nNo credentials found for ${provider}.\n`));
            }
        } finally {
            vault.lock();
        }
    });

// Status command
program
    .command('status')
    .description('Show vault status')
    .action(async () => {
        console.log(chalk.bold('\nClosedClaw Status\n'));

        const vaultInitialized = isVaultInitialized();
        console.log(chalk.white('Vault:'));
        console.log(`  Initialized: ${vaultInitialized ? chalk.green('Yes') : chalk.red('No')}`);

        const config = loadConfig();
        console.log(chalk.white('\nConfiguration:'));
        console.log(`  Auth profiles path: ${chalk.cyan(config.openclaw.authProfilesPath)}`);
        console.log(`  OpenClaw config: ${chalk.cyan(config.openclaw.configPath)}`);
        console.log();
    });

// Config command
program
    .command('config')
    .description('View or update configuration')
    .option('--auth-profiles-path <path>', 'Set path to OpenClaw auth-profiles.json')
    .option('--openclaw-config <path>', 'Set path to OpenClaw config file')
    .action((options) => {
        const config = loadConfig();

        if (options.authProfilesPath) {
            config.openclaw.authProfilesPath = options.authProfilesPath;
            saveConfig(config);
            console.log(chalk.green(`Auth profiles path set to ${options.authProfilesPath}`));
        }

        if (options.openclawConfig) {
            config.openclaw.configPath = options.openclawConfig;
            saveConfig(config);
            console.log(chalk.green(`OpenClaw config path set to ${options.openclawConfig}`));
        }

        if (!options.authProfilesPath && !options.openclawConfig) {
            console.log(chalk.bold('\nCurrent Configuration:\n'));
            console.log(JSON.stringify(config, null, 2));
            console.log();
        }
    });

program.parse();
