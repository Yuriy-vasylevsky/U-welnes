from uuid import uuid4
from datetime import timedelta
from sqlalchemy import select
from wellness.booking_store import tariff_audit
from wellness.tariffs import tariff_summary
from test_availability import client
from test_bookings import auth, booking_day


def edit(client, weekday=0, period="full", price=1050, expected=900, user=123):
    return client.put(f"/api/v1/admin/tariffs/{weekday}/{period}", headers=auth(user), json={"price_uah": price, "expected_price_uah": expected})


def test_tariff_admin_access_validation_and_twenty_items(client):
    assert client.get("/api/v1/admin/tariffs").status_code == 401
    assert client.get("/api/v1/admin/tariffs", headers=auth(456)).status_code == 403
    rows = client.get("/api/v1/admin/tariffs", headers=auth()).json()["tariffs"]
    assert len(rows) == 20
    assert not any(row["weekday"] == 5 and row["id"] == "full" for row in rows)
    assert edit(client, user=456).status_code == 403
    for price in [-1, 1.5, "100", True, 1000001]:
        assert edit(client, price=price).status_code == 422
    assert edit(client, weekday=7).status_code == 404
    assert edit(client, weekday=5, period="full").status_code == 404


def test_price_edit_persists_is_audited_and_keeps_old_bookings(client):
    store = client.app.state.booking_store
    for seat in ["S001", "S002"]:
        store.set_seat_enabled(seat, True, False, 123)
    body = {"day": booking_day().isoformat(), "period": "full", "seat_ids": ["S001"], "request_id": str(uuid4()), "expected_price_uah": 900}
    old = client.post("/api/v1/bookings/batch", headers=auth(), json=body).json()
    assert old["total_uah"] == 900
    assert edit(client).status_code == 200
    conflict = edit(client, price=1100)
    assert conflict.status_code == 409 and conflict.json()["detail"]["price_uah"] == 1050
    store.initialize()
    assert store.tariffs_for(booking_day())[0]["price_uah"] == 1050
    assert "1050 грн" in tariff_summary(store.tariff_overrides())
    assert store.tariffs_for(booking_day() + timedelta(days=1))[0]["price_uah"] == 900
    public = client.get("/api/v1/pool/availability", params={"day": booking_day().isoformat()}).json()
    assert public["tariffs"][0]["price_uah"] == 1050
    assert client.post("/api/v1/bookings/batch", headers=auth(), json=body).json() == old
    fresh = {**body, "seat_ids": ["S002"], "request_id": str(uuid4())}
    changed = client.post("/api/v1/bookings/batch", headers=auth(), json=fresh)
    assert changed.status_code == 409 and changed.json()["detail"]["code"] == "price_changed"
    assert store.availability(booking_day()) == ["S001"]
    saved = client.post("/api/v1/bookings/batch", headers=auth(), json={**fresh, "expected_price_uah": 1050})
    assert saved.json()["total_uah"] == 1050
    assert [item["price_uah"] for item in store.for_user(123)] == [900, 1050]
    with store.engine.connect() as connection:
        rows = connection.execute(select(tariff_audit)).mappings().all()
        assert len(rows) == 1 and rows[0]["admin_id"] == 123
        assert rows[0]["old_price_uah"] == 900 and rows[0]["new_price_uah"] == 1050


def test_zero_price_and_age_rules_are_independent(client):
    assert edit(client, weekday=2, period="morning", price=0, expected=900).status_code == 200
    tariffs = client.app.state.booking_store.tariffs_for(booking_day() + timedelta(days=2))
    morning = next(item for item in tariffs if item["id"] == "morning")
    assert morning["price_uah"] == 0 and morning["adults_only"] is True
