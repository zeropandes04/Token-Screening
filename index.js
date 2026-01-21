/**
 * Pump.fun Graduation Listener
 * 
 * Connects to PumpPortal WebSocket and listens for token migrations
 * (graduations) to Raydium. Only ~1% of tokens graduate, so this
 * filters out 99% of noise automatically.
 * 
 * When a graduation occurs, sends the CA to n8n for safety checks.
 */

import WebSocket from 'ws';
import fetch from 'node-fetch';
import 'dotenv/config';

// Configuration
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || '';
const PUMPPORTAL_WS = 'wss://pumpportal.fun/api/data';

// Track sent tokens to avoid duplicates
const sentTokens = new Set();
let reconnectDelay = 1000;
let totalGraduations = 0;
let totalSent = 0;

/**
 * Send graduated token to n8n webhook
 */
async function sendToN8n(tokenData) {
  if (!N8N_WEBHOOK_URL) {
    console.log('   ⚠️  N8N_WEBHOOK_URL not set');
    return false;
  }

  // Avoid duplicates
  if (sentTokens.has(tokenData.ca)) {
    console.log(`   ⏭️  Already sent: ${tokenData.ca.slice(0, 8)}...`);
    return false;
  }

  try {
    const response = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tokenData)
    });

    if (response.ok) {
      sentTokens.add(tokenData.ca);
      totalSent++;
      console.log(`   ✅ Sent to n8n: ${tokenData.symbol || tokenData.ca.slice(0, 8)}...`);
      return true;
    } else {
      console.log(`   ⚠️  n8n returned ${response.status}`);
      return false;
    }
  } catch (error) {
    console.error(`   ❌ Failed to send: ${error.message}`);
    return false;
  }
}

/**
 * Parse graduation event from PumpPortal
 */
function parseGraduationEvent(data) {
  try {
    // PumpPortal migration event structure
    const ca = data.mint || data.token || data.tokenAddress || data.ca;
    
    if (!ca) {
      console.log('   ⚠️  No CA found in event');
      return null;
    }

    return {
      // Core fields for n8n
      ca: ca,
      symbol: data.symbol || data.name || 'UNKNOWN',
      name: data.name || '',
      
      // Migration data if available
      liquidity_usd: data.vSolInBondingCurve ? data.vSolInBondingCurve * 200 : 0, // Rough estimate
      market_cap: data.marketCapSol ? data.marketCapSol * 200 : 0,
      
      // Event metadata
      event_type: 'graduation',
      dex: 'raydium',
      source: 'pumpportal_websocket',
      received_at: new Date().toISOString(),
      
      // Raw data for debugging
      raw_event: data
    };
  } catch (error) {
    console.error(`   Parse error: ${error.message}`);
    return null;
  }
}

/**
 * Handle incoming WebSocket message
 */
async function handleMessage(message) {
  try {
    const data = JSON.parse(message);
    
    // Debug: log message type
    const msgType = data.txType || data.type || data.event || 'unknown';
    
    // Check for migration/graduation events
    const isMigration = 
      msgType === 'migrate' ||
      msgType === 'migration' ||
      msgType === 'graduated' ||
      msgType === 'create' && data.pool === 'raydium' ||
      data.migrated === true ||
      (data.txType === 'create' && data.pool);
    
    if (isMigration) {
      totalGraduations++;
      console.log(`\n🎓 GRADUATION #${totalGraduations} detected!`);
      console.log(`   Type: ${msgType}`);
      console.log(`   Data: ${JSON.stringify(data).slice(0, 200)}...`);
      
      const tokenData = parseGraduationEvent(data);
      if (tokenData) {
        await sendToN8n(tokenData);
      }
    }
    
    // Also check for trade events with "complete" bonding curve
    if (data.txType === 'trade' && data.bondingCurveComplete === true) {
      totalGraduations++;
      console.log(`\n🎓 GRADUATION #${totalGraduations} (bonding complete)!`);
      
      const tokenData = parseGraduationEvent(data);
      if (tokenData) {
        await sendToN8n(tokenData);
      }
    }
    
  } catch (error) {
    // Not JSON or parse error - ignore
  }
}

/**
 * Connect to PumpPortal WebSocket
 */
function connect() {
  console.log(`🔌 Connecting to ${PUMPPORTAL_WS}...`);
  
  const ws = new WebSocket(PUMPPORTAL_WS);
  
  ws.on('open', () => {
    console.log('✅ Connected to PumpPortal WebSocket');
    reconnectDelay = 1000; // Reset delay on successful connection
    
    // Subscribe to migration events
    // Method 1: Subscribe to new token trades (includes graduations)
    ws.send(JSON.stringify({
      method: 'subscribeNewToken'
    }));
    
    // Method 2: Subscribe to account trades for migration account
    ws.send(JSON.stringify({
      method: 'subscribeAccountTrade',
      keys: ['39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg'] // Pump.fun migration account
    }));
    
    console.log('📡 Subscribed to graduation events');
    console.log('👀 Listening for migrations...\n');
  });
  
  ws.on('message', (message) => {
    handleMessage(message.toString());
  });
  
  ws.on('error', (error) => {
    console.error(`❌ WebSocket error: ${error.message}`);
  });
  
  ws.on('close', (code, reason) => {
    console.log(`\n🔌 Connection closed: ${code} ${reason}`);
    console.log(`   Reconnecting in ${reconnectDelay / 1000}s...`);
    
    setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, 60000); // Max 60s
      connect();
    }, reconnectDelay);
  });
  
  // Heartbeat to keep connection alive
  const heartbeat = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    } else {
      clearInterval(heartbeat);
    }
  }, 30000);
  
  return ws;
}

/**
 * Main entry point
 */
async function main() {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║         PUMP.FUN GRADUATION LISTENER                       ║
║         Real-time WebSocket via PumpPortal                 ║
╚════════════════════════════════════════════════════════════╝

Configuration:
  - PumpPortal WS: ${PUMPPORTAL_WS}
  - n8n Webhook: ${N8N_WEBHOOK_URL ? N8N_WEBHOOK_URL.slice(0, 50) + '...' : 'NOT SET'}

Why this works:
  - Only ~1% of Pump.fun tokens graduate to Raydium
  - We listen ONLY for graduation events (not all 24k daily launches)
  - Real-time push, not polling
  - 99% noise reduction built-in
`);

  if (!N8N_WEBHOOK_URL) {
    console.error('❌ N8N_WEBHOOK_URL environment variable is required');
    process.exit(1);
  }

  // Connect
  connect();
  
  // Stats every 5 minutes
  setInterval(() => {
    console.log(`\n📊 Stats: ${totalGraduations} graduations seen, ${totalSent} sent to n8n`);
  }, 300000);
}

// Shutdown handlers
process.on('SIGTERM', () => {
  console.log('\n👋 Shutting down...');
  console.log(`📊 Final: ${totalGraduations} graduations, ${totalSent} sent`);
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  console.log(`📊 Final: ${totalGraduations} graduations, ${totalSent} sent`);
  process.exit(0);
});

main();
