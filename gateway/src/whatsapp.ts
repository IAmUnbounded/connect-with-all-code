import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
    WASocket,
    makeCacheableSignalKeyStore,
    fetchLatestBaileysVersion,
} from 'baileys';
import { Boom } from '@hapi/boom';
import * as QRCode from 'qrcode-terminal';
import pino from 'pino';
import path from 'path';

const logger = pino({ name: 'whatsapp' });

const MAX_MESSAGE_LENGTH = 4096;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 2000;

let sock: WASocket | null = null;
let inboundHandler: ((from: string, text: string) => void) | null = null;
let reconnectAttempts = 0;

interface WhatsAppBaileysConfig {
    authStorePath?: string;
    allowlist?: string[];
}

/**
 * Initialize WhatsApp via Baileys (WhatsApp Web multi-device protocol).
 * Displays a QR code in the terminal on first run; persists auth for subsequent runs.
 */
export async function initWhatsApp(cfg: WhatsAppBaileysConfig = {}): Promise<void> {
    const authPath = cfg.authStorePath || path.join(process.cwd(), 'auth_store');
    const allowlist = cfg.allowlist ?? [];

    const { state, saveCreds } = await useMultiFileAuthState(authPath);

    // Fetch the latest compatible WA Web version to avoid 405 errors
    const { version, isLatest } = await fetchLatestBaileysVersion();
    logger.info({ version, isLatest }, '📦 Using WA Web version');

    const baileysLogger = pino({ level: 'silent' }) as any;

    sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
        },
        printQRInTerminal: false, // We handle QR display ourselves
        logger: baileysLogger,
        browser: ['ConnectWithAllCode', 'Chrome', '1.0.0'],
        generateHighQualityLinkPreview: false,
    });

    // ─── Connection Lifecycle ───
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            logger.info('─'.repeat(50));
            logger.info('📱 Scan this QR code with WhatsApp:');
            logger.info('   Open WhatsApp → Settings → Linked Devices → Link a Device');
            logger.info('─'.repeat(50));
            QRCode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;

            if (statusCode === DisconnectReason.loggedOut) {
                logger.warn('🔒 Logged out from WhatsApp. Delete auth_store/ and restart to re-link.');
                return; // Don't reconnect — user must re-scan
            }

            if (statusCode === DisconnectReason.restartRequired) {
                logger.info('🔄 Restart required by WhatsApp, reconnecting...');
                reconnectAttempts = 0; // Reset — this is a normal protocol event
                initWhatsApp(cfg);
                return;
            }

            // For all other errors, retry with exponential backoff
            if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttempts++;
                const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttempts - 1);
                logger.warn(
                    { statusCode, attempt: reconnectAttempts, maxAttempts: MAX_RECONNECT_ATTEMPTS, delayMs: delay },
                    `⚠️ Connection closed, retrying in ${delay / 1000}s...`
                );
                setTimeout(() => initWhatsApp(cfg), delay);
            } else {
                logger.error(
                    { statusCode },
                    `❌ Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Giving up. Restart the gateway manually.`
                );
            }
        }

        if (connection === 'open') {
            reconnectAttempts = 0; // Reset on successful connection
            logger.info('✅ Connected to WhatsApp!');
            logger.info('─'.repeat(50));
        }
    });

    // ─── Persist Auth State ───
    sock.ev.on('creds.update', saveCreds);

    // ─── Inbound Messages ───
    sock.ev.on('messages.upsert', ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            // Skip messages sent by us
            if (msg.key.fromMe) continue;

            // Only handle text messages
            const text =
                msg.message?.conversation ||
                msg.message?.extendedTextMessage?.text;

            if (!text) continue;

            // Strip any JID suffix to get pure identifier
            const from = msg.key.remoteJid!;

            // Skip group messages
            if (from.endsWith('@g.us')) continue;

            // Extract the number/identifier before the @ sign
            const senderId = from.split('@')[0];

            // Reject messages from numbers not in the allowlist
            if (allowlist.length > 0 && !allowlist.includes(senderId) && !allowlist.includes(from)) {
                logger.warn({ from, senderId }, 'Ignoring message from non-allowlisted number');
                continue;
            }

            logger.info({ from, senderId, text: text.substring(0, 100) }, 'Inbound message received');

            if (inboundHandler) {
                try {
                    inboundHandler(from, text);
                } catch (err: any) {
                    logger.error({ err: err.message, from }, 'Error in inbound handler');
                }
            }
        }
    });
}

/**
 * Register a handler for inbound WhatsApp messages.
 * Replaces the webhook-based approach.
 */
export function onInboundMessage(handler: (from: string, text: string) => void): void {
    inboundHandler = handler;
}

/**
 * Send a text message via Baileys.
 * Automatically splits messages that exceed the 4096 character limit.
 * Same function signature as the old Cloud API version.
 */
export async function sendTextMessage(to: string, text: string): Promise<void> {
    if (!sock) {
        logger.error('WhatsApp socket not initialized');
        return;
    }

    const chunks = splitMessage(text, MAX_MESSAGE_LENGTH);

    // Ensure JID format
    const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;

    for (const chunk of chunks) {
        try {
            await sock.sendMessage(jid, { text: chunk });
        } catch (err: any) {
            logger.error({ err: err.message, to }, 'Failed to send WhatsApp message');
            throw new Error('Failed to send WhatsApp message');
        }
    }
}

/**
 * Split a message into chunks that fit within WhatsApp's character limit.
 * Tries to split on newlines to keep code blocks intact.
 */
export function splitMessage(text: string, maxLength: number): string[] {
    if (text.length <= maxLength) return [text];

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
        if (remaining.length <= maxLength) {
            chunks.push(remaining);
            break;
        }

        // Try to find a newline near the max length to split cleanly
        let splitIndex = remaining.lastIndexOf('\n', maxLength);
        if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
            // Fall back to splitting at maxLength
            splitIndex = maxLength;
        }

        chunks.push(remaining.slice(0, splitIndex));
        remaining = remaining.slice(splitIndex).replace(/^\n/, '');
    }

    // Add part indicators for multi-part messages
    if (chunks.length > 1) {
        return chunks.map((chunk, i) => `[${i + 1}/${chunks.length}]\n${chunk}`);
    }

    return chunks;
}
