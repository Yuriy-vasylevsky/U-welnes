"""Verify real PostgreSQL races in a temporary database, never production rows."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from pathlib import Path
from uuid import uuid4
import secrets
import psycopg
from psycopg import sql
from dotenv import dotenv_values
from sqlalchemy.engine import make_url
from wellness.booking_store import BookingStore, SeatTaken, today_kyiv

directory = Path("/etc/uwelnes")
admin = dotenv_values(directory / "postgres.env")
url = make_url(dotenv_values(directory / "bot.env")["DATABASE_URL"])
name = "uwelnes_verify_" + secrets.token_hex(6)
with psycopg.connect(host="127.0.0.1", port=55432, dbname="uwelnes",
                     user=admin["POSTGRES_USER"], password=admin["POSTGRES_PASSWORD"], autocommit=True) as connection:
    connection.execute(sql.SQL("CREATE DATABASE {} OWNER {}").format(sql.Identifier(name), sql.Identifier(url.username)))
    store = None
    try:
        store = BookingStore(url.set(database=name))
        store.initialize()
        day = today_kyiv() + timedelta(days=1)
        def attempt(user):
            try:
                return store.reserve(user, day, "S001", str(uuid4()))
            except SeatTaken:
                return None
        with ThreadPoolExecutor(max_workers=4) as executor:
            results = list(executor.map(attempt, [1, 2, 3, 4]))
        assert sum(item is not None for item in results) == 1
        assert store.availability(day) == ["S001"]
        winner = next(index+1 for index, item in enumerate(results) if item is not None)
        assert len(store.for_user(winner)) == 1
        assert store.for_user(1000) == []
        saved = store.for_user(winner)[0]
        assert store.reserve(winner, day, "S001", saved["id"])["id"] == saved["id"]
        store.close()
        store = BookingStore(url.set(database=name))
        assert len(store.for_user(winner)) == 1
        print("PostgreSQL passed: one winner out of four concurrent requests, owner isolation, retry safety and persistence.")
    finally:
        if store:
            store.close()
        connection.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))
        print("Temporary verification database removed; production bookings untouched.")
