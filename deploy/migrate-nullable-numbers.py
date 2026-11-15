"""Allow unnumbered seats without clearing or modifying existing data."""
from wellness.config import Settings
from wellness.booking_store import BookingStore

settings = Settings(_env_file="/etc/uwelnes/bot.env")
store = BookingStore(settings.database_url.get_secret_value())
try:
    with store.engine.begin() as connection:
        connection.exec_driver_sql("ALTER TABLE pool_seats ALTER COLUMN number DROP NOT NULL")
        connection.exec_driver_sql("ALTER TABLE pool_seat_number_audit ALTER COLUMN old_number DROP NOT NULL")
        connection.exec_driver_sql("ALTER TABLE pool_seat_number_audit ALTER COLUMN new_number DROP NOT NULL")
    print("Nullable numbering migration applied; all existing numbers and bookings preserved.")
finally:
    store.close()
