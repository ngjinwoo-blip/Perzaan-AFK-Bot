const mineflayer = require('mineflayer');
const config = require('./settings.json');
const express = require('express');
const http = require('http');

// ============================================================
// GLOBAL RECONNECT LOCK - Prevents duplicate connections
// ============================================================
let reconnecting = false;

// ============================================================
// DEDICATED PACKET LISTENER REFERENCE
// ============================================================
let packetListener = null;

// ============================================================
// ACTIVITY LOOP GUARD
// ============================================================
let activityLoopRunning = false;

// ============================================================
// GLOBAL INTERVAL TRACKING - Prevents interval leaks
// ============================================================
const globalIntervals = new Set();

function safeGlobalInterval(fn, delay) {
  const interval = setInterval(fn, delay);
  globalIntervals.add(interval);
  return interval;
}

function clearGlobalIntervals() {
  for (const i of globalIntervals) {
    clearInterval(i);
  }
  globalIntervals.clear();
}

// ============================================================
// EXPRESS SERVER - Keep Render/Aternos alive
// ============================================================
const app = express();
const PORT = process.env.PORT || 5000;

// Bot state tracking
let botState = {
  connected: false,
  lastActivity: Date.now(),
  reconnectAttempts: 0,
  startTime: Date.now(),
  errors: [],
  lastPacketTime: Date.now(),
  lastPositionUpdate: Date.now(),
  lastChunkUpdate: Date.now(),
  lastEntityUpdate: Date.now(),
  reconnectHistory: []
};

// Track if bot is currently in the process of joining/loading
let isJoining = false;

// Health check endpoint for monitoring
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>${config.name} Status</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            background: linear-gradient(135deg, #050505, #0d0614, #140021, #050505);
            color: #f8fafc; 
            display: flex; 
            justify-content: center; 
            align-items: center; 
            height: 100vh; 
            margin: 0; 
            overflow: hidden;
            position: relative;
          }
          .particles::before,
          .particles::after {
            content: "";
            position: fixed;
            width: 100%;
            height: 100%;
            top: 0;
            left: 0;
            pointer-events: none;
            background-image:
              radial-gradient(#ff3b3b 1px, transparent 1px),
              radial-gradient(#ffd700 1px, transparent 1px);
            background-size: 120px 120px;
            animation: particlesMove 18s linear infinite;
            opacity: 0.35;
            z-index: 0;
          }
          .particles::after {
            animation-duration: 30s;
            opacity: 0.2;
            filter: blur(1px);
          }
          @keyframes particlesMove {
            from {
              transform: translateY(-100px);
            }
            to {
              transform: translateY(100vh);
            }
          }
          .container {
            background: rgba(20, 10, 40, 0.88);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(168, 85, 247, 0.25);
            padding: 40px;
            border-radius: 20px;
            box-shadow: 0 0 50px rgba(45, 212, 191, 0.2);
            text-align: center;
            width: 400px;
            transition: box-shadow 0.3s ease;
            position: relative;
            z-index: 1;
          }
          h1 { 
            margin-bottom: 30px; 
            font-size: 24px; 
            color: #4ade80; 
            text-shadow: 0 0 15px rgba(74, 222, 128, 0.8);
            display: flex; 
            align-items: center; 
            justify-content: center; 
            gap: 10px; 
          }
          .stat-card {
            background: #0f172a;
            padding: 15px;
            margin: 15px 0;
            border-radius: 12px;
            border-left: 5px solid #2dd4bf;
            text-align: left;
            box-shadow: 0 0 10px rgba(168,85,247,0.18), 0 0 20px rgba(255,0,80,0.08);
            position: relative;
            overflow: hidden;
          }
          .label { font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; }
          .value { font-size: 18px; font-weight: bold; color: #2dd4bf; text-shadow: 0 0 10px rgba(45, 212, 191, 0.5); margin-top: 5px; }
          .value.coords { 
            color: #facc15; 
            text-shadow: 0 0 12px rgba(250, 204, 21, 0.7); 
          }
          .value.ip-hidden {
            color: #94a3b8;
            text-shadow: none;
          }
          .status-dot { 
            height: 12px; width: 12px; 
            border-radius: 50%; 
            display: inline-block; 
            margin-right: 8px;
            box-shadow: 0 0 10px currentColor;
            transition: color 0.3s ease, box-shadow 0.3s ease;
            background-color: currentColor;
          }
          .pulse { animation: pulse 2s infinite; }
          @keyframes pulse {
            0% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.5; transform: scale(1.1); }
            100% { opacity: 1; transform: scale(1); }
          }
          @keyframes gradientMove {
            0% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
            100% { background-position: 0% 50%; }
          }
          .btn-guide {
            display: inline-block; 
            margin-top: 20px; 
            padding: 12px 24px; 
            background: linear-gradient(90deg, #ffd700, #ffb300, #ffdf6b);
            background-size: 300% 300%;
            animation: gradientMove 6s ease infinite;
            color: #111; 
            text-decoration: none; 
            border-radius: 8px; 
            font-weight: bold; 
            box-shadow: 0 0 12px rgba(255,215,0,0.5);
            transition: transform 0.2s;
          }
          .btn-guide:hover { transform: translateY(-2px); }
          .connection-bar {
            height: 4px; background: #334155; width: 100%; margin-top: 20px; border-radius: 2px; overflow: hidden;
          }
          .connection-fill {
            height: 100%; width: 100%; background: #2dd4bf;
            animation: loading 2s infinite linear;
            transform-origin: 0% 50%;
          }
          @keyframes loading {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(100%); }
          }
        </style>
      </head>
      <body>
        <div class="particles"></div>
        <div class="container" id="main-container">
          <h1>
            <span id="live-indicator" class="status-dot pulse" style="color: #ef4444;"></span> 
            ${config.name}
          </h1>
          
          <div class="stat-card">
            <div class="label">Status</div>
            <div class="value" id="status-text">Connecting...</div>
          </div>

          <div class="stat-card">
            <div class="label">Uptime</div>
            <div class="value" id="uptime-text">0h 0m 0s</div>
          </div>

          <div class="stat-card">
            <div class="label">Coordinates</div>
            <div class="value coords" id="coords-text">Waiting...</div>
          </div>

          <div class="stat-card">
            <div class="label">Server</div>
            <div class="value ip-hidden">Protected Server 🔒</div>
          </div>

          <a href="/tutorial" class="btn-guide">View Setup Guide</a>
          
          <div class="connection-bar">
            <div class="connection-fill" id="activity-bar"></div>
          </div>
          
          <p style="color: #64748b; font-size: 12px; margin-top: 15px;">
            Minecraft AFK Bot v5.4 — Ultimate Stability Edition
          </p>
        </div>

        <script>
          const formatUptime = (seconds) => {
            const h = Math.floor(seconds / 3600);
            const m = Math.floor((seconds % 3600) / 60);
            const s = seconds % 60;
            return \`\${h}h \${m}m \${s}s\`;
          };

          const updateStats = async () => {
            try {
              const res = await fetch('/health');
              const data = await res.json();
              
              const statusText = document.getElementById('status-text');
              const uptimeText = document.getElementById('uptime-text');
              const coordsText = document.getElementById('coords-text');
              const liveDot = document.getElementById('live-indicator');
              const container = document.getElementById('main-container');

              if (data.status === 'connected') {
                statusText.innerHTML = '<span class="status-dot" style="color: #4ade80;"></span> Online & Running';
                statusText.style.color = '#2dd4bf';
                liveDot.style.color = '#4ade80';
                container.style.boxShadow = '0 0 50px rgba(45, 212, 191, 0.2)';
              } else {
                statusText.innerHTML = '<span class="status-dot" style="color: #f87171;"></span> Reconnecting...';
                statusText.style.color = '#f87171';
                liveDot.style.color = '#f87171';
                container.style.boxShadow = '0 0 50px rgba(248, 113, 113, 0.2)';
              }

              uptimeText.innerText = formatUptime(data.uptime);

              if (data.coords) {
                coordsText.innerText = \`Coords: \${Math.floor(data.coords.x)}, \${Math.floor(data.coords.y)}, \${Math.floor(data.coords.z)}\`;
              } else {
                coordsText.innerText = 'Unknown Location';
              }

            } catch (e) {
              document.getElementById('status-text').innerText = 'System Offline';
              document.getElementById('live-indicator').style.color = '#64748b';
            }
          };

          setInterval(updateStats, 10000);
          updateStats();
        </script>
      </body>
    </html>
  `);
});

app.get('/tutorial', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>${config.name} - Setup Guide</title>
        <style>
          body { font-family: 'Segoe UI', sans-serif; background: #0f172a; color: #cbd5e1; padding: 40px; max-width: 800px; margin: 0 auto; line-height: 1.6; }
          h1, h2 { color: #2dd4bf; }
          h1 { border-bottom: 2px solid #334155; padding-bottom: 10px; }
          .card { background: #1e293b; padding: 25px; border-radius: 12px; margin-bottom: 20px; border: 1px solid #334155; }
          a { color: #38bdf8; text-decoration: none; }
          code { background: #334155; padding: 2px 6px; border-radius: 4px; color: #e2e8f0; font-family: monospace; }
          .btn-home { display: inline-block; margin-bottom: 20px; padding: 8px 16px; background: #334155; color: white; border-radius: 6px; text-decoration: none; }
        </style>
      </head>
      <body>
        <a href="/" class="btn-home">Back to Dashboard</a>
        <h1>Setup Guide (Under 15 Minutes)</h1>
        
        <div class="card">
          <h2>Step 1: Configure Aternos</h2>
          <ol>
            <li>Go to <strong>Aternos</strong>.</li>
            <li>Install <strong>Paper/Bukkit</strong> software.</li>
            <li>Enable <strong>Cracked</strong> mode (Green Switch).</li>
            <li>Install Plugins: <code>ViaVersion</code>, <code>ViaBackwards</code>, <code>ViaRewind</code>.</li>
          </ol>
        </div>

        <div class="card">
          <h2>Step 2: GitHub Setup</h2>
          <ol>
            <li>Download this code as ZIP and extract.</li>
            <li>Edit <code>settings.json</code> with your IP/Port.</li>
            <li>Upload all files to a new <strong>GitHub Repository</strong>.</li>
          </ol>
        </div>

        <div class="card">
          <h2>Step 3: Render (Free 24/7 Hosting)</h2>
          <ol>
            <li>Go to <a href="https://render.com" target="_blank">Render.com</a> and create a Web Service.</li>
            <li>Connect your GitHub.</li>
            <li>Build Command: <code>npm install</code></li>
            <li>Start Command: <code>node index.js</code></li>
            <li><strong>Magic:</strong> The bot automatically pings itself to stay awake!</li>
          </ol>
        </div>
        
        <p style="text-align: center; margin-top: 40px; color: #64748b;">Minecraft AFK Bot v5.4 — Ultimate Stability</p>
      </body>
    </html>
  `);
});

app.get('/health', (req, res) => {
  res.json({
    status: botState.connected ? 'connected' : 'disconnected',
    uptime: Math.floor((Date.now() - botState.startTime) / 1000),
    coords: (bot && bot.entity) ? bot.entity.position : null,
    lastActivity: botState.lastActivity,
    reconnectAttempts: botState.reconnectAttempts,
    memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024,
    lastPacketTime: botState.lastPacketTime
  });
});

app.get('/ping', (req, res) => res.send('pong'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] HTTP server started on port ${PORT}`);
});

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}h ${m}m ${s}s`;
}

// ============================================================
// SELF-PING - Prevent Render from sleeping
// ============================================================
const SELF_PING_INTERVAL = 5 * 60 * 1000;
const https = require('https');

function startSelfPing() {
  safeGlobalInterval(() => {
    const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    const protocol = url.startsWith('https') ? https : http;

    protocol.get(`${url}/ping`, (res) => {
      // Silent ping to keep Render alive
    }).on('error', (err) => {
      console.log(`[KeepAlive] Self-ping failed: ${err.message}`);
    });
  }, SELF_PING_INTERVAL);
  console.log('[KeepAlive] Self-ping system started (every 5 min)');
}

startSelfPing();

// ============================================================
// MEMORY MONITORING - Using heapUsed instead of RSS
// ============================================================
safeGlobalInterval(() => {
  const heapUsed = process.memoryUsage().heapUsed / 1024 / 1024;
  const rss = process.memoryUsage().rss / 1024 / 1024;

  console.log(`[Memory] Heap: ${heapUsed.toFixed(2)} MB | RSS: ${rss.toFixed(2)} MB`);

  if (heapUsed > 430) {
    console.log('[Memory] Critical heap memory usage — restarting');
    process.exit(1);
  }
}, 300000);

// ============================================================
// AUTO GARBAGE COLLECTION
// ============================================================
safeGlobalInterval(() => {
  if (global.gc) {
    const before = process.memoryUsage().heapUsed / 1024 / 1024;

    global.gc();

    const after = process.memoryUsage().heapUsed / 1024 / 1024;

    console.log(
      `[GC] Garbage collected | ${before.toFixed(2)}MB -> ${after.toFixed(2)}MB`
    );
  } else {
    console.log('[GC] Garbage collector unavailable');
  }
}, 1000 * 60 * 10); // every 10 min

// ============================================================
// HEARTBEAT LOGGER - Keeps Render stream alive for debugging
// ============================================================
safeGlobalInterval(() => {
  console.log(`[Heartbeat] Bot alive | ${new Date().toISOString()}`);
}, 600000);

console.log('[Heartbeat] Heartbeat logger started (every 10 min)');

// ============================================================
// CENTRAL TIMEOUT REGISTRY - Prevents timeout leaks
// ============================================================
class TimeoutRegistry {
  constructor() {
    this.timeouts = new Set();
    this.intervals = new Set();
    this.destroyed = false;
  }

  setTimeout(callback, delay) {
    if (this.destroyed) return null;
    const timeout = setTimeout(() => {
      this.timeouts.delete(timeout);
      if (!this.destroyed) callback();
    }, delay);
    this.timeouts.add(timeout);
    return timeout;
  }

  setInterval(callback, delay) {
    if (this.destroyed) return null;
    const interval = setInterval(() => {
      if (!this.destroyed) callback();
    }, delay);
    this.intervals.add(interval);
    return interval;
  }

  clearAll() {
    this.destroyed = true;
    this.timeouts.forEach(t => clearTimeout(t));
    this.intervals.forEach(i => clearInterval(i));
    this.timeouts.clear();
    this.intervals.clear();
    console.log(`[TimeoutRegistry] Cleared all timers`);
  }

  clearTimeout(timeout) {
    if (timeout) {
      clearTimeout(timeout);
      this.timeouts.delete(timeout);
    }
  }

  getActiveCount() {
    return this.timeouts.size + this.intervals.size;
  }
}

// ============================================================
// BOT CREATION WITH RECONNECTION LOGIC
// ============================================================
let bot = null;
let botTimeoutRegistry = new TimeoutRegistry();
let reconnectTimeout = null;
let watchdogInterval = null;
let activityScheduled = false;
let activityManager = null;
let firstRegistrationDone = false;

function cleanupBot() {
  console.log('[Cleanup] Starting bot cleanup...');
  
  if (botTimeoutRegistry) {
    botTimeoutRegistry.clearAll();
    botTimeoutRegistry = new TimeoutRegistry();
  }
  
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  
  if (watchdogInterval) {
    clearInterval(watchdogInterval);
    watchdogInterval = null;
  }
  
  activityScheduled = false;
  activityManager = null;
  activityLoopRunning = false;
  
  // SAFE: Remove packet listener using reference
  if (packetListener && bot && bot._client) {
    try {
      bot._client.off('packet', packetListener);
    } catch (e) {
      console.log('[Cleanup] Error removing packet listener:', e.message);
    }
  }
  packetListener = null;
  
  if (bot) {
    try {
      // Remove all listeners to prevent memory leaks
      bot.removeAllListeners();
      
      // Safely destroy socket
      if (bot._client && bot._client.socket) {
        try {
          bot._client.socket.removeAllListeners();
          if (!bot._client.socket.destroyed) {
            bot._client.socket.destroy();
          }
        } catch (e) {
          console.log('[Cleanup] Error destroying socket:', e.message);
        }
      }
      
      // Remove client listeners
      if (bot._client) {
        try {
          bot._client.removeAllListeners();
        } catch (e) {
          console.log('[Cleanup] Error removing client listeners:', e.message);
        }
      }
      
      bot.end();
    } catch (e) {
      console.log('[Cleanup] Error ending bot:', e.message);
    }
    bot = null;
  }
  
  console.log('[Cleanup] Bot cleanup completed');
}

function getReconnectDelay() {
  const now = Date.now();
  
  // Keep reconnect history limited to prevent memory growth
  botState.reconnectHistory = botState.reconnectHistory.filter(time => now - time < 300000);
  
  // Limit array size
  if (botState.reconnectHistory.length > 10) {
    botState.reconnectHistory = botState.reconnectHistory.slice(-10);
  }
  
  botState.reconnectHistory.push(now);
  
  if (botState.reconnectHistory.length > 3) {
    const recentReconnects = botState.reconnectHistory.filter(time => now - time < 60000);
    if (recentReconnects.length > 3) {
      console.log('[Reconnect] Too many reconnects, applying cooldown');
      const cooldownDelay = 120000 + Math.floor(Math.random() * 180000);
      return cooldownDelay;
    }
  }
  
  const baseDelay = config.utils['auto-reconnect-delay'] || 5000;
  const maxDelay = config.utils['max-reconnect-delay'] || 60000;
  const delay = Math.min(baseDelay * Math.pow(1.5, Math.min(botState.reconnectAttempts, 5)), maxDelay);
  const jitter = Math.floor(Math.random() * 4000);
  
  return Math.floor(delay + jitter);
}

function createBot() {
  // CRITICAL: Check global reconnect lock
  if (reconnecting) {
    console.log('[Bot] Global reconnect lock active, skipping createBot...');
    return;
  }
  
  // CRITICAL: Check if already joining
  if (isJoining) {
    console.log('[Bot] Already joining, skipping createBot...');
    return;
  }
  
  // CRITICAL: Set lock before any async operations
  reconnecting = true;

  // Clean up old bot completely
  cleanupBot();
  
  console.log(`[Bot] Creating bot instance...`);
  console.log(`[Bot] Connecting to ${config.server.ip}:${config.server.port}`);

  isJoining = true;

  try {
    bot = mineflayer.createBot({
      username: config['bot-account'].username,
      password: config['bot-account'].password || undefined,
      auth: config['bot-account'].type,
      host: config.server.ip,
      port: config.server.port,
      version: '1.21.9',
      hideErrors: false,
      checkTimeoutInterval: 120000,
      keepAlive: true,
      skipValidation: true,
      viewDistance: 'tiny',
    });

    bot.once('login', () => {
      if (bot._client && bot._client.socket) {
        const socket = bot._client.socket;
        
        socket.setKeepAlive(true, 30000);
        socket.setNoDelay(true);
        socket.setTimeout(600000); // Increased to 10 minutes
        
        socket.on('timeout', () => {
          console.log('[Socket] Timeout detected, connection may be unstable');
          botState.lastActivity = Date.now();
        });
        
        socket.on('error', (err) => {
          if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
            console.log(`[Socket] Connection issue: ${err.code}, will reconnect`);
          }
        });
      }
      
      // SAFE: Use dedicated packet listener instead of removeAllListeners
      if (bot._client) {
        // Remove old packet listener safely
        if (packetListener) {
          bot._client.off('packet', packetListener);
        }
        
        packetListener = () => {
          botState.lastPacketTime = Date.now();
        };
        
        bot._client.on('packet', packetListener);
      }
    });

    bot.on('move', () => {
      botState.lastPositionUpdate = Date.now();
    });
    
    bot.on('chunkColumnLoad', () => {
      botState.lastChunkUpdate = Date.now();
    });
    
    bot.on('entityUpdate', () => {
      botState.lastEntityUpdate = Date.now();
    });

    bot._client.on('compress', () => {
      console.log('[Bot] Compression enabled - Aternos connection stabilized');
    });

    bot._client.on('success', () => {
      console.log('[Bot] Login successful');
    });

    const connectionTimeout = botTimeoutRegistry.setTimeout(() => {
      if (!botState.connected) {
        console.log('[Bot] Connection timeout - no spawn received');
        isJoining = false;
        reconnecting = false;
        scheduleReconnect();
      }
    }, 120000);

    bot.once('spawn', () => {
      botTimeoutRegistry.clearTimeout(connectionTimeout);
      clearTimeout(connectionTimeout);
      
      botState.connected = true;
      botState.lastActivity = Date.now();
      botState.lastPositionUpdate = Date.now();
      botState.reconnectAttempts = 0;
      isJoining = false;
      activityScheduled = false;
      activityLoopRunning = false;
      
      // CRITICAL: Release reconnect lock only after successful spawn
      reconnecting = false;

      console.log(`[Bot] [+] Successfully spawned on server!`);
      if (config.discord && config.discord.events.connect) {
        sendDiscordWebhook(`[+] **Connected** to \`${config.server.ip}\``, 0x4ade80);
      }

      initializeModules(bot);
      startWatchdog();
      startGhostConnectionDetector();
      startPositionSafetyCheck();
    });

    bot.on('end', (reason) => {
      console.log(`[Bot] Disconnected: ${reason || 'Unknown reason'}`);
      botState.connected = false;
      isJoining = false;

      if (config.discord && config.discord.events.disconnect && reason !== 'Scheduled refresh') {
        sendDiscordWebhook(`[-] **Disconnected**: ${reason || 'Unknown'}`, 0xf87171);
      }

      if (config.utils['auto-reconnect']) {
        scheduleReconnect();
      }
    });

    bot.on('kicked', (reason) => {
      console.log(`[Bot] Kicked: ${reason}`);
      botState.connected = false;
      isJoining = false;
      
      // Keep error array limited
      if (botState.errors.length > 20) {
        botState.errors.shift();
      }
      botState.errors.push({ type: 'kicked', reason, time: Date.now() });

      if (config.discord && config.discord.events.disconnect) {
        sendDiscordWebhook(`[!] **Kicked**: ${reason}`, 0xff0000);
      }

      if (config.utils['auto-reconnect']) {
        scheduleReconnect();
      }
    });

    bot.on('error', (err) => {
      console.log(`[Bot] Error: ${err.message}`);
      if (botState.errors.length > 20) {
        botState.errors.shift();
      }
      botState.errors.push({ type: 'error', message: err.message, time: Date.now() });
    });

  } catch (err) {
    console.log(`[Bot] Failed to create bot: ${err.message}`);
    isJoining = false;
    reconnecting = false;
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  // CRITICAL: Check all locks before reconnecting
  if (reconnecting) {
    console.log('[Reconnect] Global reconnect lock active, skipping...');
    return;
  }
  
  if (isJoining) {
    console.log('[Reconnect] Bot is joining, skipping...');
    return;
  }

  reconnecting = true;
  botState.connected = false;

  // Clean up bot if it still exists
  if (bot) {
    try {
      bot.removeAllListeners();
      if (bot._client && bot._client.socket) {
        bot._client.socket.removeAllListeners();
        if (!bot._client.socket.destroyed) {
          bot._client.socket.destroy();
        }
      }
      if (bot._client) {
        bot._client.removeAllListeners();
      }
      bot.end();
    } catch (e) {
      console.log('[Reconnect] Error during cleanup:', e.message);
    }
    bot = null;
  }

  if (watchdogInterval) {
    clearInterval(watchdogInterval);
    watchdogInterval = null;
  }
  
  activityScheduled = false;
  activityLoopRunning = false;

  botState.reconnectAttempts++;

  const delay = getReconnectDelay();
  console.log(`[Reconnect] Scheduling reconnect in ${delay/1000}s (attempt #${botState.reconnectAttempts})`);

  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
  }

  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null;
    
    // CRITICAL: Add 10 second safety delay before creating new bot
    console.log('[Reconnect] Waiting 10s for old socket to fully die...');
    
    setTimeout(() => {
      // SAFE: Check connection state BEFORE releasing lock
      if (bot && botState.connected) {
        console.log('[Reconnect] Already connected, skipping reconnect');
        reconnecting = false;
        return;
      }
      
      reconnecting = false;
      createBot();
    }, 10000); // 10 second safety delay
    
  }, delay);
}

// ============================================================
// PERIODIC CLEAN REFRESH - Prevents stale sockets & ghost states
// ============================================================
const RESTART_INTERVAL = 1000 * 60 * 60 * 3;

safeGlobalInterval(() => {
  if (bot && botState.connected && !reconnecting && !isJoining) {
    console.log('[Refresh] Scheduled connection refresh for stability');
    bot.end('Scheduled refresh');
  }
}, RESTART_INTERVAL);

console.log('[Refresh] Scheduled refresh enabled (every 3 hours)');

// ============================================================
// GHOST CONNECTION DETECTOR - Improved with 7 min timeout
// ============================================================
function startGhostConnectionDetector() {
  botTimeoutRegistry.setInterval(() => {
    if (!bot || !botState.connected || isJoining) return;

    const now = Date.now();
    const packetAge = now - botState.lastPacketTime;
    const chunkAge = now - botState.lastChunkUpdate;

    // Changed from 300000 (5 min) to 420000 (7 min)
    if (packetAge > 420000) {
      console.log('[GhostDetector] Ghost connection detected - no packets for 420s');
      botState.connected = false;
      try {
        bot.end('Ghost connection');
      } catch (e) {}
      scheduleReconnect();
      return;
    }

    if (chunkAge > 420000 && packetAge > 60000) {
      console.log('[GhostDetector] Possible ghost - no chunks loaded for 420s');
    }
  }, 60000);
}

// ============================================================
// POSITION SAFETY CHECK
// ============================================================
function startPositionSafetyCheck() {
  botTimeoutRegistry.setInterval(() => {
    if (!bot || !bot.entity || !botState.connected) return;

    try {
      const pos = bot.entity.position;
      
      if (pos.y < -64) {
        console.log('[PositionCheck] Bot in void, reconnecting...');
        botState.connected = false;
        try {
          bot.end('Void detected');
        } catch (e) {}
        scheduleReconnect();
        return;
      }
      
      if (bot.entity.onGround === false && bot.entity.velocity) {
        const fallingSpeed = Math.abs(bot.entity.velocity.y);
        if (fallingSpeed > 1.0) {
          botTimeoutRegistry.setTimeout(() => {
            if (bot && bot.entity && bot.entity.onGround === false && bot.entity.velocity && Math.abs(bot.entity.velocity.y) > 1.0) {
              console.log('[PositionCheck] Bot still falling after check, possible freeze');
              botState.connected = false;
              try {
                bot.end('Falling state stuck');
              } catch (e) {}
              scheduleReconnect();
            }
          }, 10000);
        }
      }
    } catch (e) {
      console.log('[PositionCheck] Error:', e.message);
    }
  }, 30000);
}

// ============================================================
// WATCHDOG SYSTEM - Improved with packet timeout
// ============================================================
function startWatchdog() {
  if (watchdogInterval) {
    clearInterval(watchdogInterval);
  }
  
  watchdogInterval = setInterval(() => {
    try {
      if (isJoining || reconnecting) return;
      if (!botState.connected) return;

      // ADDED: Packet timeout check
      const packetAge = Date.now() - botState.lastPacketTime;
      if (packetAge > 420000) {
        console.log('[Watchdog] No packets received for 7 minutes');
        botState.connected = false;
        
        try {
          bot.end('Watchdog packet timeout');
        } catch (e) {}
        
        scheduleReconnect();
        return;
      }

      if (!bot || !bot._client || bot._client.ended) {
        console.log('[Watchdog] Dead bot detected, initiating reconnect...');
        
        if (bot) {
          bot.removeAllListeners();
          if (bot._client && bot._client.socket) {
            bot._client.socket.removeAllListeners();
            if (!bot._client.socket.destroyed) {
              bot._client.socket.destroy();
            }
          }
          if (bot._client) {
            bot._client.removeAllListeners();
          }
          try { bot.end(); } catch (e) {}
        }
        
        bot = null;
        botState.connected = false;
        isJoining = false;
        
        scheduleReconnect();
      }
    } catch (e) {
      console.log('[Watchdog] Error:', e.message);
    }
  }, 60000);
}

// ============================================================
// CENTRAL ACTIVITY MANAGER — ULTRA LIGHTWEIGHT (v5.4)
// Single anti-AFK engine. 50% idle. 40-120s delays.
// ============================================================
class ActivityManager {
  constructor() {
    this.isActive = false;
  }

  scheduleNext() {
    // SAFE: Prevent duplicate activity chains
    if (activityLoopRunning) return;
    activityLoopRunning = true;
    
    if (!bot || !botState.connected) {
      activityLoopRunning = false;
      return;
    }
    
    // 50% chance: complete idle (maximum stability)
    if (Math.random() < 0.50) {
      const idleDelay = 40000 + Math.floor(Math.random() * 80000);
      activityLoopRunning = false;
      botTimeoutRegistry.setTimeout(() => this.scheduleNext(), idleDelay);
      return;
    }
    
    // Prevent activity engine from silently dying
    if (this.isActive) {
      activityLoopRunning = false;
      botTimeoutRegistry.setTimeout(() => this.scheduleNext(), 3000);
      return;
    }
    
    const rand = Math.random();
    let actionDelay;
    
    if (rand < 0.15) {
      // 15%: tiny look movement
      this.performLook();
      actionDelay = 40000 + Math.floor(Math.random() * 80000);
    } else if (rand < 0.22) {
      // 7%: arm swing
      this.performArmSwing();
      actionDelay = 50000 + Math.floor(Math.random() * 70000);
    } else if (rand < 0.27) {
      // 5%: jump
      this.performJump();
      actionDelay = 60000 + Math.floor(Math.random() * 60000);
    } else if (rand < 0.50) {
      // Spectator realistic movement
      this.performSpectatorMove();
      actionDelay = 45000 + Math.floor(Math.random() * 45000);
    } else {
      // Fallback idle
      actionDelay = 40000 + Math.floor(Math.random() * 80000);
    }
    
    activityLoopRunning = false;
    botTimeoutRegistry.setTimeout(() => this.scheduleNext(), actionDelay);
  }

  performLook() {
    if (!bot || !bot.entity) return;
    this.isActive = true;
    
    try {
      const yawChange = (Math.random() - 0.5) * 0.10;
      const pitchChange = (Math.random() - 0.5) * 0.03;
      bot.look(bot.entity.yaw + yawChange, bot.entity.pitch + pitchChange, true);
      botState.lastActivity = Date.now();
    } catch (e) {}
    
    this.isActive = false;
  }

  performArmSwing() {
    if (!bot) return;
    this.isActive = true;
    
    try {
      bot.swingArm('right');
      botState.lastActivity = Date.now();
    } catch (e) {}
    
    this.isActive = false;
  }

  performJump() {
    if (!bot) return;
    this.isActive = true;
    
    try {
      bot.setControlState('jump', true);
      botTimeoutRegistry.setTimeout(() => {
        if (bot) bot.setControlState('jump', false);
        this.isActive = false;
      }, 200);
      botState.lastActivity = Date.now();
    } catch (e) {
      this.isActive = false;
    }
  }

  performSpectatorMove() {
    if (!bot || !bot.entity) return;
    
    this.isActive = true;
    
    try {
      // Random camera movement (refined for subtlety)
      const yawChange = (Math.random() - 0.5) * 0.7;
      const pitchChange = (Math.random() - 0.5) * 0.2;
      
      bot.look(
        bot.entity.yaw + yawChange,
        bot.entity.pitch + pitchChange,
        true
      );
      
      // Random movement direction
      const directions = ['forward', 'back', 'left', 'right'];
      const dir = directions[Math.floor(Math.random() * directions.length)];
      
      bot.setControlState(dir, true);
      
      if (Math.random() < 0.10) {
        bot.setControlState('jump', true);
        
        botTimeoutRegistry.setTimeout(() => {
          if (bot) bot.setControlState('jump', false);
        }, 150);
      }
      
      // Sometimes sprint for realism
      if (Math.random() < 0.30) {
        bot.setControlState('sprint', true);
      }
      
      botTimeoutRegistry.setTimeout(() => {
        if (!bot || !bot.entity) return;
        
        bot.setControlState(dir, false);
        bot.setControlState('sprint', false);
        
        bot.clearControlStates();
        
        this.isActive = false;
      }, 800 + Math.floor(Math.random() * 1200));
      
      botState.lastActivity = Date.now();
      
    } catch (e) {
      this.isActive = false;
    }
  }
}

// ============================================================
// MODULE INITIALIZATION — Single activity system only
// ============================================================
function initializeModules(bot) {
  console.log('[Modules] Initializing modules...');

  // ---------- AUTO AUTH (Improved - Only login after first registration) ----------
  if (config.utils['auto-auth'].enabled) {
    const password = config.utils['auto-auth'].password;
    botTimeoutRegistry.setTimeout(() => {
      if (bot && botState.connected) {
        if (!firstRegistrationDone) {
          bot.chat(`/register ${password} ${password}`);
          firstRegistrationDone = true;
          console.log('[Auth] Sent registration commands');
        }
        bot.chat(`/login ${password}`);
        console.log('[Auth] Sent login command');
      }
    }, 1000 + Math.floor(Math.random() * 500));
  }

  // ---------- CHAT MESSAGES (Minimum 90s delay) ----------
  if (config.utils['chat-messages'].enabled) {
    const messages = config.utils['chat-messages'].messages;
    if (config.utils['chat-messages'].repeat) {
      let i = 0;
      const baseChatDelay = Math.max(
        (config.utils['chat-messages']['repeat-delay'] || 90) * 1000,
        90000
      );
      
      const sendRandomChat = () => {
        if (!bot || !botState.connected) return;
        
        bot.chat(messages[i]);
        botState.lastActivity = Date.now();
        i = (i + 1) % messages.length;
        
        botTimeoutRegistry.setTimeout(
          sendRandomChat,
          baseChatDelay + Math.floor(Math.random() * 30000)
        );
      };
      
      botTimeoutRegistry.setTimeout(
        sendRandomChat,
        baseChatDelay + Math.floor(Math.random() * 15000)
      );
    }
  }

  // ---------- CENTRAL ACTIVITY MANAGER (ONLY anti-AFK system) ----------
  activityLoopRunning = false;
  activityManager = new ActivityManager();
  activityManager.scheduleNext();

  console.log('[Modules] Initialized — single activity engine active');
}

// ============================================================
// CONSOLE COMMANDS
// ============================================================
const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  if (!bot || !botState.connected) {
    console.log('[Console] Bot not connected');
    return;
  }

  const trimmed = line.trim();
  if (trimmed.startsWith('say ')) {
    bot.chat(trimmed.slice(4));
  } else if (trimmed.startsWith('cmd ')) {
    bot.chat('/' + trimmed.slice(4));
  } else if (trimmed === 'status') {
    console.log(`Connected: ${botState.connected}`);
    console.log(`Uptime: ${formatUptime(Math.floor((Date.now() - botState.startTime) / 1000))}`);
    console.log(`Last packet: ${((Date.now() - botState.lastPacketTime) / 1000).toFixed(1)}s ago`);
    console.log(`Active timers: ${botTimeoutRegistry.getActiveCount()}`);
    console.log(`Reconnecting: ${reconnecting}`);
    console.log(`Is Joining: ${isJoining}`);
    console.log(`Activity Loop: ${activityLoopRunning}`);
  } else if (trimmed === 'reconnect') {
    console.log('[Console] Manual reconnect requested');
    bot.end('Manual reconnect');
  } else if (trimmed === 'refresh') {
    console.log('[Console] Manual refresh requested');
    bot.end('Scheduled refresh');
  } else {
    bot.chat(trimmed);
  }
});

// ============================================================
// DISCORD WEBHOOK INTEGRATION
// ============================================================
function sendDiscordWebhook(content, color = 0x0099ff) {
  if (!config.discord || !config.discord.enabled || !config.discord.webhookUrl || config.discord.webhookUrl.includes('YOUR_DISCORD')) return;

  const protocol = config.discord.webhookUrl.startsWith('https') ? https : http;
  const urlParts = new URL(config.discord.webhookUrl);

  const payload = JSON.stringify({
    username: config.name,
    embeds: [{
      description: content,
      color: color,
      timestamp: new Date().toISOString(),
      footer: { text: 'Minecraft AFK Bot v5.4 — Ultimate Stability' }
    }]
  });

  const options = {
    hostname: urlParts.hostname,
    port: 443,
    path: urlParts.pathname + urlParts.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': payload.length
    }
  };

  const req = protocol.request(options, () => {});

  req.on('error', (e) => {
    console.log(`[Discord] Error sending webhook: ${e.message}`);
  });

  req.write(payload);
  req.end();
}

// ============================================================
// CRASH RECOVERY - IMMORTAL MODE
// ============================================================
process.on('uncaughtException', (err) => {
  console.log(`[FATAL] Uncaught Exception: ${err.message}`);
  if (botState.errors.length > 20) {
    botState.errors.shift();
  }
  botState.errors.push({ type: 'uncaught', message: err.message, time: Date.now() });

  if (config.utils['auto-reconnect']) {
    isJoining = false;
    reconnecting = false;
    activityLoopRunning = false;
    cleanupBot();
    setTimeout(() => {
      scheduleReconnect();
    }, 2000);
  }
});

process.on('unhandledRejection', (reason) => {
  console.log(`[FATAL] Unhandled Rejection: ${reason}`);
  if (botState.errors.length > 20) {
    botState.errors.shift();
  }
  botState.errors.push({ type: 'rejection', message: String(reason), time: Date.now() });
});

// Render-safe SIGTERM handler — let Render restart the container
process.on('SIGTERM', () => {
  console.log('[System] SIGTERM received — cleaning up and exiting');
  
  try {
    clearGlobalIntervals();
    cleanupBot();
  } catch (e) {
    console.log('[SIGTERM] Cleanup error:', e.message);
  }

  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[System] Manual stop requested. Exiting...');
  clearGlobalIntervals();
  cleanupBot();
  process.exit(0);
});

// ============================================================
// START THE BOT
// ============================================================
console.log('='.repeat(50));
console.log('  Minecraft AFK Bot v1.1 — Ultimate Stability Edition');
console.log('='.repeat(50));
console.log(`Server: ${config.server.ip}:${config.server.port}`);
console.log(`Version: ${config.server.version}`);
console.log(`Auto-Reconnect: ${config.utils['auto-reconnect'] ? 'Enabled' : 'Disabled'}`);
console.log('Features: Ghost Detection | Single Activity Engine | Position Safety | 3h Refresh');
console.log('Fixes: Safe Packet Listener | Global Interval Tracking | Race Condition Patched');
console.log('='.repeat(50));

createBot();
