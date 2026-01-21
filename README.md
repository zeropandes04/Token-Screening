# Pump.fun Graduation Listener

Listens for Pump.fun token **graduations** (migrations to Raydium) via PumpPortal WebSocket.

## Why Graduations?

- Only ~1.13% of Pump.fun tokens graduate
- 98.6% fail instantly - graduation filters these out
- Real-time push, no polling needed
- 99% noise reduction built-in

## Setup

### Environment Variables

```
N8N_WEBHOOK_URL=https://your-n8n.onrender.com/webhook/token-webhook
```

### Deploy to Render

1. Push to GitHub
2. Create Background Worker on Render
3. Set `N8N_WEBHOOK_URL` environment variable
4. Deploy

### Local Testing

```bash
npm install
export N8N_WEBHOOK_URL="https://your-n8n.onrender.com/webhook/token-webhook"
npm start
```

## Output

When a token graduates, sends to n8n:

```json
{
  "ca": "TokenMintAddress...",
  "symbol": "PEPE",
  "event_type": "graduation",
  "dex": "raydium",
  "source": "pumpportal_websocket",
  "received_at": "2025-01-21T12:00:00.000Z"
}
```

## Expected Volume

- ~200-400 graduations per day (vs 24,000+ launches)
- Your n8n will only process tokens that already proved market demand
