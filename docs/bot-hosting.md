# Telegram bot on Hetzner

Deployed 13 November 2026 to `77.42.71.244` (AlmaLinux 10.2).

- Bot: `@u_welnes_bot`.
- Source and Python 3.12 virtual environment: `/opt/uwelnes`.
- Service: `uwelnes-bot.service`, dedicated system user `uwelnes-bot`.
- Configuration: `/etc/uwelnes/bot.env`, owned by root, mode `600`.
- Polling, automatic start on boot, restart after failure (15 seconds).
- Memory limit: 256 MiB. No listening port or database is required.
- Mini App button: `https://uwelnes.site`. The web application was subsequently
  published at that URL with HTTPS; see `web-hosting.md` for deployment details.

Connect:

```powershell
ssh root@77.42.71.244
```

Manage from the server:

```bash
systemctl status uwelnes-bot --no-pager
journalctl -u uwelnes-bot -n 50 --no-pager
systemctl restart uwelnes-bot
systemctl stop uwelnes-bot
systemctl start uwelnes-bot
```

After changing `/etc/uwelnes/bot.env`, restart the service. Do not print the file
or commit it. The local `.env` does not update the server automatically.

Run only one polling instance for this token. Stop this service before running
the bot locally; restart it after local testing. Never delete an existing
webhook automatically to enable polling.

Reproducible installation files: `deploy/setup-bot.sh` and
`deploy/systemd/uwelnes-bot.service`. Upload `apps/api` and `deploy` to
`/opt/uwelnes`, provision the protected environment file over SSH, then run:

```bash
bash /opt/uwelnes/deploy/setup-bot.sh
systemctl enable --now uwelnes-bot
```

Validation: 7 Python tests passed on the server, Telegram `getMe` confirmed the
token, the service reported active/running and enabled, and the journal
confirmed polling. Existing server projects and their reverse proxy were not
modified.
