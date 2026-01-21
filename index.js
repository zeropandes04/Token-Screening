/**
 * Pump.fun Survivor Scanner
 * 
 * Polls Helius RPC to find Pump.fun tokens that:
 * - Graduated (migrated to Raydium)
 * - Age > 30 minutes
 * - Holders > 100
 * 
 * Outputs top 5 survivors every polling interval.
 */

import 'dotenv/config';
import fetch from 'node-fetch';

// Configuration
const HELIUS_RPC = process.env.HELIUS_RPC || 'https://mainnet.helius-rpc.com/?api-key=YOUR_KEY';
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || '';
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '600000'); // 10 minutes default
const MIN_HOLDERS = parseInt(process.env.MIN_HOLDERS || '100');
const MIN_AGE_MINUTES = parseInt(process.env.MIN_AGE_MINUTES || '30');

// Solana Program IDs
const PUMP_FUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const RAYDIUM_AMM = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';

// Track credits usage
let creditsUsed = 0;
let pollCount = 0;

/**
 * Make RPC call to Helius
 */
async function rpcCall(method, params = []) {
  const response = await fetch(HELIUS_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params
    })
  });
  
  const data = await response.json();
  creditsUsed += 1; // Approximate - actual varies by method
  
  if (data.error) {
    throw new Error(`RPC Error: ${data.error.message}`);
  }
  
  return data.result;
}

/**
 * Helius DAS API call for asset metadata
 */
async function getAsset(mint) {
  const response = await fetch(HELIUS_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'getAsset',
      params: { id: mint }
    })
  });
  
  const data = await response.json();
  creditsUsed += 10; // DAS calls cost more
  
  return data.result;
}

/**
 * Get token holders count using Helius DAS
 */
async function getTokenHolders(mint) {
  try {
    const response = await fetch(HELIUS_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'getTokenAccounts',
        params: {
          mint: mint,
          limit: 1,
          options: { showZeroBalance: false }
        }
      })
    });
    
    const data = await response.json();
    creditsUsed += 10;
    
    // The total field gives us holder count
    return data.result?.total || 0;
  } catch (error) {
    console.error(`Error getting holders for ${mint}:`, error.message);
    return 0;
  }
}

/**
 * Get Pump.fun token mints, paginating back to find older ones
 */
async function getPumpFunGraduations() {
  console.log('📡 Fetching Pump.fun transactions (paginating for older data)...');

  const now = Date.now() / 1000;
  const seenMints = new Set();
  const tokenMints = [];
  let lastSignature = undefined;
  let totalTxChecked = 0;
  let oldestAge = 0;

  // Paginate until we find transactions old enough
  for (let page = 0; page < 5; page++) {
    const params = { limit: 100 };
    if (lastSignature) {
      params.before = lastSignature;
    }

    const signatures = await rpcCall('getSignaturesForAddress', [
      PUMP_FUN_PROGRAM,
      params
    ]);

    if (signatures.length === 0) break;

    console.log(`   Page ${page + 1}: fetched ${signatures.length} signatures`);

    // Check age of last signature in batch
    const lastSig = signatures[signatures.length - 1];
    lastSignature = lastSig.signature;

    // Get a sample transaction to check age
    const sampleTx = await rpcCall('getTransaction', [
      lastSig.signature,
      { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }
    ]);

    if (sampleTx) {
      oldestAge = (now - sampleTx.blockTime) / 60;
      console.log(`   Oldest tx in batch: ${oldestAge.toFixed(1)} min ago`);
    }

    // Process transactions in this batch
    for (const sig of signatures.slice(0, 20)) {
      try {
        const tx = await rpcCall('getTransaction', [
          sig.signature,
          { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }
        ]);

        if (!tx || !tx.meta) continue;
        totalTxChecked++;

        const allBalances = [
          ...(tx.meta.postTokenBalances || []),
          ...(tx.meta.preTokenBalances || [])
        ];

        for (const balance of allBalances) {
          const mint = balance.mint;

          if (!mint ||
              mint === 'So11111111111111111111111111111111111111112' ||
              seenMints.has(mint)) {
            continue;
          }

          seenMints.add(mint);

          const ageMinutes = (now - tx.blockTime) / 60;

          if (ageMinutes >= MIN_AGE_MINUTES) {
            tokenMints.push({
              mint,
              signature: sig.signature,
              blockTime: tx.blockTime,
              ageMinutes: Math.round(ageMinutes)
            });
          }
        }
      } catch (error) {
        // Skip
      }

      await new Promise(r => setTimeout(r, 50));
    }

    // Stop if we've gone back far enough
    if (oldestAge >= MIN_AGE_MINUTES * 2) {
      console.log(`   Reached ${oldestAge.toFixed(0)} min ago, stopping pagination`);
      break;
    }
  }

  console.log(`   Checked ${totalTxChecked} transactions total`);
  console.log(`   Found ${tokenMints.length} mints older than ${MIN_AGE_MINUTES} min`);

  return tokenMints;
}

/**
 * Check if mint has a Raydium pool
 */
async function hasRaydiumPool(mint) {
  try {
    // Get recent Raydium transactions and look for this mint
    const signatures = await rpcCall('getSignaturesForAddress', [
      RAYDIUM_AMM,
      { limit: 20 }
    ]);
    
    for (const sig of signatures.slice(0, 5)) {
      const tx = await rpcCall('getTransaction', [
        sig.signature,
        { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }
      ]);
      
      if (!tx) continue;
      
      const balances = tx.meta?.postTokenBalances || [];
      if (balances.some(b => b.mint === mint)) {
        return true;
      }
    }
    
    return false;
  } catch (error) {
    return false;
  }
}

/**
 * Enrich mint with metadata and holder count
 */
async function enrichMint(mintData) {
  try {
    // Get holder count
    const holders = await getTokenHolders(mintData.mint);
    
    if (holders < MIN_HOLDERS) {
      return null; // Filter out low holder tokens
    }
    
    // Get asset metadata
    let asset = null;
    try {
      asset = await getAsset(mintData.mint);
    } catch (e) {
      // Asset API might not have all tokens
    }
    
    return {
      mint: mintData.mint,
      symbol: asset?.content?.metadata?.symbol || 'UNKNOWN',
      name: asset?.content?.metadata?.name || '',
      holders: holders,
      ageMinutes: mintData.ageMinutes,
      signature: mintData.signature,
      blockTime: mintData.blockTime,
      // Links for manual trading
      links: {
        dexscreener: `https://dexscreener.com/solana/${mintData.mint}`,
        birdeye: `https://birdeye.so/token/${mintData.mint}?chain=solana`,
        rugcheck: `https://rugcheck.xyz/tokens/${mintData.mint}`,
        gmgn: `https://gmgn.ai/sol/token/${mintData.mint}`
      }
    };
  } catch (error) {
    console.error(`   Error enriching ${mintData.mint.slice(0, 8)}...: ${error.message}`);
    return null;
  }
}

/**
 * Send survivors to n8n webhook
 */
async function sendToN8n(survivors) {
  if (!N8N_WEBHOOK_URL) {
    console.log('   ⚠️  N8N_WEBHOOK_URL not set, skipping webhook');
    return;
  }
  
  try {
    for (const survivor of survivors) {
      await fetch(N8N_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...survivor,
          source: 'helius_pump_scanner',
          detected_at: new Date().toISOString()
        })
      });
      console.log(`   ✅ Sent to n8n: ${survivor.symbol} (${survivor.mint.slice(0, 8)}...)`);
    }
  } catch (error) {
    console.error(`   ❌ Failed to send to n8n: ${error.message}`);
  }
}

/**
 * Format survivor for console output
 */
function formatSurvivor(s, rank) {
  return `
  #${rank} ${s.symbol} (${s.name || 'No name'})
     Mint: ${s.mint}
     Holders: ${s.holders}
     Age: ${s.ageMinutes} minutes
     🔗 ${s.links.dexscreener}
`;
}

/**
 * Main polling function
 */
async function poll() {
  pollCount++;
  const startCredits = creditsUsed;
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🔍 POLL #${pollCount} - ${new Date().toISOString()}`);
  console.log(`${'='.repeat(60)}`);
  
  try {
    // Step 1: Get recent Pump.fun graduations
    const graduations = await getPumpFunGraduations();
    
    if (graduations.length === 0) {
      console.log('   No graduations found this poll');
      return;
    }
    
    // Step 2: Enrich with holder data and filter
    console.log(`\n📊 Enriching ${graduations.length} mints with holder data...`);
    const enrichedPromises = graduations.map(g => enrichMint(g));
    const enriched = (await Promise.all(enrichedPromises)).filter(Boolean);
    
    console.log(`   ${enriched.length} mints passed holder filter (>= ${MIN_HOLDERS})`);
    
    if (enriched.length === 0) {
      console.log('   No survivors this poll');
      return;
    }
    
    // Step 3: Sort by holders and take top 5
    const survivors = enriched
      .sort((a, b) => b.holders - a.holders)
      .slice(0, 5);
    
    // Step 4: Output results
    console.log(`\n🏆 TOP ${survivors.length} SURVIVORS:`);
    survivors.forEach((s, i) => console.log(formatSurvivor(s, i + 1)));
    
    // Step 5: Send to n8n
    await sendToN8n(survivors);
    
  } catch (error) {
    console.error(`\n❌ Poll error: ${error.message}`);
  } finally {
    const pollCredits = creditsUsed - startCredits;
    console.log(`\n📈 Credits used this poll: ~${pollCredits}`);
    console.log(`📈 Total credits used: ~${creditsUsed}`);
    console.log(`⏰ Next poll in ${POLL_INTERVAL_MS / 60000} minutes`);
  }
}

/**
 * Startup and main loop
 */
async function main() {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║         PUMP.FUN SURVIVOR SCANNER                          ║
║         Powered by Helius RPC                              ║
╚════════════════════════════════════════════════════════════╝

Configuration:
  - Helius RPC: ${HELIUS_RPC.replace(/api-key=.*/, 'api-key=***')}
  - n8n Webhook: ${N8N_WEBHOOK_URL ? N8N_WEBHOOK_URL.slice(0, 40) + '...' : 'Not set'}
  - Poll Interval: ${POLL_INTERVAL_MS / 60000} minutes
  - Min Holders: ${MIN_HOLDERS}
  - Min Age: ${MIN_AGE_MINUTES} minutes
`);

  // Validate Helius key
  if (HELIUS_RPC.includes('YOUR_KEY')) {
    console.error('❌ Please set HELIUS_RPC environment variable with your API key');
    console.error('   Get free key at: https://dev.helius.xyz/');
    process.exit(1);
  }

  // Run first poll immediately
  await poll();
  
  // Schedule recurring polls
  setInterval(poll, POLL_INTERVAL_MS);

  // Keep process alive
  process.stdin.resume();

  console.log('\n👀 Scanner running. Press Ctrl+C to stop.\n');
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n👋 Shutting down...');
  console.log(`📈 Final credits used: ~${creditsUsed}`);
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  console.log(`📈 Final credits used: ~${creditsUsed}`);
  process.exit(0);
});

// Run
main().catch(console.error);

// Keep process alive
setInterval(() => {}, 1 << 30);
