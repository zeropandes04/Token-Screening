# Pump.fun Survivor Scanner

Polls Helius RPC to find Pump.fun tokens that have "survived" — meaning they:
- Graduated from Pump.fun bonding curve
- Migrated to Raydium liquidity pool
- Are at least 30 minutes old
- Have 100+ holders

Outputs top 5 survivors every poll interval for manual trading.

## Cost: $0/month

Uses Helius free tier (1M credits/month). At default settings (~3k credits/poll, 10 min interval), you'll use ~400k credits/month.

## Setup

### 1. Get Helius API Key (Free)

1. Go to https://dev.helius.xyz/
2. Sign up / Log in
3. Create new project
4. Copy your API key

### 2. Local Testing

```bash
# Clone repo
git clone https://github.com/YOUR_USERNAME/helius-pump-scanner
cd helius-pump-scanner

# Install dependencies
npm install

# Set environment variables
export HELIUS_RPC="https://mainnet.helius-rpc.com/?api-key=YOUR_KEY_HERE"
export N8N_WEBHOOK_URL="https://your-n8n.onrender.com/webhook/token-webhook"

# Run
npm start
```

### 3. Deploy to Render

1. Push to GitHub
2. Create new **Background Worker** on Render
3. Connect repo
4. Set environment variables:
   - `HELIUS_RPC` = `https://mainnet.helius-rpc.com/?api-key=YOUR_KEY`
   - `N8N_WEBHOOK_URL` = Your n8n webhook URL
5. Deploy

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `HELIUS_RPC` | Yes | - | Helius RPC endpoint with API key |
| `N8N_WEBHOOK_URL` | No | - | n8n webhook to send survivors |
| `POLL_INTERVAL_MS` | No | 600000 | Poll interval in ms (default 10 min) |
| `MIN_HOLDERS` | No | 100 | Minimum holder count filter |
| `MIN_AGE_MINUTES` | No | 30 | Minimum token age in minutes |

## Output Format

Console output:
```
🏆 TOP 5 SURVIVORS:

  #1 PEPE (Pepe Token)
     Mint: 7xKXtg2CedSmT...
     Holders: 1,234
     Age: 45 minutes
     🔗 https://dexscreener.com/solana/7xKXtg2CedSmT...
```

Webhook payload:
```json
{
  "mint": "7xKXtg2CedSmT...",
  "symbol": "PEPE",
  "name": "Pepe Token",
  "holders": 1234,
  "ageMinutes": 45,
  "links": {
    "dexscreener": "https://dexscreener.com/solana/...",
    "birdeye": "https://birdeye.so/token/...",
    "rugcheck": "https://rugcheck.xyz/tokens/...",
    "gmgn": "https://gmgn.ai/sol/token/..."
  },
  "source": "helius_pump_scanner",
  "detected_at": "2025-01-20T12:00:00.000Z"
}
```

## Credits Usage

Approximate credits per poll:
- getSignaturesForAddress: ~50 credits
- getTransaction (x20): ~200 credits  
- getTokenAccounts (x10): ~1000 credits
- getAsset (x10): ~1000 credits
- **Total: ~2-3k credits/poll**

At 10-minute intervals:
- 6 polls/hour × 24 hours × 30 days = 4,320 polls/month
- 4,320 × 3,000 = **~13M credits/month** ⚠️

**To stay under 1M free limit, increase poll interval to 30+ minutes:**
```
POLL_INTERVAL_MS=1800000  # 30 minutes
```

This gives: 1,440 polls × 3k = ~4.3M credits (still over)

**For free tier, use 60 minute intervals:**
```
POLL_INTERVAL_MS=3600000  # 60 minutes
```

720 polls × 3k = ~2.1M credits

Or reduce the number of transactions checked per poll.

## How It Works

1. **Fetch Pump.fun transactions** — Get recent program signatures
2. **Find graduations** — Look for withdraw/migrate logs indicating bonding curve completion
3. **Extract mints** — Get token mint addresses from transaction balances
4. **Filter by age** — Only tokens older than 30 minutes
5. **Get holder counts** — Use Helius DAS API
6. **Filter by holders** — Only tokens with 100+ holders
7. **Sort and output** — Top 5 by holder count
8. **Send to n8n** — Forward to your screening pipeline

## Why Survivors?

Instead of racing to snipe at launch (where you compete with bots), this approach:
- Waits for tokens to prove themselves
- Filters out 98%+ of rugs (they die in first 30 min)
- Focuses on tokens with real community (100+ holders)
- Gives you time to research before buying

The tradeoff: You won't catch the 100x moonshots at launch, but you'll avoid most rugs.
