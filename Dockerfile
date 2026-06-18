# Zero-dependency app — a slim Python base is all we need.
FROM python:3.12-slim

WORKDIR /app
COPY app.py ./
COPY public ./public

ENV PORT=8765 \
    HOST=0.0.0.0 \
    POLL_INTERVAL=300 \
    DB_PATH=/data/usage.db \
    CLAUDE_CREDENTIALS=/credentials/.credentials.json

VOLUME ["/data"]
EXPOSE 8765

CMD ["python", "app.py"]
