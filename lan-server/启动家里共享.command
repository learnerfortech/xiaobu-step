#!/bin/bash
cd "$(dirname "$0")"
ROOT_DIR="$(cd .. && pwd)"
FRONTEND="${XIAOBU_FRONTEND:-$ROOT_DIR/frontend}"
DATA_DIR="${XIAOBU_DATA:-$HOME/xiaobu-local-data}"
mkdir -p "$DATA_DIR"
LAN_IP="$(/usr/sbin/ipconfig getifaddr en0 2>/dev/null || /usr/sbin/ipconfig getifaddr en1 2>/dev/null || echo 127.0.0.1)"
exec /usr/bin/python3 "$(pwd)/server.py" --root "$FRONTEND" --db "$DATA_DIR/tasks.sqlite3" --lan-ip "$LAN_IP" --port 8766
