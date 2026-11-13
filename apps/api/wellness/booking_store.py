"""Daily seat reservations, protected by database uniqueness constraints."""
from datetime import date, datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
import json
from sqlalchemy import BigInteger, Column, Date, DateTime, MetaData, String, Table, UniqueConstraint, create_engine, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.pool import StaticPool

CATALOG = json.loads((Path(__file__).parent / "data/seats.json").read_text(encoding="utf-8"))
SEAT_IDS = frozenset(item["id"] for item in CATALOG["seats"])
metadata = MetaData()
bookings = Table(
    "pool_bookings", metadata,
    Column("id", String(36), primary_key=True),
    Column("user_id", BigInteger, nullable=False, index=True),
    Column("day", Date, nullable=False),
    Column("seat_id", String(16), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    UniqueConstraint("day", "seat_id", name="uq_pool_booking_day_seat"),
)


def today_kyiv() -> date:
    return datetime.now(ZoneInfo("Europe/Kyiv")).date()


class SeatTaken(Exception):
    pass


class InvalidBooking(Exception):
    pass


def serialize(row) -> dict:
    stamp = row["created_at"]
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    return {"id": row["id"], "seat_id": row["seat_id"], "day": row["day"].isoformat(), "created_at": stamp.astimezone(timezone.utc).isoformat()}


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

    def close(self) -> None:
        self.engine.dispose()

    def availability(self, day: date) -> list[str]:
        with self.engine.connect() as connection:
            return list(connection.execute(select(bookings.c.seat_id).where(bookings.c.day == day)).scalars())

    def for_user(self, user_id: int) -> list[dict]:
        with self.engine.connect() as connection:
            rows = connection.execute(select(bookings).where(bookings.c.user_id == user_id).order_by(bookings.c.day.desc(), bookings.c.seat_id)).mappings()
            return [serialize(row) for row in rows]

    def reserve(self, user_id: int, day: date, seat_id: str, request_id: str) -> dict:
        if day < today_kyiv():
            raise InvalidBooking("past_date")
        if seat_id not in SEAT_IDS:
            raise InvalidBooking("unknown_seat")
        values = dict(id=request_id, user_id=user_id, day=day, seat_id=seat_id, created_at=datetime.now(timezone.utc))
        try:
            with self.engine.begin() as connection:
                connection.execute(bookings.insert().values(**values))
            return serialize(values)
        except IntegrityError:
            # Re-query only after rolling back the failed transaction.
            with self.engine.connect() as connection:
                existing_id = connection.execute(select(bookings).where(bookings.c.id == request_id)).mappings().first()
                if existing_id:
                    if (existing_id["user_id"], existing_id["day"], existing_id["seat_id"]) == (user_id, day, seat_id):
                        return serialize(existing_id)
                    raise SeatTaken()
                existing = connection.execute(select(bookings).where(bookings.c.day == day, bookings.c.seat_id == seat_id)).mappings().first()
                if existing and existing["user_id"] == user_id:
                    return serialize(existing)
            raise SeatTaken()
