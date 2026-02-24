// ─── Agent Types ───

export enum AgentType {
    CLAUDE = 'claude',
    GEMINI = 'gemini',
    CODEX = 'codex',
    OPENCODE = 'opencode',
}

export const AGENT_ALIASES: Record<string, AgentType> = {
    '/claude': AgentType.CLAUDE,
    '/cc': AgentType.CLAUDE,
    '/gemini': AgentType.GEMINI,
    '/gm': AgentType.GEMINI,
    '/codex': AgentType.CODEX,
    '/cx': AgentType.CODEX,
    '/opencode': AgentType.OPENCODE,
    '/oc': AgentType.OPENCODE,
};

export const AGENT_DISPLAY_NAMES: Record<AgentType, string> = {
    [AgentType.CLAUDE]: 'Claude Code',
    [AgentType.GEMINI]: 'Gemini CLI',
    [AgentType.CODEX]: 'Codex',
    [AgentType.OPENCODE]: 'opencode',
};

export const SYSTEM_COMMANDS = [
    '/status',
    '/help',
    '/default',
    '/history',
    '/cancel',
    '/pair',
] as const;

export type SystemCommand = (typeof SYSTEM_COMMANDS)[number];

// ─── Task Types ───

export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Task {
    id: string;
    agent: AgentType;
    prompt: string;
    workspace: string;
    userId: string;       // WhatsApp phone number
    status: TaskStatus;
    createdAt: number;
}

export interface TaskResult {
    taskId: string;
    status: 'completed' | 'failed';
    output: string;
    error?: string;
    durationMs: number;
}

// ─── Session Types ───

export interface UserSession {
    userId: string;
    defaultAgent: AgentType;
    defaultWorkspace: string;
    pairedDeviceId: string | null;
    createdAt: number;
    updatedAt: number;
}

// ─── Parsed Command ───

export type ParsedCommand =
    | { type: 'agent'; agent: AgentType; prompt: string }
    | { type: 'system'; command: SystemCommand; args: string }
    | { type: 'default_agent'; prompt: string }  // no prefix, use default agent
    | { type: 'error'; message: string };

// ─── Agent Health ───

export interface AgentHealth {
    agent: AgentType;
    available: boolean;
    version?: string;
    lastChecked: number;
}

export type AgentStatusMap = Record<AgentType, AgentHealth>;
