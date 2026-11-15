from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from wellness.main import create_app
from wellness.config import Settings
from wellness.booking_store import today_kyiv
from test_bookings import auth, TOKEN, payload, booking_day

@pytest.fixture
def client():
    with TestClient(create_app(Settings(_env_file=None,bot_token=TOKEN,database_url="sqlite://",admin_telegram_ids=[123]))) as value:
        for seat in ["S001","S002","S003"]:
            value.app.state.booking_store.set_seat_enabled(seat,True,False,123)
        yield value

def batch(**changes):
    return {"day":booking_day().isoformat(),"seat_ids":["S001","S002"],"request_id":str(uuid4()),**changes}

def test_batch_confirmation_and_idempotence(client):
    body=batch()
    result=client.post("/api/v1/bookings/batch",headers=auth(456),json=body)
    assert result.status_code==201
    records=result.json()["bookings"]
    assert {item["seat_id"] for item in records}=={"S001","S002"}
    retry=client.post("/api/v1/bookings/batch",headers=auth(456),json={**body,"seat_ids":["S002","S001"]})
    assert retry.json()==result.json()
    assert len(client.get("/api/v1/bookings/mine",headers=auth(456)).json()["bookings"])==2
    assert client.get("/api/v1/bookings/mine",headers=auth(789)).json()["bookings"]==[]
    assert client.post("/api/v1/bookings/batch",headers=auth(789),json=body).status_code==409
    assert client.post("/api/v1/bookings/batch",headers=auth(456),json={**body,"seat_ids":["S003"]}).status_code==409
    client.app.state.booking_store.set_seat_enabled("S001",False,True,123)
    assert client.post("/api/v1/bookings/batch",headers=auth(456),json=body).json()==result.json()

def test_batch_rolls_back_all_when_one_place_is_taken(client):
    single={**payload(),"day":booking_day().isoformat(),"seat_id":"S002"}
    assert client.post("/api/v1/bookings",headers=auth(789),json=single).status_code==201
    result=client.post("/api/v1/bookings/batch",headers=auth(456),json=batch())
    assert result.status_code==409
    assert result.json()["detail"]=={"code":"seat_unavailable","seat_ids":["S002"]}
    assert client.get("/api/v1/bookings/mine",headers=auth(456)).json()["bookings"]==[]
    assert client.app.state.booking_store.availability(booking_day())==["S002"]

def test_batch_rolls_back_all_when_one_place_is_closed(client):
    result=client.post("/api/v1/bookings/batch",headers=auth(456),json=batch(seat_ids=["S001","S004"]))
    assert result.status_code==409 and result.json()["detail"]["code"]=="seat_disabled"
    assert client.app.state.booking_store.availability(booking_day())==[]

def test_batch_input_validation_and_auth(client):
    assert client.post("/api/v1/bookings/batch",json=batch()).status_code==401
    for chosen in [[],["S001","S001"],["S999"]]:
        assert client.post("/api/v1/bookings/batch",headers=auth(),json=batch(seat_ids=chosen)).status_code==422
    assert client.post("/api/v1/bookings/batch",headers=auth(),json=batch(user_id=456)).status_code==422
