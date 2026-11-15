"""One-time default-closed availability column; never resets later activations."""
from wellness.config import Settings
from wellness.booking_store import BookingStore

settings = Settings(_env_file="/etc/uwelnes/bot.env")
store = BookingStore(settings.database_url.get_secret_value())
try:
    with store.engine.begin() as connection:
        connection.exec_driver_sql("ALTER TABLE pool_seats ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT FALSE")
    store.initialize()
    print("Availability migration ready. Existing bookings/numbers preserved; new places default closed.")
finally:
    store.close()
