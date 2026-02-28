/**
 * ClosedClaw CLI
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { createInterface } from 'node:readline';
import { getVault } from '../vault/vault.js';
import { loadConfig, saveConfig, isVaultInitialized } from '../core/config.js';
import { getDaemonStatus, startDaemon, stopDaemon, isDaemonRunning } from '../daemon/server.js';

const program = new Command();

const logo = `
╔═══════════════════════════════════════════════════════════╗
║   ██████╗██╗      ██████╗  ██████╗███████╗██████╗         ║
║  ██╔════╝██║     ██╔═══██╗██╔════╝██╔════╝██╔══██╗        ║
║  ██║     ██║     ██║   ██║███████╗█████╗  ██║  ██║        ║
║  ██║     ██║     ██║   ██║╚════██║██╔══╝  ██║  ██║        ║
║  ╚██████╗███████╗╚██████╔╝███████║███████╗██████╔╝        ║
║   ╚═════╝╚══════╝ ╚═════╝ ╚══════╝╚══════╝╚═════╝         ║
║   ██████╗██╗      █████╗ ██╗    ██╗                       ║
║  ██╔════╝██║     ██╔══██╗██║    ██║                       ║
║  ██║     ██║     ███████║██║ █╗ ██║                       ║
║  ██║     ██║     ██╔══██║██║███╗██║                       ║
║  ╚██████╗███████╗██║  ██║╚███╔███╔╝                       ║
║   ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝                        ║
║                                                           ║
║  🔐 Encrypted Credential Vault for OpenClaw               ║
╚═══════════════════════════════════════════════════════════╝
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
        // Disable echo for password input
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
                case '\u0004': // Ctrl+D
                    stdin.setRawMode?.(false);
                    stdin.removeListener('data', onData);
                    process.stdout.write('\n');
                    rl.close();
                    resolve(password);
                    break;
                case '\u0003': // Ctrl+C
                    process.exit();
                    break;
                case '\u007F': // Backspace
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

program
    .name('closedclaw')
    .description('🔐 Encrypted credential vault and security layer for OpenClaw')
    .version('0.1.0');

// Init command
program
    .command('init')
    .description('Initialize a new encrypted vault')
    .action(async () => {
        console.log(chalk.cyan(logo));

        if (isVaultInitialized()) {
            console.log(chalk.yellow('⚠️  Vault is already initialized.'));
            console.log(chalk.gray('Use "closedclaw reset" to reinitialize (this will delete all stored credentials).'));
            return;
        }

        console.log(chalk.bold('\n🔐 Setting up your encrypted credential vault...\n'));

        const passphrase = await promptPassword(chalk.white('Create a master passphrase: '));
        const confirm = await promptPassword(chalk.white('Confirm passphrase: '));

        if (passphrase !== confirm) {
            console.log(chalk.red('\n❌ Passphrases do not match. Please try again.'));
            process.exit(1);
        }

        if (passphrase.length < 8) {
            console.log(chalk.red('\n❌ Passphrase must be at least 8 characters long.'));
            process.exit(1);
        }

        const spinner = ora('Initializing encrypted vault...').start();

        try {
            const vault = getVault();
            vault.initialize(passphrase);
            spinner.succeed('Vault initialized successfully!');

            console.log(chalk.green('\n✅ Your encrypted vault is ready.\n'));
            console.log(chalk.gray('Next steps:'));
            console.log(chalk.white('  1. Store your API keys:'));
            console.log(chalk.cyan('     closedclaw store anthropic sk-ant-api...'));
            console.log(chalk.cyan('     closedclaw store openai sk-...'));
            console.log(chalk.white('  2. Start the daemon:'));
            console.log(chalk.cyan('     closedclaw start'));
            console.log(chalk.white('  3. Configure OpenClaw to use ClosedClaw proxy:'));
            console.log(chalk.gray('     Update gateway.port to 3847 in openclaw.json\n'));
        } catch (error) {
            spinner.fail('Failed to initialize vault');
            console.error(chalk.red((error as Error).message));
            process.exit(1);
        }
    });

// Store command
program
    .command('store <provider> <key>')
    .description('Store an API key in the encrypted vault')
    .action(async (provider: string, key: string) => {
        if (!isVaultInitialized()) {
            console.log(chalk.red('❌ Vault is not initialized. Run "closedclaw init" first.'));
            process.exit(1);
        }

        const passphrase = await promptPassword(chalk.white('Enter passphrase: '));
        const vault = getVault();

        if (!vault.unlock(passphrase)) {
            console.log(chalk.red('\n❌ Invalid passphrase.'));
            process.exit(1);
        }

        const spinner = ora(`Storing ${provider} credentials...`).start();

        try {
            vault.storeCredential(provider, key);
            spinner.succeed(`${provider} credentials stored securely.`);
            console.log(chalk.green(`\n✅ ${provider} API key encrypted and saved.\n`));
        } catch (error) {
            spinner.fail('Failed to store credentials');
            console.error(chalk.red((error as Error).message));
            process.exit(1);
        }
    });

// List command
program
    .command('list')
    .description('List all stored credential providers')
    .action(async () => {
        if (!isVaultInitialized()) {
            console.log(chalk.red('❌ Vault is not initialized. Run "closedclaw init" first.'));
            process.exit(1);
        }

        const passphrase = await promptPassword(chalk.white('Enter passphrase: '));
        const vault = getVault();

        if (!vault.unlock(passphrase)) {
            console.log(chalk.red('\n❌ Invalid passphrase.'));
            process.exit(1);
        }

        const providers = vault.listProviders();

        if (providers.length === 0) {
            console.log(chalk.yellow('\n📭 No credentials stored yet.'));
            console.log(chalk.gray('Use "closedclaw store <provider> <key>" to add credentials.\n'));
            return;
        }

        console.log(chalk.bold('\n🔐 Stored Credentials:\n'));
        for (const provider of providers) {
            console.log(chalk.green(`  ✓ ${provider}`));
        }
        console.log();
    });

// Delete command
program
    .command('delete <provider>')
    .description('Delete a stored credential')
    .action(async (provider: string) => {
        if (!isVaultInitialized()) {
            console.log(chalk.red('❌ Vault is not initialized. Run "closedclaw init" first.'));
            process.exit(1);
        }

        const passphrase = await promptPassword(chalk.white('Enter passphrase: '));
        const vault = getVault();

        if (!vault.unlock(passphrase)) {
            console.log(chalk.red('\n❌ Invalid passphrase.'));
            process.exit(1);
        }

        if (vault.deleteCredential(provider)) {
            console.log(chalk.green(`\n✅ ${provider} credentials deleted.\n`));
        } else {
            console.log(chalk.yellow(`\n⚠️  No credentials found for ${provider}.\n`));
        }
    });

// Status command
program
    .command('status')
    .description('Show vault and daemon status')
    .action(async () => {
        console.log(chalk.bold('\n🔐 ClosedClaw Status\n'));

        // Vault status
        const vaultInitialized = isVaultInitialized();
        console.log(chalk.white('Vault:'));
        console.log(`  Initialized: ${vaultInitialized ? chalk.green('Yes') : chalk.red('No')}`);

        // Daemon status
        const daemon = getDaemonStatus();
        console.log(chalk.white('\nDaemon:'));
        console.log(`  Running: ${daemon.running ? chalk.green('Yes') : chalk.red('No')}`);
        if (daemon.running) {
            console.log(`  PID: ${chalk.cyan(daemon.pid)}`);
            console.log(`  Port: ${chalk.cyan(daemon.port)}`);
        }

        // Config info
        const config = loadConfig();
        console.log(chalk.white('\nConfiguration:'));
        console.log(`  Daemon port: ${chalk.cyan(config.daemon.port)}`);
        console.log(`  OpenClaw gateway: ${chalk.cyan(`${config.openclaw.gatewayUrl}:${config.openclaw.gatewayPort}`)}`);
        console.log();
    });

// Start command
program
    .command('start')
    .description('Start the ClosedClaw daemon')
    .option('-f, --foreground', 'Run in foreground (don\'t daemonize)')
    .action(async (options) => {
        if (!isVaultInitialized()) {
            console.log(chalk.red('❌ Vault is not initialized. Run "closedclaw init" first.'));
            process.exit(1);
        }

        if (isDaemonRunning()) {
            console.log(chalk.yellow('⚠️  Daemon is already running.'));
            const status = getDaemonStatus();
            console.log(chalk.gray(`  PID: ${status.pid}, Port: ${status.port}`));
            return;
        }

        const passphrase = await promptPassword(chalk.white('Enter passphrase to unlock vault: '));
        const vault = getVault();

        if (!vault.unlock(passphrase)) {
            console.log(chalk.red('\n❌ Invalid passphrase.'));
            process.exit(1);
        }

        const spinner = ora('Starting ClosedClaw daemon...').start();

        try {
            await startDaemon(passphrase);
            spinner.succeed('Daemon started successfully!');

            const config = loadConfig();
            console.log(chalk.green(`\n✅ ClosedClaw is running on http://${config.daemon.host}:${config.daemon.port}\n`));
            console.log(chalk.gray('Your credentials are now being securely injected into OpenClaw.'));
            console.log(chalk.gray('To stop the daemon, run: closedclaw stop\n'));

            if (options.foreground) {
                console.log(chalk.yellow('Running in foreground. Press Ctrl+C to stop.\n'));
                // Keep process running
                process.on('SIGINT', () => {
                    console.log(chalk.yellow('\nShutting down...'));
                    stopDaemon();
                    process.exit(0);
                });
            }
        } catch (error) {
            spinner.fail('Failed to start daemon');
            console.error(chalk.red((error as Error).message));
            process.exit(1);
        }
    });

// Stop command
program
    .command('stop')
    .description('Stop the ClosedClaw daemon')
    .action(() => {
        if (!isDaemonRunning()) {
            console.log(chalk.yellow('⚠️  Daemon is not running.'));
            return;
        }

        const spinner = ora('Stopping daemon...').start();

        if (stopDaemon()) {
            spinner.succeed('Daemon stopped.');
            console.log(chalk.green('\n✅ ClosedClaw daemon has been stopped.\n'));
        } else {
            spinner.fail('Failed to stop daemon');
            process.exit(1);
        }
    });

// Config command
program
    .command('config')
    .description('View or update configuration')
    .option('--openclaw-port <port>', 'Set OpenClaw gateway port')
    .option('--daemon-port <port>', 'Set ClosedClaw daemon port')
    .action((options) => {
        const config = loadConfig();

        if (options.openclawPort) {
            config.openclaw.gatewayPort = parseInt(options.openclawPort, 10);
            saveConfig(config);
            console.log(chalk.green(`✅ OpenClaw gateway port set to ${options.openclawPort}`));
        }

        if (options.daemonPort) {
            config.daemon.port = parseInt(options.daemonPort, 10);
            saveConfig(config);
            console.log(chalk.green(`✅ Daemon port set to ${options.daemonPort}`));
        }

        if (!options.openclawPort && !options.daemonPort) {
            console.log(chalk.bold('\n📋 Current Configuration:\n'));
            console.log(JSON.stringify(config, null, 2));
            console.log();
        }
    });

program.parse();
