#!/usr/bin/env bash
# Run as root after uploading apps/api and deploy/ to /opt/uwelnes.
# Provision /etc/uwelnes/bot.env separately over SSH; never store it in git.
set -euo pipefail
test "$(id -u)" -eq 0
test -s /etc/uwelnes/bot.env
test -f /opt/uwelnes/apps/api/pyproject.toml
if ! id uwelnes-bot >/dev/null 2>&1; then
  useradd --system --user-group --home-dir /nonexistent --shell /sbin/nologin uwelnes-bot
fi
chmod 700 /etc/uwelnes
chmod 600 /etc/uwelnes/bot.env
python3 -m venv /opt/uwelnes/.venv
/opt/uwelnes/.venv/bin/python -m pip install -r /opt/uwelnes/apps/api/requirements.lock.txt
/opt/uwelnes/.venv/bin/python -m pip install --no-deps -e /opt/uwelnes/apps/api
install -m 644 /opt/uwelnes/deploy/systemd/uwelnes-bot.service /etc/systemd/system/uwelnes-bot.service
systemd-analyze verify /etc/systemd/system/uwelnes-bot.service
systemctl daemon-reload
# Start only after confirming no other instance is polling with this token.
echo 'Bot installed. Ready for: systemctl enable --now uwelnes-bot'
