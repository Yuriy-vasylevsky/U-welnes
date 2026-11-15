"""Verify real PostgreSQL races in a temporary database, never production rows."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from pathlib import Path
from uuid import uuid4
import secrets
import importlib.util
import psycopg
from psycopg import sql
from dotenv import dotenv_values
from sqlalchemy.engine import make_url
from wellness.booking_store import BookingStore, SeatTaken, InvalidBooking, BatchConflict, PriceChanged, today_kyiv

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
        # Exercise the exact production upgrade on a legacy schema first.
        legacy_day = today_kyiv() + timedelta(days=(-today_kyiv().weekday()) % 7 or 7)
        legacy_id = str(uuid4())
        with store.engine.begin() as legacy:
            legacy.exec_driver_sql("CREATE TABLE pool_booking_batches (id VARCHAR(36) PRIMARY KEY, user_id BIGINT NOT NULL, day DATE NOT NULL, seat_ids TEXT NOT NULL)")
            legacy.exec_driver_sql("CREATE TABLE pool_bookings (id VARCHAR(36) PRIMARY KEY, user_id BIGINT NOT NULL, day DATE NOT NULL, seat_id VARCHAR(16) NOT NULL, created_at TIMESTAMPTZ NOT NULL, CONSTRAINT uq_pool_booking_day_seat UNIQUE(day,seat_id))")
            legacy.exec_driver_sql("INSERT INTO pool_bookings VALUES (%s,99991,%s,'S387',now())", (legacy_id, legacy_day))
        spec = importlib.util.spec_from_file_location("period_migration", Path(__file__).with_name("migrate-booking-periods.py"))
        migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(migration)
        migration.migrate(store.engine)
        migration.migrate(store.engine)  # A re-run must preserve the same rows.
        store.initialize()
        old = store.for_user(99991)[0]
        assert old["id"] == legacy_id and old["period"] == "full" and old["price_uah"] is None
        assert store.availability(legacy_day, "morning") == ["S387"]
        assert store.availability(legacy_day, "evening") == ["S387"]
        print("Legacy upgrade verified twice: records and whole-day occupancy preserved, no retroactive prices.")
        assert not any(store.seat_enabled().values())
        store.set_seat_enabled("S001", True, False, 752963390)
        day = today_kyiv() + timedelta(days=(-today_kyiv().weekday()) % 7 or 7)
        def attempt(user):
            try:
                return store.reserve(user, day, "S001", str(uuid4()))
            except SeatTaken:
                return None
        with ThreadPoolExecutor(max_workers=4) as executor:
            results = list(executor.map(attempt, [1, 2, 3, 4]))
        assert sum(item is not None for item in results) == 1
        assert store.availability(day) == ["S001", "S387"]
        winner = next(index+1 for index, item in enumerate(results) if item is not None)
        assert len(store.for_user(winner)) == 1
        assert store.for_user(1000) == []
        saved = store.for_user(winner)[0]
        store.rename_seat("S001", 500, 1, 752963390)
        assert store.for_user(winner)[0]["seat_number"] == 500
        assert store.for_user(winner)[0]["id"] == saved["id"]
        assert store.reserve(winner, day, "S001", saved["id"])["id"] == saved["id"]
        store.close()
        store = BookingStore(url.set(database=name))
        store.initialize()
        assert store.seat_numbers()["S001"] == 500
        assert len(store.for_user(winner)) == 1
        assert store.clear_seat_numbers(752963390) == 387
        store.initialize()
        assert set(store.seat_numbers().values()) == {None}
        assert store.for_user(winner)[0]["id"] == saved["id"]
        store.rename_seat("S001", 7, None, 752963390)
        assert store.for_user(winner)[0]["seat_number"] == 7
        store.set_seat_enabled("S001", False, True, 752963390)
        assert store.for_user(winner)[0]["id"] == saved["id"]
        try:
            store.reserve(999, day + timedelta(days=1), "S001", str(uuid4()))
            raise AssertionError("Closed seat accepted a new booking")
        except InvalidBooking as error:
            assert str(error) == "seat_disabled"
        for seat in ["S002", "S003", "S004"]:
            store.set_seat_enabled(seat, True, False, 752963390)
        batch_day = day + timedelta(days=3)
        selections = {501: ["S002", "S003"], 502: ["S003", "S004"]}
        requests = {user: str(uuid4()) for user in selections}
        def group_attempt(user):
            try:
                return store.reserve_batch(user, batch_day, selections[user], requests[user])
            except (BatchConflict, SeatTaken):
                return None
        with ThreadPoolExecutor(max_workers=2) as executor:
            groups = list(executor.map(group_attempt, [501, 502]))
        assert sum(group is not None for group in groups) == 1
        group_winner = 501 if groups[0] else 502
        assert set(store.availability(batch_day)) == set(selections[group_winner])
        assert store.for_user(502 if group_winner == 501 else 501) == []
        retried = store.reserve_batch(group_winner, batch_day, list(reversed(selections[group_winner])), requests[group_winner])
        assert len(retried) == 2 and len(store.for_user(group_winner)) == 2
        print("PostgreSQL batch race passed: one complete group, no partial bookings, safe retry.")
        half_day = day + timedelta(days=1)
        def half_attempt(period):
            return store.reserve_batch(701 if period == "morning" else 702, half_day, ["S003"], str(uuid4()), period)
        with ThreadPoolExecutor(max_workers=2) as executor:
            halves = list(executor.map(half_attempt, ["morning", "evening"]))
        assert len(halves) == 2 and all(len(group) == 1 for group in halves)
        try:
            store.reserve_batch(703, half_day, ["S003"], str(uuid4()), "full")
            raise AssertionError("Full day overlaps existing halves")
        except BatchConflict:
            pass
        overlap_day = day + timedelta(days=10)
        def overlap_attempt(period):
            try:
                return store.reserve_batch(801 if period == "full" else 802, overlap_day, ["S004"], str(uuid4()), period)
            except (BatchConflict, SeatTaken):
                return None
        with ThreadPoolExecutor(max_workers=2) as executor:
            overlap = list(executor.map(overlap_attempt, ["full", "morning"]))
        assert sum(group is not None for group in overlap) == 1
        print("PostgreSQL periods passed: both non-overlapping halves succeed, full-day overlap has one winner.")
        assert len(store.admin_tariffs()) == 20
        store.set_tariff(0, "full", 1050, 900, 752963390)
        store.initialize()
        assert store.tariffs_for(day)[0]["price_uah"] == 1050
        assert store.reserve(winner, day, "S001", saved["id"])["price_uah"] == 900
        price_day = day + timedelta(days=21)
        try:
            store.reserve_batch(901, price_day, ["S002"], str(uuid4()), expected_price_uah=900)
            raise AssertionError("Stale price accepted")
        except PriceChanged:
            pass
        assert store.availability(price_day) == []
        assert store.reserve_batch(901, price_day, ["S002"], str(uuid4()), expected_price_uah=1050)[0]["price_uah"] == 1050
        def price_attempt(price):
            try:
                return store.set_tariff(0, "full", price, 1050, 752963390)
            except PriceChanged:
                return None
        with ThreadPoolExecutor(max_workers=2) as executor:
            price_results = list(executor.map(price_attempt, [1100, 1150]))
        assert sum(result is not None for result in price_results) == 1
        expected_price = store.tariffs_for(day)[0]["price_uah"]
        store.close()
        store = BookingStore(url.set(database=name))
        store.initialize()
        assert store.tariffs_for(day)[0]["price_uah"] == expected_price
        print("PostgreSQL price edits passed: persisted tariffs, unchanged booking snapshots, stale-price rejection and one admin-write winner.")
        print("PostgreSQL passed: one winner out of four concurrent requests, owner isolation, retry safety and persistence.")
    finally:
        if store:
            store.close()
        connection.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))
        print("Temporary verification database removed; production bookings untouched.")
