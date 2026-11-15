"""Daily seat reservations, protected by database uniqueness constraints."""
from datetime import date, datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
import json
from .tariffs import tariff_for, tariffs_for, has_ended
from sqlalchemy import BigInteger, Boolean, Column, Date, DateTime, Integer, MetaData, String, Text, Table, UniqueConstraint, create_engine, select, false
from sqlalchemy.exc import IntegrityError
from sqlalchemy.pool import StaticPool

CATALOG = json.loads((Path(__file__).parent / "data/seats.json").read_text(encoding="utf-8"))
SEAT_IDS = frozenset(item["id"] for item in CATALOG["seats"])
metadata = MetaData()
weekly_tariffs = Table(
    "pool_weekly_tariffs", metadata,
    Column("weekday", Integer, primary_key=True),
    Column("period", String(16), primary_key=True),
    Column("price_uah", BigInteger, nullable=False),
)
tariff_audit = Table(
    "pool_tariff_audit", metadata,
    Column("id", String(36), primary_key=True),
    Column("admin_id", BigInteger, nullable=False),
    Column("weekday", Integer, nullable=False),
    Column("period", String(16), nullable=False),
    Column("old_price_uah", BigInteger, nullable=False),
    Column("new_price_uah", BigInteger, nullable=False),
    Column("changed_at", DateTime(timezone=True), nullable=False),
)
booking_batches = Table(
    "pool_booking_batches", metadata,
    Column("id", String(36), primary_key=True),
    Column("user_id", BigInteger, nullable=False),
    Column("day", Date, nullable=False),
    Column("seat_ids", Text, nullable=False),
    Column("period", String(16), nullable=False, server_default="full"),
)
bookings = Table(
    "pool_bookings", metadata,
    Column("id", String(36), primary_key=True),
    Column("user_id", BigInteger, nullable=False, index=True),
    Column("day", Date, nullable=False),
    Column("seat_id", String(16), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("period", String(16), nullable=False, server_default="full"),
    Column("price_uah", BigInteger, nullable=True),
    Column("adults_only", Boolean, nullable=False, server_default=false()),
)
booking_slots = Table(
    "pool_booking_slots", metadata,
    Column("day", Date, primary_key=True),
    Column("seat_id", String(16), primary_key=True),
    Column("slot", String(16), primary_key=True),
    Column("booking_id", String(36), nullable=False, index=True),
)
seats = Table(
    "pool_seats", metadata,
    Column("seat_id", String(16), primary_key=True),
    Column("number", BigInteger, nullable=True, unique=True),
    Column("enabled", Boolean, nullable=False, default=False, server_default=false()),
)
availability_audit = Table(
    "pool_seat_availability_audit", metadata,
    Column("id", String(36), primary_key=True),
    Column("seat_id", String(16), nullable=False),
    Column("admin_id", BigInteger, nullable=False),
    Column("old_enabled", Boolean, nullable=False),
    Column("new_enabled", Boolean, nullable=False),
    Column("changed_at", DateTime(timezone=True), nullable=False),
)
seat_audit = Table(
    "pool_seat_number_audit", metadata,
    Column("id", String(36), primary_key=True),
    Column("seat_id", String(16), nullable=False),
    Column("admin_id", BigInteger, nullable=False),
    Column("old_number", BigInteger, nullable=True),
    Column("new_number", BigInteger, nullable=True),
    Column("changed_at", DateTime(timezone=True), nullable=False),
)


class NumberConflict(Exception):
    pass


class SeatChanged(Exception):
    pass


class PriceChanged(Exception):
    def __init__(self, price_uah: int):
        self.price_uah = price_uah


def today_kyiv() -> date:
    return datetime.now(ZoneInfo("Europe/Kyiv")).date()


class SeatTaken(Exception):
    pass


class BatchConflict(Exception):
    def __init__(self, code: str, seat_ids: list[str]):
        self.code, self.seat_ids = code, seat_ids



class InvalidBooking(Exception):
    pass


def serialize(row) -> dict:
    stamp = row["created_at"]
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    period = row.get("period", "full")
    return {"id": row["id"], "seat_id": row["seat_id"], "seat_number": row.get("seat_number"), "day": row["day"].isoformat(), "created_at": stamp.astimezone(timezone.utc).isoformat(),
            "period": period, "visit_time": {"full": "Цілий день · 08:00–21:00", "morning": "08:00–13:00", "evening": "14:00–21:00"}[period],
            "price_uah": row.get("price_uah"), "adults_only": row.get("adults_only", False)}


def period_slots(period: str) -> list[str]:
    if period not in ("full", "morning", "evening"):
        raise InvalidBooking("invalid_period")
    return ["morning", "evening"] if period == "full" else [period]


class BookingStore:
    def __init__(self, url: str):
        options = {"pool_pre_ping": True, "hide_parameters": True}
        if url in ("sqlite://", "sqlite:///:memory:"):
            options.update(poolclass=StaticPool, connect_args={"check_same_thread": False})
        elif str(url).startswith("postgresql"):
            options.update(pool_size=3, max_overflow=2, pool_timeout=10,
                           connect_args={"connect_timeout": 5, "options": "-c statement_timeout=10000"})
        self.engine = create_engine(url, **options)

    def initialize(self) -> None:
        metadata.create_all(self.engine)
        with self.engine.begin() as connection:
            known = set(connection.execute(select(seats.c.seat_id)).scalars())
            if not known:
                connection.execute(seats.insert(), [{"seat_id": item["id"], "number": i + 1} for i, item in enumerate(CATALOG["seats"])])
            elif known != SEAT_IDS:
                raise ValueError("Seat catalog changed; an explicit migration is required")
            from datetime import timedelta
            from sqlalchemy.dialects.postgresql import insert as pg_insert
            from sqlalchemy.dialects.sqlite import insert as sqlite_insert
            seed = pg_insert if self.engine.dialect.name == "postgresql" else sqlite_insert
            values = [dict(weekday=weekday, period=tariff["id"], price_uah=tariff["price_uah"])
                      for weekday in range(7) for tariff in tariffs_for(date(2026, 1, 5) + timedelta(days=weekday))]
            connection.execute(seed(weekly_tariffs).values(values).on_conflict_do_nothing())

    def tariff_overrides(self) -> dict[int, dict[str, int]]:
        with self.engine.connect() as connection:
            result: dict[int, dict[str, int]] = {}
            for row in connection.execute(select(weekly_tariffs)).mappings():
                result.setdefault(row["weekday"], {})[row["period"]] = row["price_uah"]
            return result

    def tariffs_for(self, day: date) -> list[dict]:
        return tariffs_for(day, self.tariff_overrides().get(day.weekday()))

    def admin_tariffs(self) -> list[dict]:
        from datetime import timedelta
        overrides = self.tariff_overrides()
        return [dict(weekday=weekday, **{key: value for key, value in tariff.items() if key != "ended"})
                for weekday in range(7) for tariff in tariffs_for(date(2026, 1, 5) + timedelta(days=weekday), overrides.get(weekday))]

    def set_tariff(self, weekday: int, period: str, price_uah: int, expected_price_uah: int, admin_id: int) -> dict:
        from uuid import uuid4
        if type(price_uah) is not int or not 0 <= price_uah <= 1_000_000:
            raise InvalidBooking("invalid_price")
        key = (weekly_tariffs.c.weekday == weekday, weekly_tariffs.c.period == period)
        with self.engine.begin() as connection:
            current = connection.execute(select(weekly_tariffs.c.price_uah).where(*key).with_for_update()).scalar_one_or_none()
            if current is None:
                raise InvalidBooking("invalid_tariff")
            if current != expected_price_uah:
                raise PriceChanged(current)
            if current != price_uah:
                result = connection.execute(weekly_tariffs.update().where(*key, weekly_tariffs.c.price_uah == expected_price_uah).values(price_uah=price_uah))
                if result.rowcount != 1:
                    raise PriceChanged(current)
                connection.execute(tariff_audit.insert().values(id=str(uuid4()), admin_id=admin_id, weekday=weekday, period=period,
                    old_price_uah=current, new_price_uah=price_uah, changed_at=datetime.now(timezone.utc)))
        return {"weekday": weekday, "id": period, "price_uah": price_uah}

    def seat_numbers(self) -> dict[str, int | None]:
        with self.engine.connect() as connection:
            return dict(connection.execute(select(seats.c.seat_id, seats.c.number)).all())

    def seat_enabled(self) -> dict[str, bool]:
        with self.engine.connect() as connection:
            return dict(connection.execute(select(seats.c.seat_id, seats.c.enabled)).all())

    def set_seat_enabled(self, seat_id: str, enabled: bool, expected_enabled: bool, admin_id: int) -> dict:
        from uuid import uuid4
        if seat_id not in SEAT_IDS:
            raise InvalidBooking("unknown_seat")
        with self.engine.begin() as connection:
            current = connection.execute(select(seats.c.enabled).where(seats.c.seat_id == seat_id).with_for_update()).scalar_one()
            if current != expected_enabled:
                raise SeatChanged()
            if current != enabled:
                result = connection.execute(seats.update().where(seats.c.seat_id == seat_id, seats.c.enabled == expected_enabled).values(enabled=enabled))
                if result.rowcount != 1:
                    raise SeatChanged()
                connection.execute(availability_audit.insert().values(
                    id=str(uuid4()), seat_id=seat_id, admin_id=admin_id,
                    old_enabled=current, new_enabled=enabled, changed_at=datetime.now(timezone.utc),
                ))
        return {"seat_id": seat_id, "enabled": enabled}

    def set_seats_enabled(self, expected: dict[str, bool], enabled: bool, admin_id: int) -> dict:
        from uuid import uuid4
        if not expected or not set(expected).issubset(SEAT_IDS):
            raise InvalidBooking("unknown_seat")
        with self.engine.begin() as connection:
            rows = connection.execute(select(seats).where(seats.c.seat_id.in_(expected)).order_by(seats.c.seat_id).with_for_update()).mappings().all()
            if len(rows) != len(expected) or any(row["enabled"] != expected[row["seat_id"]] for row in rows):
                raise SeatChanged()
            for row in rows:
                if row["enabled"] == enabled:
                    continue
                result = connection.execute(seats.update().where(seats.c.seat_id == row["seat_id"], seats.c.enabled == row["enabled"]).values(enabled=enabled))
                if result.rowcount != 1:
                    raise SeatChanged()
                connection.execute(availability_audit.insert().values(
                    id=str(uuid4()), seat_id=row["seat_id"], admin_id=admin_id,
                    old_enabled=row["enabled"], new_enabled=enabled, changed_at=datetime.now(timezone.utc),
                ))
        return {"enabled": {seat_id: enabled for seat_id in expected}}

    def rename_seat(self, seat_id: str, number: int, expected_number: int | None, admin_id: int) -> dict:
        from uuid import uuid4
        if seat_id not in SEAT_IDS:
            raise InvalidBooking("unknown_seat")
        if type(number) is not int or not 1 <= number <= 9999:
            raise InvalidBooking("invalid_number")
        try:
            with self.engine.begin() as connection:
                current = connection.execute(select(seats.c.number).where(seats.c.seat_id == seat_id).with_for_update()).scalar_one()
                if current != expected_number:
                    raise SeatChanged()
                if current == number:
                    return {"seat_id": seat_id, "number": number}
                result = connection.execute(seats.update().where(seats.c.seat_id == seat_id, seats.c.number == expected_number).values(number=number))
                if result.rowcount != 1:
                    raise SeatChanged()
                connection.execute(seat_audit.insert().values(
                    id=str(uuid4()), seat_id=seat_id, admin_id=admin_id,
                    old_number=current, new_number=number, changed_at=datetime.now(timezone.utc),
                ))
            return {"seat_id": seat_id, "number": number}
        except IntegrityError:
            raise NumberConflict() from None

    def clear_seat_numbers(self, admin_id: int) -> int:
        from uuid import uuid4
        with self.engine.begin() as connection:
            # Lock in stable order so edits cannot interleave with clearing.
            rows = connection.execute(select(seats).order_by(seats.c.seat_id).with_for_update()).mappings().all()
            changes = [row for row in rows if row["number"] is not None]
            if changes:
                connection.execute(seat_audit.insert(), [dict(
                    id=str(uuid4()), seat_id=row["seat_id"], admin_id=admin_id,
                    old_number=row["number"], new_number=None, changed_at=datetime.now(timezone.utc),
                ) for row in changes])
                connection.execute(seats.update().values(number=None))
            return len(changes)

    def close(self) -> None:
        self.engine.dispose()

    def availability(self, day: date, period: str = "full") -> list[str]:
        with self.engine.connect() as connection:
            periods = ["full", *period_slots(period)]
            return list(connection.execute(select(bookings.c.seat_id).where(bookings.c.day == day, bookings.c.period.in_(periods)).distinct().order_by(bookings.c.seat_id)).scalars())

    def for_user(self, user_id: int) -> list[dict]:
        with self.engine.connect() as connection:
            rows = connection.execute(select(bookings, seats.c.number.label("seat_number")).join(seats, seats.c.seat_id == bookings.c.seat_id).where(bookings.c.user_id == user_id, bookings.c.day >= today_kyiv()).order_by(bookings.c.day.asc(), seats.c.number)).mappings()
            return [serialize(row) for row in rows if not has_ended(row["day"], row["period"])]

    def quote(self, day: date, period: str, adult_confirmed: bool, connection, expected_price_uah: int | None = None) -> dict:
        try:
            quote = tariff_for(day, period)
        except ValueError:
            raise InvalidBooking("invalid_period") from None
        if quote["ended"]:
            raise InvalidBooking("past_period")
        if quote["adults_only"] and not adult_confirmed:
            raise InvalidBooking("adult_confirmation_required")
        price = connection.execute(select(weekly_tariffs.c.price_uah).where(
            weekly_tariffs.c.weekday == day.weekday(), weekly_tariffs.c.period == period).with_for_update(read=True)).scalar_one()
        if expected_price_uah is not None and expected_price_uah != price:
            raise PriceChanged(price)
        quote["price_uah"] = price
        return quote

    def reserve(self, user_id: int, day: date, seat_id: str, request_id: str, period: str = "full", adult_confirmed: bool = False, expected_price_uah: int | None = None) -> dict:
        if day < today_kyiv():
            raise InvalidBooking("past_date")
        if seat_id not in SEAT_IDS:
            raise InvalidBooking("unknown_seat")
        values = dict(id=request_id, user_id=user_id, day=day, seat_id=seat_id, period=period, created_at=datetime.now(timezone.utc))
        try:
            with self.engine.begin() as connection:
                # A retry of an already saved booking remains safe after closure.
                query = select(bookings, seats.c.number.label("seat_number")).join(seats, seats.c.seat_id == bookings.c.seat_id)
                existing = connection.execute(query.where(bookings.c.id == request_id)).mappings().first()
                if existing:
                    if (existing["user_id"], existing["day"], existing["seat_id"], existing["period"]) == (user_id, day, seat_id, period):
                        return serialize(existing)
                    raise SeatTaken()
                quote = self.quote(day, period, adult_confirmed, connection, expected_price_uah)
                place = connection.execute(select(seats.c.number, seats.c.enabled).where(seats.c.seat_id == seat_id).with_for_update()).one()
                if not place.enabled:
                    raise InvalidBooking("seat_disabled")
                overlapping = connection.execute(select(bookings.c.id).where(bookings.c.day == day, bookings.c.seat_id == seat_id, bookings.c.period.in_(["full", *period_slots(period)]))).first()
                if overlapping:
                    raise SeatTaken()
                values.update(price_uah=quote["price_uah"], adults_only=quote["adults_only"])
                connection.execute(bookings.insert().values(**values))
                connection.execute(booking_slots.insert(), [dict(day=day, seat_id=seat_id, slot=slot, booking_id=request_id) for slot in period_slots(period)])
                values["seat_number"] = place.number
            return serialize(values)
        except IntegrityError:
            # Re-query only after rolling back the failed transaction.
            with self.engine.connect() as connection:
                query = select(bookings, seats.c.number.label("seat_number")).join(seats, seats.c.seat_id == bookings.c.seat_id)
                existing_id = connection.execute(query.where(bookings.c.id == request_id)).mappings().first()
                if existing_id:
                    if (existing_id["user_id"], existing_id["day"], existing_id["seat_id"], existing_id["period"]) == (user_id, day, seat_id, period):
                        return serialize(existing_id)
                    raise SeatTaken()
                existing = connection.execute(query.where(bookings.c.day == day, bookings.c.seat_id == seat_id, bookings.c.period == period)).mappings().first()
                if existing and existing["user_id"] == user_id:
                    return serialize(existing)
            raise SeatTaken()

    def reserve_batch(self, user_id: int, day: date, seat_ids: list[str], request_id: str, period: str = "full", adult_confirmed: bool = False, expected_price_uah: int | None = None) -> list[dict]:
        from uuid import UUID, uuid5
        if day < today_kyiv():
            raise InvalidBooking("past_date")
        if not seat_ids or len(seat_ids) > len(SEAT_IDS) or len(set(seat_ids)) != len(seat_ids):
            raise InvalidBooking("invalid_selection")
        if not set(seat_ids) <= SEAT_IDS:
            raise InvalidBooking("unknown_seat")
        chosen = sorted(seat_ids)
        encoded = json.dumps(chosen)
        ids = {seat: str(uuid5(UUID(request_id), seat)) for seat in chosen}

        def retry(connection):
            prior = connection.execute(select(booking_batches).where(booking_batches.c.id == request_id)).mappings().first()
            if not prior:
                return None
            if (prior["user_id"], prior["day"], prior["seat_ids"], prior["period"]) != (user_id, day, encoded, period):
                raise SeatTaken()
            rows = connection.execute(select(bookings, seats.c.number.label("seat_number"))
                .join(seats, seats.c.seat_id == bookings.c.seat_id)
                .where(bookings.c.id.in_(ids.values()), bookings.c.user_id == user_id)
                .order_by(bookings.c.seat_id)).mappings().all()
            if len(rows) != len(chosen):
                raise SeatTaken()
            return [serialize(row) for row in rows]

        try:
            with self.engine.begin() as connection:
                existing = retry(connection)
                if existing is not None:
                    return existing
                quote = self.quote(day, period, adult_confirmed, connection, expected_price_uah)
                # Lock every selected place in the same order as other batches
                # and admin operations; all records commit or roll back together.
                places = connection.execute(select(seats).where(seats.c.seat_id.in_(chosen))
                    .order_by(seats.c.seat_id).with_for_update()).mappings().all()
                disabled = [row["seat_id"] for row in places if not row["enabled"]]
                if disabled:
                    raise BatchConflict("seat_disabled", disabled)
                taken = list(connection.execute(select(bookings.c.seat_id).where(
                    bookings.c.day == day, bookings.c.seat_id.in_(chosen), bookings.c.period.in_(["full", *period_slots(period)])).distinct().order_by(bookings.c.seat_id)).scalars())
                if taken:
                    # A concurrent identical retry may have waited for these locks.
                    existing = retry(connection)
                    if existing is not None:
                        return existing
                    raise BatchConflict("seat_unavailable", taken)
                connection.execute(booking_batches.insert().values(id=request_id, user_id=user_id, day=day, seat_ids=encoded, period=period))
                now = datetime.now(timezone.utc)
                rows = [dict(id=ids[row["seat_id"]], user_id=user_id, day=day,
                             seat_id=row["seat_id"], created_at=now, period=period, price_uah=quote["price_uah"], adults_only=quote["adults_only"]) for row in places]
                connection.execute(bookings.insert(), rows)
                connection.execute(booking_slots.insert(), [dict(day=day, seat_id=row["seat_id"], slot=slot, booking_id=row["id"]) for row in rows for slot in period_slots(period)])
                labels = {row["seat_id"]: row["number"] for row in places}
                return [serialize({**row, "seat_number": labels[row["seat_id"]]}) for row in rows]
        except IntegrityError:
            with self.engine.connect() as connection:
                existing = retry(connection)
                if existing is not None:
                    return existing
            raise SeatTaken() from None
