from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select
from wellness.booking_store import bookings, booking_slots
from wellness.tariffs import tariffs_for
from test_availability import client
from test_bookings import auth, booking_day


@pytest.mark.parametrize("offset,prices,adults", [
    (0, [900, 600, 600], [False, False, False]),
    (1, [900, 600, 600], [False, False, False]),
    (2, [1500, 900, 900], [True, True, True]),
    (3, [900, 600, 600], [False, False, False]),
    (4, [1350, 1100, 1100], [False, False, False]),
    (5, [1100, 1950], [False, True]),
    (6, [1350, 1100, 1100], [False, False, False]),
])
def test_exact_weekly_tariffs(offset, prices, adults):
    result = tariffs_for(booking_day() + timedelta(days=offset))
    assert [item["price_uah"] for item in result] == prices
    assert [item["adults_only"] for item in result] == adults
    assert [item["visit_time"] for item in result][-2:] == ["08:00–13:00", "14:00–21:00"]


def reserve(client, period, seats=None, day=None, **extra):
    return client.post("/api/v1/bookings/batch", headers=auth(), json={
        "day": (day or booking_day()).isoformat(), "seat_ids": seats or ["S001"],
        "period": period, "request_id": str(uuid4()), **extra,
    })


def test_independent_halves_and_full_day_conflicts(client):
    store = client.app.state.booking_store
    store.set_seat_enabled("S001", True, False, 123)
    morning = reserve(client, "morning")
    assert morning.status_code == 201 and morning.json()["total_uah"] == 600
    assert store.availability(booking_day(), "evening") == []
    assert store.availability(booking_day(), "full") == ["S001"]
    assert reserve(client, "morning").status_code == 409
    assert reserve(client, "evening").status_code == 201
    assert reserve(client, "full").status_code == 409
    assert len(store.for_user(123)) == 2
    with store.engine.connect() as connection:
        assert len(connection.execute(select(booking_slots)).all()) == 2
        assert len(connection.execute(select(bookings)).all()) == 2


def test_full_day_blocks_both_halves_and_price_is_server_owned(client):
    store = client.app.state.booking_store
    store.set_seat_enabled("S001", True, False, 123)
    assert reserve(client, "full", price_uah=1).status_code == 422
    response = reserve(client, "full")
    assert response.json()["total_uah"] == 900
    record = response.json()["bookings"][0]
    assert record["price_uah"] == 900 and record["period"] == "full"
    assert "08:00–21:00" in record["visit_time"]
    assert reserve(client, "morning").status_code == 409
    assert reserve(client, "evening").status_code == 409


def test_age_confirmation_and_saturday_rules(client):
    client.app.state.booking_store.set_seat_enabled("S001", True, False, 123)
    wednesday = booking_day() + timedelta(days=2)
    assert reserve(client, "morning", day=wednesday).json()["detail"] == "adult_confirmation_required"
    result = reserve(client, "morning", day=wednesday, adult_confirmed=True)
    assert result.json()["bookings"][0]["adults_only"] is True
    assert result.json()["total_uah"] == 900
    saturday = booking_day() + timedelta(days=5)
    assert reserve(client, "full", day=saturday, adult_confirmed=True).status_code == 422
    assert reserve(client, "evening", day=saturday).status_code == 422
    assert reserve(client, "evening", day=saturday, adult_confirmed=True).json()["total_uah"] == 1950
    assert reserve(client, "morning", day=saturday).json()["total_uah"] == 1100
    availability = client.get("/api/v1/pool/availability", params={"day": saturday.isoformat()}).json()
    assert availability["period"] == "morning" and len(availability["tariffs"]) == 2
    assert client.get("/api/v1/pool/availability", params={"day": saturday.isoformat(), "period": "full"}).status_code == 422


def test_group_total_atomicity_and_period_scoped_retry(client):
    store = client.app.state.booking_store
    for seat in ["S001", "S002"]:
        store.set_seat_enabled(seat, True, False, 123)
    result = reserve(client, "morning", ["S001", "S002"])
    assert result.json()["total_uah"] == 1200
    body = {"day": booking_day().isoformat(), "period": "morning", "seat_ids": ["S002", "S001"], "request_id": result.json()["request_id"]}
    assert client.post("/api/v1/bookings/batch", headers=auth(), json=body).json() == result.json()
    assert client.post("/api/v1/bookings/batch", headers=auth(), json={**body, "period": "evening"}).status_code == 409
    assert reserve(client, "evening", ["S001"]).status_code == 201
    assert reserve(client, "evening", ["S001", "S002"]).status_code == 409
    assert store.availability(booking_day(), "evening") == ["S001"]


def test_price_snapshot_survives_retry_and_finished_periods_are_hidden(client, monkeypatch):
    store = client.app.state.booking_store
    store.set_seat_enabled("S001", True, False, 123)
    result = reserve(client, "morning").json()
    from wellness.tariffs import tariff_for
    def changed(day, period):
        return {**tariff_for(day, period), "price_uah": 9999}
    monkeypatch.setattr("wellness.booking_store.tariff_for", changed)
    body = {"day": booking_day().isoformat(), "period": "morning", "seat_ids": ["S001"], "request_id": result["request_id"]}
    assert client.post("/api/v1/bookings/batch", headers=auth(), json=body).json() == result
    monkeypatch.setattr("wellness.booking_store.has_ended", lambda day, period: period == "morning")
    assert client.get("/api/v1/bookings/mine", headers=auth()).json()["bookings"] == []
    with store.engine.connect() as connection:
        assert len(connection.execute(select(bookings)).all()) == 1


def test_finished_period_cannot_create_a_reservation(client, monkeypatch):
    client.app.state.booking_store.set_seat_enabled("S001", True, False, 123)
    monkeypatch.setattr("wellness.tariffs.has_ended", lambda day, period: True)
    assert reserve(client, "morning").json()["detail"] == "past_period"
    assert client.app.state.booking_store.availability(booking_day()) == []
