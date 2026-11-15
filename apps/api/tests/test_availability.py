import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from wellness.config import Settings
from wellness.main import create_app
from wellness.booking_store import availability_audit
from test_bookings import TOKEN, auth, payload

@pytest.fixture
def client():
    with TestClient(create_app(Settings(_env_file=None, bot_token=TOKEN, database_url="sqlite://", admin_telegram_ids=[123]))) as value:
        yield value

def toggle(client, enabled, expected, user=123, seat="S001"):
    return client.put(f"/api/v1/admin/seats/{seat}/availability", headers=auth(user), json={"enabled":enabled,"expected_enabled":expected})

def test_all_places_default_closed_and_cannot_be_booked(client):
    data=client.get("/api/v1/pool/seats").json()
    assert len(data["enabled"])==387 and not any(data["enabled"].values())
    result=client.post("/api/v1/bookings",headers=auth(456),json=payload())
    assert result.status_code==409 and result.json()["detail"]=="seat_disabled"
    assert client.get("/api/v1/bookings/mine",headers=auth(456)).json()["bookings"]==[]

def test_admin_activation_closure_and_existing_bookings(client):
    assert toggle(client,True,False,456).status_code==403
    assert toggle(client,True,False).status_code==200
    body=payload()
    saved=client.post("/api/v1/bookings",headers=auth(456),json=body)
    assert saved.status_code==201
    assert toggle(client,False,True).status_code==200
    assert client.get("/api/v1/bookings/mine",headers=auth(456)).json()["bookings"][0]["id"]==saved.json()["id"]
    assert client.post("/api/v1/bookings",headers=auth(456),json=body).json()["id"]==saved.json()["id"]
    assert client.post("/api/v1/bookings",headers=auth(789),json=payload()).json()["detail"]=="seat_disabled"
    assert toggle(client,True,True).json()["detail"]=="availability_changed"
    assert toggle(client,True,False).status_code==200
    assert client.post("/api/v1/bookings",headers=auth(789),json=payload()).json()["detail"]=="seat_unavailable"
    store=client.app.state.booking_store
    store.initialize()
    assert store.seat_enabled()["S001"] is True
    store.clear_seat_numbers(123)
    assert store.seat_enabled()["S001"] is True
    with store.engine.connect() as connection:
        rows=connection.execute(select(availability_audit)).mappings().all()
        assert len(rows)==3 and all(row["admin_id"]==123 for row in rows)

def test_availability_input_and_authentication(client):
    assert client.put("/api/v1/admin/seats/S001/availability",json={"enabled":True,"expected_enabled":False}).status_code==401
    assert toggle(client,1,False).status_code==422
    assert toggle(client,True,"false").status_code==422
    assert toggle(client,True,False,seat="S999").status_code==404


def test_bulk_availability_atomic_conflict_auth_and_audit(client):
    url = "/api/v1/admin/seats/availability/batch"
    body = {"enabled": True, "expected_enabled": {"S001": False, "S002": False}}
    assert client.put(url, json=body).status_code == 401
    assert client.put(url, json=body, headers=auth(456)).status_code == 403
    assert client.put(url, json=body, headers=auth()).json()["enabled"] == {"S001": True, "S002": True}
    assert client.put(url, json={"enabled": False, "expected_enabled": {"S001": True, "S002": False}}, headers=auth()).status_code == 409
    assert client.app.state.booking_store.seat_enabled()["S001"] is True
    assert client.put(url, json={"enabled": False, "expected_enabled": {"S001": True, "S002": True}}, headers=auth()).status_code == 200
    with client.app.state.booking_store.engine.connect() as connection:
        assert len(connection.execute(select(availability_audit)).all()) == 4
    assert client.put(url, json={"enabled": True, "expected_enabled": {}}, headers=auth()).status_code == 422
    assert client.put(url, json={"enabled": True, "expected_enabled": {"S001": "false"}}, headers=auth()).status_code == 422
    assert client.put(url, json={"enabled": True, "expected_enabled": {"S999": False}}, headers=auth()).status_code == 404
