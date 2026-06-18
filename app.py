#!/usr/bin/env python3
"""claude-collection — tiny usage logger.

Every POLL_INTERVAL seconds it reads the Claude OAuth token, fetches the real
usage limits from Anthropic's /api/oauth/usage endpoint (the same data the
in-app /usage shows) and appends a row to a SQLite database. A small web UI
(served from ./public) shows the current values and the history.

Zero third-party dependencies — Python standard library only.

Config (environment variables, all optional):
  PORT                 listen port                      (default 8765)
  HOST                 bind address                     (default 0.0.0.0)
  POLL_INTERVAL        seconds between samples          (default 300 = 5 min)
  DB_PATH              sqlite file path                 (default ./data/usage.db)
  CLAUDE_CREDENTIALS   path to credentials.json         (default ~/.claude/.credentials.json)
  CLAUDE_TOKEN         OAuth access token override      (else read from credentials)

The access token is read fresh on every poll, so if Claude Code keeps the
credentials file refreshed on this host, the poller always uses a valid token.
"""

import json
import os
import sqlite3
import threading
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

# --------------------------------------------------------------------------- #
# config
# --------------------------------------------------------------------------- #
PORT = int(os.environ.get("PORT", "8765"))
HOST = os.environ.get("HOST", "0.0.0.0")
POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL", "300"))
DB_PATH = Path(os.environ.get("DB_PATH", Path(__file__).parent / "data" / "usage.db"))
CREDENTIALS = Path(
    os.environ.get("CLAUDE_CREDENTIALS", Path.home() / ".claude" / ".credentials.json")
)
TOKEN_OVERRIDE = os.environ.get("CLAUDE_TOKEN", "").strip()

USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
PUBLIC_DIR = Path(__file__).parent / "public"

_db_lock = threading.Lock()
_last_error = {"msg": None, "ts": None}


# --------------------------------------------------------------------------- #
# database
# --------------------------------------------------------------------------- #
def db_connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def db_init():
    with db_connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS usage (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                ts             INTEGER NOT NULL,
                session        REAL,
                week           REAL,
                opus           REAL,
                sonnet         REAL,
                session_resets TEXT,
                week_resets    TEXT,
                raw            TEXT
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_usage_ts ON usage(ts)")


def db_insert(sample):
    with _db_lock, db_connect() as conn:
        conn.execute(
            """INSERT INTO usage
               (ts, session, week, opus, sonnet, session_resets, week_resets, raw)
               VALUES (?,?,?,?,?,?,?,?)""",
            (
                sample["ts"],
                sample["session"],
                sample["week"],
                sample["opus"],
                sample["sonnet"],
                sample["session_resets"],
                sample["week_resets"],
                json.dumps(sample["raw"]),
            ),
        )


def db_latest():
    with db_connect() as conn:
        row = conn.execute("SELECT * FROM usage ORDER BY ts DESC LIMIT 1").fetchone()
        return dict(row) if row else None


def db_history(since_ts):
    with db_connect() as conn:
        rows = conn.execute(
            "SELECT ts, session, week, opus, sonnet FROM usage "
            "WHERE ts >= ? ORDER BY ts ASC",
            (since_ts,),
        ).fetchall()
        return [dict(r) for r in rows]


def db_count():
    with db_connect() as conn:
        return conn.execute("SELECT COUNT(*) AS n FROM usage").fetchone()["n"]


def db_raw(limit, offset):
    with db_connect() as conn:
        rows = conn.execute(
            "SELECT id, ts, session, week, opus, sonnet, session_resets, week_resets "
            "FROM usage ORDER BY ts DESC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()
        return [dict(r) for r in rows]


def db_all():
    with db_connect() as conn:
        rows = conn.execute(
            "SELECT ts, session, week, opus, sonnet, session_resets, week_resets "
            "FROM usage ORDER BY ts ASC"
        ).fetchall()
        return [dict(r) for r in rows]


def db_stats():
    with db_connect() as conn:
        r = conn.execute(
            """SELECT COUNT(*) AS n, MIN(ts) AS first_ts, MAX(ts) AS last_ts,
                      MAX(session) AS peak_session, MAX(week) AS peak_week,
                      AVG(session) AS avg_session, AVG(week) AS avg_week
               FROM usage"""
        ).fetchone()
        return dict(r)


# --------------------------------------------------------------------------- #
# fetching
# --------------------------------------------------------------------------- #
def read_token():
    if TOKEN_OVERRIDE:
        return TOKEN_OVERRIDE
    try:
        data = json.loads(CREDENTIALS.read_text())
    except (OSError, ValueError) as e:
        raise RuntimeError(f"cannot read credentials at {CREDENTIALS}: {e}")
    tok = (data.get("claudeAiOauth") or {}).get("accessToken") or data.get("accessToken")
    if not tok:
        raise RuntimeError("no accessToken found in credentials file")
    return tok


def fetch_usage():
    token = read_token()
    req = urllib.request.Request(
        USAGE_URL,
        headers={
            "Authorization": f"Bearer {token}",
            "anthropic-beta": "oauth-2025-04-20",
            "anthropic-version": "2023-06-01",
            "User-Agent": "claude-collection/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        body = resp.read().decode("utf-8")
    data = json.loads(body)

    def util(key):
        node = data.get(key)
        return node.get("utilization") if isinstance(node, dict) else None

    def resets(key):
        node = data.get(key)
        return node.get("resets_at") if isinstance(node, dict) else None

    return {
        "ts": int(time.time()),
        "session": util("five_hour"),
        "week": util("seven_day"),
        "opus": util("seven_day_opus"),
        "sonnet": util("seven_day_sonnet"),
        "session_resets": resets("five_hour"),
        "week_resets": resets("seven_day"),
        "raw": data,
    }


def poll_once():
    """Fetch + store one sample. Returns the sample or raises."""
    sample = fetch_usage()
    db_insert(sample)
    _last_error["msg"] = None
    _last_error["ts"] = None
    print(f"[{datetime.now(timezone.utc).isoformat()}] stored "
          f"session={sample['session']}% week={sample['week']}%", flush=True)
    return sample


def poll_loop():
    while True:
        try:
            poll_once()
        except Exception as e:  # noqa: BLE001 — log everything, never crash the loop
            _last_error["msg"] = str(e)
            _last_error["ts"] = int(time.time())
            print(f"[poll error] {e}", flush=True)
        time.sleep(POLL_INTERVAL)


# --------------------------------------------------------------------------- #
# http
# --------------------------------------------------------------------------- #
RANGE_SECONDS = {"24h": 86400, "7d": 604800, "30d": 2592000, "all": 10**12}


class Handler(BaseHTTPRequestHandler):
    server_version = "claude-collection"

    def log_message(self, *args):
        pass  # quiet access log

    def _json(self, obj, code=200):
        payload = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _static(self, name):
        path = (PUBLIC_DIR / name).resolve()
        if not str(path).startswith(str(PUBLIC_DIR.resolve())) or not path.is_file():
            self.send_error(404)
            return
        ctype = {
            ".html": "text/html; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
        }.get(path.suffix, "application/octet-stream")
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _download(self, data, ctype, filename):
        body = data if isinstance(data, bytes) else data.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        route = urlparse(self.path)
        p = route.path
        q = parse_qs(route.query)

        if p == "/health":
            return self._json({"ok": True})

        if p == "/api/current":
            return self._json({
                "ok": True,
                "latest": db_latest(),
                "poll_interval": POLL_INTERVAL,
                "error": _last_error,
            })

        if p == "/api/history":
            rng = q.get("range", ["7d"])[0]
            window = RANGE_SECONDS.get(rng, RANGE_SECONDS["7d"])
            since = int(time.time()) - window
            return self._json({"ok": True, "range": rng, "rows": db_history(since)})

        if p == "/api/stats":
            return self._json({"ok": True, "stats": db_stats(), "poll_interval": POLL_INTERVAL})

        if p == "/api/raw":
            try:
                limit = max(1, min(1000, int(q.get("limit", ["100"])[0])))
                offset = max(0, int(q.get("offset", ["0"])[0]))
            except ValueError:
                limit, offset = 100, 0
            return self._json({
                "ok": True, "total": db_count(),
                "limit": limit, "offset": offset, "rows": db_raw(limit, offset),
            })

        if p == "/api/export.json":
            return self._download(
                json.dumps(db_all(), indent=2), "application/json", "claude-usage.json")

        if p == "/api/export.csv":
            rows = db_all()
            lines = ["ts,iso,session,week,opus,sonnet,session_resets,week_resets"]
            for r in rows:
                iso = datetime.fromtimestamp(r["ts"], timezone.utc).isoformat()
                lines.append(",".join(str(x if x is not None else "") for x in [
                    r["ts"], iso, r["session"], r["week"], r["opus"], r["sonnet"],
                    r["session_resets"], r["week_resets"],
                ]))
            return self._download("\n".join(lines) + "\n", "text/csv", "claude-usage.csv")

        if p == "/api/poll":  # manual fetch
            try:
                return self._json({"ok": True, "sample": _strip_raw(poll_once())})
            except Exception as e:  # noqa: BLE001
                return self._json({"ok": False, "error": str(e)}, code=502)

        # everything else -> static file from public/
        name = "index.html" if p == "/" else p.lstrip("/")
        return self._static(name)


def _strip_raw(sample):
    s = dict(sample)
    s.pop("raw", None)
    return s


# --------------------------------------------------------------------------- #
# main
# --------------------------------------------------------------------------- #
def main():
    db_init()
    threading.Thread(target=poll_loop, daemon=True).start()
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"claude-collection listening on http://{HOST}:{PORT} "
          f"(poll every {POLL_INTERVAL}s, db={DB_PATH})", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
