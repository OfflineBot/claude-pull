# claude-collection

A tiny self-hosted logger for your **Claude usage limits**. Every 5 minutes it
fetches the real utilization (the same numbers the in-app `/usage` shows) from
Anthropic's `/api/oauth/usage` endpoint, stores each sample in a SQLite
database, and serves a small dark web UI with the current values and history.

- **Zero dependencies** — Python standard library only (`http.server`,
  `sqlite3`, `urllib`).
- **Port 8765** by default.
- UI themed to match your kitty colour scheme.

## How it gets the data

The endpoint needs your Claude **OAuth access token**. The app reads it *fresh on
every poll* from `~/.claude/.credentials.json` (the file Claude Code maintains).
The token is **never stored** in this project or the database — only the
resulting percentages are saved.

> ⚠️ Run this on a host where **Claude Code stays logged in**, so the credentials
> file keeps getting refreshed and the access token stays valid. The endpoint is
> **undocumented** and may change in future Claude releases — if a fetch fails,
> the UI shows the error and keeps the last data; it never crashes.

## Run it

### Directly (Python 3.8+)

```bash
cd claude-collection
python3 app.py
# open http://localhost:8765
```

### Docker

```bash
cp .env.example .env        # adjust CLAUDE_CREDENTIALS_DIR if needed
docker compose up -d --build
# open http://<server>:8765
```

`docker-compose.yml` persists the DB in `./data` and mounts your
`~/.claude/.credentials.json` read-only into the container.

### systemd (no Docker)

```bash
# edit User= / paths in claude-collection.service first
sudo cp claude-collection.service /etc/systemd/system/
sudo systemctl enable --now claude-collection
```

## Configuration

| Env var              | Default                        | Meaning                          |
|----------------------|--------------------------------|----------------------------------|
| `PORT`               | `8765`                         | listen port                      |
| `HOST`               | `0.0.0.0`                      | bind address                     |
| `POLL_INTERVAL`      | `300`                          | seconds between samples          |
| `DB_PATH`            | `./data/usage.db`              | SQLite file                      |
| `CLAUDE_CREDENTIALS` | `~/.claude/.credentials.json`  | path to the credentials file     |
| `CLAUDE_TOKEN`       | *(unset)*                      | hard-code a token (skips file)   |

## API

| Route                       | Description                                   |
|-----------------------------|-----------------------------------------------|
| `GET /api/current`          | latest sample + poll interval + last error    |
| `GET /api/history?range=7d` | samples (`range` = `24h` \| `7d` \| `30d` \| `all`) |
| `GET /api/poll`             | fetch one sample right now                     |
| `GET /health`               | `{"ok":true}`                                  |

## Database schema

```sql
CREATE TABLE usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER,            -- unix epoch of the sample
  session REAL,          -- five_hour utilization %
  week REAL,             -- seven_day utilization %
  opus REAL,             -- seven_day_opus %  (nullable)
  sonnet REAL,           -- seven_day_sonnet %
  session_resets TEXT,   -- ISO reset time
  week_resets TEXT,
  raw TEXT               -- full JSON response
);
```
