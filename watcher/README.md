# Catalyst Watcher

A lightweight Node.js script that monitors a local folder for note changes and automatically syncs them to your Catalyst dashboard.

## Prerequisites

- Node.js 18+
- A running Catalyst dashboard (default: `http://localhost:3001`)

## Setup

```bash
# In the watcher/ directory:
npm install
```

## Pairing (first-time setup)

1. Open your dashboard → **DEVICES** page
2. Click **GENERATE PAIRING CODE** — a 6-character code will appear
3. Run:
   ```bash
   node index.js --pair
   ```
4. Enter the pairing code, a device name, the folder path to watch, and your Subject ID (from the dashboard URL)
5. Your config will be saved to `watcher/config.json`

## Running

```bash
node index.js
```

The watcher will:
- Scan the configured folder on startup and sync any files not yet synced
- Watch for new/modified `.md` and `.txt` files (2.5s debounce)
- Hash file contents — unchanged files are never re-sent
- Queue failed syncs and retry up to 3 times
- Persist the queue to `watcher/watcher.db` — survives restarts and offline periods

## Commands

| Command | Description |
|---|---|
| `node index.js` | Start watching (uses `config.json`) |
| `node index.js --pair` | Pair this device with your dashboard |
| `node index.js --status` | Print current config and queue depth, then exit |
| `node index.js --server <url>` | Override the server URL |

## Config file format (`config.json`)

Created automatically by `--pair`. You can edit it manually:

```json
{
  "server_url": "http://localhost:3001",
  "device_token": "<signed JWT — do not share>",
  "watches": [
    {
      "folder": "/Users/you/notes/orgo101",
      "subject_id": "your-subject-id-here"
    }
  ]
}
```

## Supported file types

`.md`, `.txt`, `.markdown`

## Ignored paths

- Dotfiles and dot-directories (`.obsidian/`, `.git/`)
- `node_modules/`

## Notes

- Deleting a local file sends a soft-delete signal to the dashboard; your graph nodes and flashcards are **preserved** (concepts may be referenced across multiple notes)
- The watcher only reads file content — it never modifies your local files
- The device token is stored in `config.json` and can be revoked from the dashboard **Devices** page at any time
