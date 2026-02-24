#!/usr/bin/env node

import * as os from 'os';
import pino from 'pino';
import { AgentType } from '@cwac/shared';
import { loadConfig } from './config';
import { Tunnel } from './tunnel';
import { AgentRunner } from './agents/base';
import { ClaudeCodeRunner } from './agents/claude';
import { GeminiRunner } from './agents/gemini';
import { CodexRunner } from './agents/codex';
import { OpencodeRunner } from './agents/opencode';

const logger = pino({
    name: 'cwac-connector',
    transport: {
        target: 'pino-pretty',
        options: { colorize: true },
    },
});

async function main(): Promise<void> {
    console.log(`
  ╔══════════════════════════════════════════╗
  ║   ConnectWithAllCode — Connector Agent   ║
  ╚══════════════════════════════════════════╝
  `);

    // Parse CLI args
    const args = process.argv.slice(2);
    const pairIndex = args.indexOf('--pair');
    const pairingCode = pairIndex !== -1 ? args[pairIndex + 1] : undefined;

    if (!pairingCode) {
        console.log('  Usage: cwac-connector start --pair <PAIRING_CODE>');
        console.log('');
        console.log('  Get a pairing code by sending /pair on WhatsApp.');
        process.exit(1);
    }

    // Load config
    const config = loadConfig();

    // Initialize agent runners
    const runners = new Map<AgentType, AgentRunner>();

    if (config.agents.claude.enabled) {
        const command = config.agents.claude.command || 'claude';
        runners.set(AgentType.CLAUDE, new ClaudeCodeRunner(command));
        logger.info('📦 Claude Code agent: enabled');
    }

    if (config.agents.gemini.enabled) {
        const command = config.agents.gemini.command || 'gemini';
        runners.set(AgentType.GEMINI, new GeminiRunner(command));
        logger.info('📦 Gemini CLI agent: enabled');
    }

    if (config.agents.codex.enabled) {
        const command = config.agents.codex.command || 'codex';
        runners.set(AgentType.CODEX, new CodexRunner(command));
        logger.info('📦 Codex agent: enabled');
    }

    if (config.agents.opencode.enabled) {
        const command = config.agents.opencode.command || 'opencode';
        runners.set(AgentType.OPENCODE, new OpencodeRunner(command));
        logger.info('📦 opencode agent: enabled');
    }

    if (runners.size === 0) {
        logger.error('No agents enabled. Check ~/.cwac/config.yaml');
        process.exit(1);
    }

    // Check agent health
    logger.info('🔍 Running health checks...');
    for (const [type, runner] of runners) {
        const healthy = await runner.checkHealth();
        const version = healthy ? await runner.getVersion() : undefined;
        const status = healthy ? '✅ available' : '⚠️  not available';
        logger.info(`   ${runner.getName()}: ${status}${version ? ` (${version})` : ''}`);
    }

    // Connect to gateway
    const deviceName = `${os.hostname()} (${os.platform()})`;
    const tunnel = new Tunnel({
        gatewayUrl: config.gateway.url,
        pairingCode,
        deviceName,
        runners,
    });

    tunnel.connect();

    // Handle graceful shutdown
    const shutdown = () => {
        logger.info('Shutting down...');
        tunnel.disconnect();
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    logger.info(`🔗 Pairing code: ${pairingCode}`);
    logger.info(`🌐 Connecting to: ${config.gateway.url}`);
    logger.info('─'.repeat(50));
}

main().catch((err) => {
    logger.error({ err: err.message }, 'Fatal error');
    process.exit(1);
});
