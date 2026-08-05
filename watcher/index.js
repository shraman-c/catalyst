#!/usr/bin/env node
'use strict';

/**
 * Catalyst Watcher — Local-to-Cloud Note Sync
 *
 * Monitors a local folder for .md/.txt file changes and syncs them
 * to the Catalyst dashboard automatically.
 *
 * Usage:
 *   node index.js                    # start watching (reads config.json)
 *   node index.js --pair             # run the pairing flow to connect a new device
 *   node index.js --server <url>     # override server URL
 *   node index.js --status           # print sync status and exit
 */

const { program } = require('commander');
const chokidar = require('chokidar');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const readline = require('readline');
const os = require('os');

// ---------------------------------------------------------------------------
// CLI definition
// ---------------------------------------------------------------------------
program
  .option('--pair', 'Run pairing flow to connect this device to your dashboard')
  .option('--server <url>', 'Dashboard server URL (e.g. http://localhost:3001)')
  .option('--status', 'Print watcher status and exit')
  .option('--config <path>', 'Path to config file', path.join(__dirname, 'config.json'))
  .parse(process.argv);

const opts = program.opts();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const CONFIG_PATH = opts.config;

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return {}; }
}

function saveConfig(data) {
  const current = loadConfig();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...current, ...data }, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// Local SQLite state (hashes + queue)
// ---------------------------------------------------------------------------
const DB_PATH = path.join(__dirname, 'watcher.db');
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS file_hashes (
    file_path TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,
    synced_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sync_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL,
    action TEXT NOT NULL DEFAULT 'sync',
    queued_at TEXT NOT NULL DEFAULT (datetime('now')),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
  );
`);

const getHash = db.prepare('SELECT content_hash FROM file_hashes WHERE file_path = ?');
const upsertHash = db.prepare(`
  INSERT INTO file_hashes (file_path, content_hash, synced_at)
  VALUES (?, ?, datetime('now'))
  ON CONFLICT(file_path) DO UPDATE SET content_hash = excluded.content_hash, synced_at = excluded.synced_at
`);
const insertQueue = db.prepare(`INSERT INTO sync_queue (file_path, action) VALUES (?, ?)`);
const getQueue = db.prepare(`SELECT * FROM sync_queue ORDER BY queued_at ASC LIMIT 20`);
const deleteQueue = db.prepare(`DELETE FROM sync_queue WHERE id = ?`);
const updateQueueError = db.prepare(`UPDATE sync_queue SET attempts = attempts + 1, last_error = ? WHERE id = ?`);
const getQueueCount = db.prepare(`SELECT COUNT(*) as cnt FROM sync_queue`);

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------
function fetchJson(serverUrl, endpoint, method, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, serverUrl);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;
    const bodyStr = body ? JSON.stringify(body) : null;

    const req = transport.request({
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// SHA-256 hash
// ---------------------------------------------------------------------------
function hashContent(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Pairing flow
// ---------------------------------------------------------------------------
async function runPairingFlow() {
  const config = loadConfig();
  const serverUrl = opts.server || config.server_url || 'http://localhost:3001';

  console.log('\n╔════════════════════════════════════════╗');
  console.log('║     CATALYST WATCHER — PAIRING FLOW   ║');
  console.log('╚════════════════════════════════════════╝\n');
  console.log(`Server: ${serverUrl}\n`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise(res => rl.question(q, res));

  const code = await ask('Enter the 6-character pairing code from your dashboard: ');
  const deviceName = await ask(`Device name [${os.hostname()}]: `) || os.hostname();
  const folderPath = await ask('Path to folder to watch (e.g. ~/notes/orgo): ');
  const subjectId = await ask('Subject ID to sync to (from your dashboard URL): ');

  rl.close();

  console.log('\nRedeeming pairing code...');
  try {
    const res = await fetchJson(serverUrl, '/api/devices/pair', 'POST', {
      action: 'redeem_code',
      pairing_code: code.trim().toUpperCase(),
      device_name: deviceName,
      folder_path: path.resolve(folderPath.replace(/^~/, os.homedir())),
      subject_id: subjectId.trim(),
    }, null);

    if (res.status !== 200) {
      console.error(`\n✗ Pairing failed: ${JSON.stringify(res.body)}`);
      process.exit(1);
    }

    const { device_token } = res.body;
    saveConfig({
      server_url: serverUrl,
      device_token,
      watches: [{
        folder: path.resolve(folderPath.replace(/^~/, os.homedir())),
        subject_id: subjectId.trim(),
      }],
    });

    console.log('\n✓ Paired successfully!');
    console.log(`  Device token saved to: ${CONFIG_PATH}`);
    console.log(`  Watching: ${folderPath} → Subject ${subjectId}`);
    console.log('\nRun "node index.js" to start watching.\n');
  } catch (err) {
    console.error('\n✗ Network error during pairing:', err.message);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Sync a single file
// ---------------------------------------------------------------------------
async function syncFile(filePath, config, action = 'sync') {
  const { server_url: serverUrl, device_token: token } = config;

  if (action === 'delete') {
    const filename = path.basename(filePath);
    const watch = findWatch(filePath, config);
    const subjectId = watch?.subject_id;

    if (!subjectId) return;

    const res = await fetchJson(serverUrl, '/api/sync/files', 'DELETE', {
      filename,
      path: filePath,
      subject_id: subjectId,
    }, token);

    if (res.status === 200) {
      db.prepare('DELETE FROM file_hashes WHERE file_path = ?').run(filePath);
      console.log(`[DELETE] ${filename}`);
    } else {
      throw new Error(`Server returned ${res.status}: ${JSON.stringify(res.body)}`);
    }
    return;
  }

  // Read file
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(`Cannot read file: ${err.message}`);
  }

  const contentHash = hashContent(content);

  // Check local hash — skip if unchanged
  const existing = getHash.get(filePath);
  if (existing?.content_hash === contentHash) {
    return; // nothing changed since last sync
  }

  const watch = findWatch(filePath, config);
  const subjectId = watch?.subject_id;
  if (!subjectId) return;

  const filename = path.basename(filePath);

  const res = await fetchJson(serverUrl, '/api/sync/files', 'POST', {
    path: filePath,
    filename,
    content,
    hash: contentHash,
    subject_id: subjectId,
  }, token);

  if (res.status === 200) {
    upsertHash.run(filePath, contentHash);
    if (res.body.reprocessed !== false) {
      const p = res.body.pipeline || {};
      console.log(`[SYNC] ${filename} → ${p.nodes_created ?? 0} new concepts, ${p.cards_created ?? 0} new cards`);
    } else {
      console.log(`[SKIP] ${filename} — content unchanged on server`);
    }
  } else {
    throw new Error(`Server returned ${res.status}: ${JSON.stringify(res.body)}`);
  }
}

function findWatch(filePath, config) {
  const watches = config.watches || [];
  return watches.find(w => filePath.startsWith(w.folder));
}

// ---------------------------------------------------------------------------
// Queue processor (handles retries)
// ---------------------------------------------------------------------------
let processingQueue = false;

async function processQueue(config) {
  if (processingQueue) return;
  processingQueue = true;

  try {
    const jobs = getQueue.all();
    for (const job of jobs) {
      try {
        await syncFile(job.file_path, config, job.action);
        deleteQueue.run(job.id);
      } catch (err) {
        updateQueueError.run(err.message, job.id);
        if (job.attempts >= 3) {
          console.error(`[FAIL] ${path.basename(job.file_path)}: ${err.message} (giving up after 3 attempts)`);
          deleteQueue.run(job.id);
        } else {
          console.warn(`[RETRY] ${path.basename(job.file_path)}: ${err.message}`);
        }
      }
    }
  } finally {
    processingQueue = false;
  }
}

// ---------------------------------------------------------------------------
// Debounce map
// ---------------------------------------------------------------------------
const debounceMap = new Map();
const DEBOUNCE_MS = 2500;

function debounceFile(filePath, action, config) {
  if (debounceMap.has(filePath)) {
    clearTimeout(debounceMap.get(filePath));
  }
  debounceMap.set(filePath, setTimeout(async () => {
    debounceMap.delete(filePath);
    // Queue the sync
    insertQueue.run(filePath, action);
    // Process immediately
    await processQueue(config);
  }, DEBOUNCE_MS));
}

// ---------------------------------------------------------------------------
// Status command
// ---------------------------------------------------------------------------
function printStatus(config) {
  const watches = config.watches || [];
  const queueCount = getQueueCount.get().cnt;

  console.log('\n╔══════════════════════════════╗');
  console.log('║  CATALYST WATCHER STATUS     ║');
  console.log('╚══════════════════════════════╝\n');
  console.log(`Server:       ${config.server_url || '(not configured)'}`);
  console.log(`Paired:       ${config.device_token ? 'YES' : 'NO'}`);
  console.log(`Queue depth:  ${queueCount}`);
  console.log(`Watches (${watches.length}):`);
  watches.forEach(w => {
    console.log(`  ${w.folder}  →  Subject: ${w.subject_id}`);
  });
  console.log('');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  if (opts.pair) {
    await runPairingFlow();
    return;
  }

  const config = loadConfig();

  if (opts.status) {
    printStatus(config);
    return;
  }

  if (!config.device_token) {
    console.error('✗ Not paired. Run: node index.js --pair');
    process.exit(1);
  }

  const watches = config.watches || [];
  if (watches.length === 0) {
    console.error('✗ No folders configured. Run: node index.js --pair');
    process.exit(1);
  }

  const serverUrl = opts.server || config.server_url || 'http://localhost:3001';
  config.server_url = serverUrl;

  const folders = watches.map(w => w.folder);

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║         CATALYST WATCHER — RUNNING               ║');
  console.log('╚══════════════════════════════════════════════════╝\n');
  console.log(`Server: ${serverUrl}`);
  folders.forEach((folder, i) => {
    console.log(`Watching: ${folder}  →  Subject: ${watches[i].subject_id}`);
  });
  console.log('\nPress Ctrl+C to stop.\n');

  // Process any queued items from previous run
  await processQueue(config);

  // Set up file watcher
  const watcher = chokidar.watch(folders, {
    ignored: [
      /(^|[/\\])\../, // dotfiles
      /node_modules/,
      /\.git/,
    ],
    persistent: true,
    ignoreInitial: false, // sync existing files on startup
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
  });

  watcher
    .on('add', (filePath) => {
      if (!isNoteFile(filePath)) return;
      debounceFile(filePath, 'sync', config);
    })
    .on('change', (filePath) => {
      if (!isNoteFile(filePath)) return;
      console.log(`[CHANGE] ${path.basename(filePath)}`);
      debounceFile(filePath, 'sync', config);
    })
    .on('unlink', (filePath) => {
      if (!isNoteFile(filePath)) return;
      console.log(`[DELETE] ${path.basename(filePath)}`);
      debounceFile(filePath, 'delete', config);
    })
    .on('error', (err) => {
      console.error('[WATCHER ERROR]', err.message);
    });

  // Periodic queue flush (catch any stragglers)
  setInterval(() => processQueue(config), 30000);
}

function isNoteFile(filePath) {
  return /\.(md|txt|markdown)$/i.test(filePath);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
