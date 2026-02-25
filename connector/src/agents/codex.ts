import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import pino from 'pino';
import { AgentType, TaskResult } from '@cwac/shared';
import { AgentRunner } from './base';

const logger = pino({ name: 'agent:codex' });

const DEFAULT_TIMEOUT_MS = 3_600_000; // 60 minutes

/**
 * Codex agent runner — uses the OpenAI Codex CLI (`codex`).
 * Uses `codex exec` for non-interactive execution with stdin prompt.
 */
export class CodexRunner implements AgentRunner {
    private command: string;
    private timeoutMs: number;

    constructor(command: string = 'codex', timeoutMs: number = DEFAULT_TIMEOUT_MS) {
        this.command = command;
        this.timeoutMs = timeoutMs;
    }

    getType(): AgentType {
        return AgentType.CODEX;
    }

    getName(): string {
        return 'Codex';
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
                logger.warn({ taskId, requestedWorkspace: workspace, fallback }, 'Workspace not found, falling back');
                resolvedWorkspace = fallback;
            }

            logger.info({ taskId, workspace: resolvedWorkspace, promptLength: prompt.length }, 'Executing Codex task');

            // Codex CLI: `exec` for non-interactive, prompt via stdin
            const args = ['exec', '--skip-git-repo-check', '--full-auto'];

            const output = await this.runCommand(
                [this.command, ...args],
                this.timeoutMs,
                resolvedWorkspace,
                prompt,
            );

            const durationMs = Date.now() - startTime;

            return {
                taskId,
                status: 'completed',
                output: output.trim() || 'Task completed (no output)',
                durationMs,
            };
        } catch (err: any) {
            const durationMs = Date.now() - startTime;
            logger.error({ taskId, err: err.message }, 'Codex task failed');

            return {
                taskId,
                status: 'failed',
                output: '',
                error: err.message || 'Unknown error',
                durationMs,
            };
        }
    }

    private runCommand(
        args: string[],
        timeoutMs: number,
        cwd?: string,
        stdinData?: string,
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            const [cmd, ...cmdArgs] = args;
            const proc = spawn(cmd, cmdArgs, {
                cwd: cwd || undefined,
                env: { ...process.env },
                stdio: ['pipe', 'pipe', 'pipe'],
                shell: true,
            });

            if (stdinData) {
                proc.stdin.write(stdinData);
            }
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
