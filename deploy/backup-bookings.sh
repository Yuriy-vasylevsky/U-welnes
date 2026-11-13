#!/usr/bin/env bash
set -euo pipefail
umask 077
directory=/opt/uwelnes/backups/postgres
mkdir -p "$directory"
target="$directory/bookings-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker exec uwelnes-db-1 pg_dump -U postgres -d uwelnes -Fc > "$target.tmp"
test -s "$target.tmp"
mv "$target.tmp" "$target"
echo 'Booking database backup completed.'
