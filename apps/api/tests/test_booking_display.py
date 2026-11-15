from datetime import date, datetime, timezone
from uuid import uuid4

from sqlalchemy import select, func
from wellness.booking_display import format_bookings, units
from wellness.booking_store import BookingStore, bookings


TODAY = date(2026, 11, 14)


def item(day, number=1, **changes):
    return {"id": str(uuid4()), "day": day, "seat_id": f"S{number:03}", "seat_number": number, **changes}


def test_cards_group_sort_and_hide_expired():
    result = format_bookings([
        item("2026-11-15", 12), item("2026-11-13", 99),
        item("2026-11-15", 3), item("2026-11-14", 2), item("2027-01-01", 4),
    ], TODAY)
    text = "\n".join(result)
    assert "№ 99" not in text
    assert "📅 <b>14.11</b> · Сьогодні" in text
    assert "📅 <b>15.11</b> · Завтра" in text
    assert "🛏 Шезлонги: <b>№ 3, № 12</b>" in text
    assert "🕒 <b>Цілий день</b>" in text
    assert text.index("14.11") < text.index("15.11") < text.index("01.01.27")


def test_empty_and_escape_future_visit_label():
    assert "Немає актуальних" in format_bookings([item("2026-11-13")], TODAY)[0]
    text = format_bookings([item("2026-11-14", seat_number=None, seat_id="<S001>", visit_time="10:00–14:00 & <test>")], TODAY)[0]
    assert "&lt;S001&gt;" in text
    assert "10:00–14:00 &amp; &lt;test&gt;" in text


def test_large_group_and_many_dates_fit_telegram_without_losing_places():
    records = [item("2026-11-14", number) for number in range(1, 388)]
    records += [item(f"2026-12-{day:02}", 999) for day in range(1, 32)]
    messages = format_bookings(records, TODAY)
    assert len(messages) > 1
    assert all(units(message) <= 3500 for message in messages)
    text = "\n".join(messages)
    for number in range(1, 388):
        assert f"№ {number}," in text or f"№ {number}</b>" in text
    assert text.count("№ 999") == 31
    assert all(message.count("<b>") == message.count("</b>") for message in messages)


def test_store_filters_past_days_keeps_today_and_history(monkeypatch):
    monkeypatch.setattr("wellness.booking_store.today_kyiv", lambda: TODAY)
    monkeypatch.setattr("wellness.booking_store.has_ended", lambda day, period: day < TODAY)
    store = BookingStore("sqlite://")
    store.initialize()
    try:
        with store.engine.begin() as connection:
            for user, day in [(123, 13), (123, 16), (456, 15), (123, 14)]:
                connection.execute(bookings.insert().values(
                    id=str(uuid4()), user_id=user, day=date(2026, 11, day),
                    seat_id="S001", created_at=datetime.now(timezone.utc),
                ))
        assert [record["day"] for record in store.for_user(123)] == ["2026-11-14", "2026-11-16"]
        assert len(store.for_user(456)) == 1
        with store.engine.connect() as connection:
            assert connection.scalar(select(func.count()).select_from(bookings)) == 4
    finally:
        store.close()
