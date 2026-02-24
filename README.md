# ConnectWithAllCode

> Connect to all your coding agents — Claude Code, Antigravity, Cursor, Windsurf — from WhatsApp. Everything runs locally on your machine.

⚠️ **Disclaimer**: This project uses [Baileys](https://github.com/WhiskeySockets/Baileys) (WhatsApp Web protocol) which is **not officially supported by WhatsApp**. Use a secondary number to avoid any risk of account restrictions.

## Architecture

```
WhatsApp ←→ Baileys (WhatsApp Web protocol) ←→ Gateway (localhost:3000) ←→ Connector Daemon ←→ Agent CLI
```

Everything runs on **your local machine**. No ngrok, no Meta Developer account, no API keys — just scan a QR code.

## Prerequisites

1. **Node.js** ≥ 18
2. **Claude Code CLI** — `npm install -g @anthropic-ai/claude-code`
3. **A WhatsApp account** (recommend a secondary number)

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Start Gateway

```bash
bash start-local.sh
```

Or manually:

```bash
npm run dev:gateway
```

### 3. Scan the QR Code

A QR code will appear in your terminal. Scan it with WhatsApp:

**WhatsApp → Settings → Linked Devices → Link a Device**

> After the first scan, your session is saved to `gateway/auth_store/`. You won't need to scan again unless you log out.

### 4. Get a Pairing Code

Send `/pair` to yourself on WhatsApp. You'll receive a code like `ABCD-1234`.

### 5. Start Connector (Terminal 2)

```bash
npm run dev:connector -- --pair ABCD-1234
```

### 6. Send Tasks!

```
/claude review the auth middleware in src/auth.ts
/status
/help
```

## Commands

| Command | Description |
|---|---|
| `/claude <prompt>` or `/cc <prompt>` | Send to Claude Code |
| `/gemini <prompt>` or `/gm <prompt>` | Send to Gemini CLI |
| `/codex <prompt>` or `/cx <prompt>` | Send to Codex |
| `/opencode <prompt>` or `/oc <prompt>` | Send to opencode |
| `/status` | Show agent availability |
| `/default <agent> [workspace]` | Set default agent |
| `/history` | Show recent tasks |
| `/cancel` | Cancel active task |
| `/pair [code]` | Pair your dev machine |
| `/help` | Show help |

## Project Structure

```
connect-with-all-code/
├── shared/         # Shared types and WebSocket protocol
├── gateway/        # Baileys WhatsApp client + WebSocket server
│   └── auth_store/ # WhatsApp session (created on first run)
├── connector/      # Agent dispatcher daemon
├── start-local.sh  # One-command startup script
└── PRODUCT_SPEC.md # Full product specification
```

## Configuration

The connector reads config from `~/.cwac/config.yaml` (auto-created on first run).
See `connector/.cwac.example.yaml` for all available options.

## How It Works

1. **Gateway** connects to WhatsApp via Baileys (WhatsApp Web multi-device protocol)
2. You **send a message** on WhatsApp (e.g., `/claude fix the login bug`)
3. **Gateway** parses the command and dispatches the task via WebSocket to the connector
4. **Connector** receives the task and runs it against the agent CLI (e.g., `claude -p`)
5. **Response** flows back: Connector → Gateway → WhatsApp → your phone
