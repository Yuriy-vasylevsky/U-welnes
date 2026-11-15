from datetime import timedelta
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from wellness.booking_store import seat_audit, today_kyiv
from wellness.config import Settings
from wellness.main import create_app
from test_bookings import TOKEN, auth, payload


@pytest.fixture
def client():
    config = Settings(_env_file=None, bot_token=TOKEN, database_url="sqlite://", admin_telegram_ids=[123])
    with TestClient(create_app(config)) as value:
        value.app.state.booking_store.set_seat_enabled("S001", True, False, 123)
        yield value


@pytest.mark.parametrize("headers,status", [({},401),(auth(456),403),({"Authorization":"tma fake"},401)])
def test_admin_access_denied(client, headers, status):
    assert client.get("/api/v1/admin/seats",headers=headers).status_code==status
    assert client.put("/api/v1/admin/seats/S001",headers=headers,json={"number":500,"expected_number":1}).status_code==status


def test_renumber_preserves_booking_identity_and_audits(client):
    body=payload()
    saved=client.post("/api/v1/bookings",headers=auth(456),json=body).json()
    assert saved["seat_number"]==1
    response=client.put("/api/v1/admin/seats/S001",headers=auth(),json={"number":500,"expected_number":1})
    assert response.status_code==200
    mine=client.get("/api/v1/bookings/mine",headers=auth(456)).json()["bookings"][0]
    assert mine["id"]==saved["id"] and mine["seat_id"]=="S001" and mine["seat_number"]==500
    # Re-numbering does not release the occupied place.
    assert client.post("/api/v1/bookings",headers=auth(789),json=payload()).status_code==409
    assert client.get("/api/v1/pool/seats").json()["numbers"]["S001"]==500
    assert client.get("/api/v1/pool/availability",params={"day":body["day"]}).json()["numbers"]["S001"]==500
    store=client.app.state.booking_store
    store.initialize()
    assert store.seat_numbers()["S001"]==500  # restart never resets labels
    with store.engine.connect() as connection:
        row=connection.execute(select(seat_audit)).mappings().one()
        assert (row["admin_id"],row["old_number"],row["new_number"])==(123,1,500)


def test_duplicate_stale_and_invalid_numbers(client):
    url="/api/v1/admin/seats/S001"
    assert client.put(url,headers=auth(),json={"number":2,"expected_number":1}).json()["detail"]=="number_in_use"
    assert client.put(url,headers=auth(),json={"number":500,"expected_number":1}).status_code==200
    assert client.put(url,headers=auth(),json={"number":501,"expected_number":1}).json()["detail"]=="seat_changed"
    for number in [0,-1,10000,True,"12",1.5]:
        assert client.put(url,headers=auth(),json={"number":number,"expected_number":500}).status_code==422
    assert client.put("/api/v1/admin/seats/S999",headers=auth(),json={"number":501,"expected_number":1}).status_code==404
    assert len(set(client.get("/api/v1/admin/seats",headers=auth()).json()["numbers"].values()))==387


def test_clear_requires_admin_and_explicit_confirmation(client):
    url="/api/v1/admin/seats/clear-numbers"
    assert client.post(url,json={"confirmation":"CLEAR_ALL_NUMBERS"}).status_code==401
    assert client.post(url,headers=auth(456),json={"confirmation":"CLEAR_ALL_NUMBERS"}).status_code==403
    assert client.post(url,headers=auth(),json={}).status_code==422
    assert client.post(url,headers=auth(),json={"confirmation":"yes"}).status_code==422
    assert client.get("/api/v1/pool/seats").json()["numbers"]["S001"]==1


def test_clear_preserves_places_bookings_and_allows_new_numbers(client):
    body=payload()
    saved=client.post("/api/v1/bookings",headers=auth(456),json=body).json()
    response=client.post("/api/v1/admin/seats/clear-numbers",headers=auth(),json={"confirmation":"CLEAR_ALL_NUMBERS"})
    assert response.status_code==200 and response.json()["cleared"]==387
    numbers=response.json()["numbers"]
    assert len(numbers)==387 and set(numbers.values())=={None}
    store=client.app.state.booking_store
    store.initialize()
    assert set(store.seat_numbers().values())=={None}
    mine=client.get("/api/v1/bookings/mine",headers=auth(456)).json()["bookings"][0]
    assert mine["id"]==saved["id"] and mine["seat_id"]=="S001" and mine["seat_number"] is None
    assert client.post("/api/v1/bookings",headers=auth(789),json=payload()).status_code==409
    assert client.post("/api/v1/admin/seats/clear-numbers",headers=auth(),json={"confirmation":"CLEAR_ALL_NUMBERS"}).json()["cleared"]==0
    with store.engine.connect() as connection:
        rows=connection.execute(select(seat_audit)).mappings().all()
        assert len(rows)==387 and all(row["new_number"] is None for row in rows)
    assert client.put("/api/v1/admin/seats/S001",headers=auth(),json={"number":7,"expected_number":None}).status_code==200
    assert client.get("/api/v1/bookings/mine",headers=auth(456)).json()["bookings"][0]["seat_number"]==7
    assert client.put("/api/v1/admin/seats/S002",headers=auth(),json={"number":7,"expected_number":None}).status_code==409
