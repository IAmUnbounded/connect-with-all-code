import express from 'express';
import { createServer } from 'http';
import dotenv from 'dotenv';
import pino from 'pino';
import { initWhatsApp, onInboundMessage } from './whatsapp';
import { initWsServer, onResult, onStatus } from './ws-server';
import { taskQueue } from './queue';
import { handleInboundMessage } from './router';
import { handleTaskResultMessage, handleStatusResponse } from './router';

dotenv.config();

const logger = pino({
    name: 'cwac-gateway',
    transport: {
        target: 'pino-pretty',
        options: { colorize: true },
    },
});

// ─── Config ───

const PORT = parseInt(process.env.PORT || '3000', 10);
const AUTH_STORE_PATH = process.env.AUTH_STORE_PATH || undefined;
const ALLOWLIST_NUMBERS = process.env.ALLOWLIST_NUMBERS
    ? process.env.ALLOWLIST_NUMBERS.split(',').map((n) => n.trim()).filter(Boolean)
    : [];

// ─── Express App (health check + WebSocket upgrade) ───

const app = express();
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── HTTP + WebSocket server ───

const server = createServer(app);
initWsServer(server);

// ─── Initialize WhatsApp via Baileys ───

(async () => {
    try {
        await initWhatsApp({ authStorePath: AUTH_STORE_PATH, allowlist: ALLOWLIST_NUMBERS });

        // Wire inbound WhatsApp messages → command router
        onInboundMessage((from, text) => {
            handleInboundMessage(from, text).catch((err) => {
                logger.error({ err: err.message, from }, 'Error handling inbound message');
            });
        });

        logger.info('📱 WhatsApp client initialized via Baileys');
    } catch (err: any) {
        logger.error({ err: err.message }, 'Failed to initialize WhatsApp');
    }
})();

// ─── Wire Up: WebSocket results → WhatsApp responses ───

onResult((userId, result) => {
    // Complete the task in the queue
    taskQueue.completeTask(result);

    // Send the result back via WhatsApp
    handleTaskResultMessage(userId, result.taskId, result.output, result.error).catch((err) => {
        logger.error({ err: err.message, userId }, 'Failed to send task result');
    });
});

onStatus((userId, agents) => {
    handleStatusResponse(userId, agents).catch((err) => {
        logger.error({ err: err.message, userId }, 'Failed to send status response');
    });
});

// Wire up task queue → WebSocket dispatch
taskQueue.onTaskReady((task) => {
    logger.info({ taskId: task.id, agent: task.agent }, 'Task ready for dispatch');
});

// ─── Start ───

server.listen(PORT, () => {
    logger.info('─'.repeat(50));
    logger.info(`🚀 ConnectWithAllCode Gateway running on port ${PORT}`);
    logger.info(`🔌 WebSocket endpoint: ws://localhost:${PORT}/ws`);
    logger.info('─'.repeat(50));
    logger.info('📱 Scan the QR code above to link your WhatsApp');
    logger.info('   No ngrok, no Meta setup, no API keys needed!');
    logger.info('─'.repeat(50));
});

export default app;
