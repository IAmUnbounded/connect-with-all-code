import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import pino from 'pino';
import { AgentType, TaskResult } from '@cwac/shared';
import { AgentRunner } from './base';

const logger = pino({ name: 'agent:opencode' });

const DEFAULT_TIMEOUT_MS = 3_600_000; // 60 minutes

/**
 * opencode agent runner — uses the opencode CLI (`opencode run`).
 * Docs: https://opencode.ai/docs/cli
 */
export class OpencodeRunner implements AgentRunner {
    private command: string;
    private timeoutMs: number;

    constructor(command: string = 'opencode', timeoutMs: number = DEFAULT_TIMEOUT_MS) {
        this.command = command;
        this.timeoutMs = timeoutMs;
    }

    getType(): AgentType {
        return AgentType.OPENCODE;
    }

    getName(): string {
        return 'opencode';
    }

    async getVersion(): Promise<string | undefined> {
        try {
            const output = await this.runCommand([this.command, '--version'], 10_000);
            return output.trim() || undefined;
        } catch {
            return undefined;
        }
    }

    async checkHealth(): Promise<boolean> {
        try {
            await this.runCommand([this.command, '--version'], 10_000);
            return true;
        } catch {
            return false;
        }
    }

    async execute(prompt: string, workspace: string): Promise<TaskResult> {
        const taskId = uuidv4();
        const startTime = Date.now();

        try {
            let resolvedWorkspace = expandHome(workspace);
            if (!existsSync(resolvedWorkspace)) {
                const fallback = process.env.HOME || process.cwd();
                logger.warn(
                    { taskId, requestedWorkspace: workspace, fallback },
                    'Workspace not found, falling back'
                );
                resolvedWorkspace = fallback;
            }

            logger.info({ taskId, workspace: resolvedWorkspace, promptLength: prompt.length }, 'Executing opencode task');

            // opencode run <prompt> --format json for structured output
            const args = ['run', prompt, '--format', 'json'];

            const output = await this.runCommand(
                [this.command, ...args],
                this.timeoutMs,
                resolvedWorkspace,
            );

            // Parse JSON output — opencode emits newline-delimited JSON events;
            // extract the last assistant message text.
            let responseText = output.trim();
            try {
                const lines = output.trim().split('\n').filter(Boolean);
                const texts: string[] = [];
                for (const line of lines) {
                    const event = JSON.parse(line);
                    // Collect text from assistant message content parts
                    if (event?.type === 'message' && event?.role === 'assistant') {
                        const content = event.content ?? [];
                        for (const part of Array.isArray(content) ? content : []) {
                            if (part?.type === 'text' && typeof part.text === 'string') {
                                texts.push(part.text);
                            }
                        }
                    }
                }
                if (texts.length > 0) {
                    responseText = texts.join('\n').trim();
                }
            } catch {
                // Not JSON / unexpected format — use raw output
                responseText = output.trim();
            }

            const durationMs = Date.now() - startTime;

            return {
                taskId,
                status: 'completed',
                output: responseText || 'Task completed (no output)',
                durationMs,
            };
        } catch (err: any) {
            const durationMs = Date.now() - startTime;
            logger.error({ taskId, err: err.message }, 'opencode task failed');

            return {
                taskId,
                status: 'failed',
                output: '',
                error: err.message || 'Unknown error',
                durationMs,
            };
        }
    }

    private runCommand(args: string[], timeoutMs: number, cwd?: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const [cmd, ...cmdArgs] = args;
            const proc = spawn(cmd, cmdArgs, {
                cwd: cwd || undefined,
                env: { ...process.env },
                stdio: ['pipe', 'pipe', 'pipe'],
                shell: true,
            });

            proc.stdin.end();

            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (data: Buffer) => {
                stdout += data.toString();
            });

            proc.stderr.on('data', (data: Buffer) => {
                stderr += data.toString();
            });

            const timer = setTimeout(() => {
                proc.kill('SIGTERM');
                reject(new Error(`Command timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            proc.on('close', (code) => {
                clearTimeout(timer);
                if (code === 0) {
                    resolve(stdout);
                } else {
                    reject(new Error(stderr || `Process exited with code ${code}`));
                }
            });

            proc.on('error', (err) => {
                clearTimeout(timer);
                reject(err);
            });
        });
    }
}

function expandHome(path: string): string {
    if (path.startsWith('~/')) {
        return path.replace('~', process.env.HOME || '');
    }
    return path;
}
