import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import pino from 'pino';

const logger = pino({ name: 'config' });

export interface AgentConfig {
    enabled: boolean;
    command?: string;
    integration?: 'cli' | 'cloud-api' | 'mcp';
    api_key_env?: string;
    mcp_server?: string;
}

export interface ConnectorConfig {
    agents: {
        claude: AgentConfig;
        gemini: AgentConfig;
        codex: AgentConfig;
        opencode: AgentConfig;
    };
    defaults: {
        agent: string;
        workspace: string;
    };
    gateway: {
        url: string;
    };
}

const DEFAULT_CONFIG: ConnectorConfig = {
    agents: {
        claude: { enabled: true, command: 'claude' },
        gemini: { enabled: true, command: 'gemini' },
        codex: { enabled: true, command: 'codex' },
        opencode: { enabled: true, command: 'opencode' },
    },
    defaults: {
        agent: 'claude',
        workspace: '~/projects',
    },
    gateway: {
        url: 'ws://localhost:3000/ws',
    },
};

/**
 * Load configuration from ~/.cwac/config.yaml.
 * Falls back to default config if file doesn't exist.
 */
export function loadConfig(): ConnectorConfig {
    const configDir = path.join(process.env.HOME || '', '.cwac');
    const configPath = path.join(configDir, 'config.yaml');

    if (!fs.existsSync(configPath)) {
        logger.info('No config file found at ~/.cwac/config.yaml. Using defaults.');

        // Create config directory and default config
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }
        fs.writeFileSync(configPath, yaml.dump(DEFAULT_CONFIG), 'utf-8');
        logger.info(`Created default config at ${configPath}`);

        return DEFAULT_CONFIG;
    }

    try {
        const content = fs.readFileSync(configPath, 'utf-8');
        const parsed = yaml.load(content) as Partial<ConnectorConfig>;

        // Deep merge with defaults
        const config: ConnectorConfig = {
            agents: { ...DEFAULT_CONFIG.agents, ...parsed.agents },
            defaults: { ...DEFAULT_CONFIG.defaults, ...parsed.defaults },
            gateway: { ...DEFAULT_CONFIG.gateway, ...parsed.gateway },
        };

        logger.info({ configPath }, 'Config loaded');
        return config;
    } catch (err: any) {
        logger.error({ err: err.message, configPath }, 'Failed to load config, using defaults');
        return DEFAULT_CONFIG;
    }
}
