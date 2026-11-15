"""PostgreSQL migration: retain legacy full days, add independent half-day slots."""
from wellness.config import Settings
from wellness.booking_store import BookingStore, metadata


def migrate(engine):
    # Run with the API and bot stopped so legacy writers cannot miss slot rows.
    with engine.begin() as connection:
        connection.exec_driver_sql("LOCK TABLE pool_bookings, pool_booking_batches IN ACCESS EXCLUSIVE MODE")
        connection.exec_driver_sql("ALTER TABLE pool_bookings ADD COLUMN IF NOT EXISTS period VARCHAR(16) NOT NULL DEFAULT 'full'")
        connection.exec_driver_sql("ALTER TABLE pool_bookings ADD COLUMN IF NOT EXISTS price_uah BIGINT NULL")
        connection.exec_driver_sql("ALTER TABLE pool_bookings ADD COLUMN IF NOT EXISTS adults_only BOOLEAN NOT NULL DEFAULT FALSE")
        connection.exec_driver_sql("ALTER TABLE pool_booking_batches ADD COLUMN IF NOT EXISTS period VARCHAR(16) NOT NULL DEFAULT 'full'")
        metadata.tables["pool_booking_slots"].create(connection, checkfirst=True)
        connection.exec_driver_sql("""
            INSERT INTO pool_booking_slots(day, seat_id, slot, booking_id)
            SELECT day, seat_id, slot, id FROM pool_bookings
            CROSS JOIN (VALUES ('morning'), ('evening')) AS parts(slot)
            WHERE period = 'full' OR period = slot
            ON CONFLICT(day, seat_id, slot) DO NOTHING
        """)
        conflicts = connection.exec_driver_sql("""
            SELECT count(*) FROM pool_bookings b
            CROSS JOIN (VALUES ('morning'), ('evening')) AS parts(slot)
            LEFT JOIN pool_booking_slots s ON s.day=b.day AND s.seat_id=b.seat_id AND s.slot=parts.slot AND s.booking_id=b.id
            WHERE (b.period='full' OR b.period=parts.slot) AND s.booking_id IS NULL
        """).scalar_one()
        if conflicts:
            raise RuntimeError("Existing overlapping bookings; migration rolled back")
        connection.exec_driver_sql("ALTER TABLE pool_bookings DROP CONSTRAINT IF EXISTS uq_pool_booking_day_seat")
    print("Periods ready; legacy reservations retained as full days with no retroactive price.")


if __name__ == "__main__":
    config = Settings(_env_file="/etc/uwelnes/bot.env")
    store = BookingStore(config.database_url.get_secret_value())
    try:
        migrate(store.engine)
    finally:
        store.close()
