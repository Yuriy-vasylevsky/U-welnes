import hashlib
import hmac
import json
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from urllib.parse import urlencode
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from wellness.booking_store import BookingStore, SeatTaken, today_kyiv
from wellness.config import Settings
from wellness.main import create_app

TOKEN = "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijk"


def auth(user=123, stamp=None):
    data = {"auth_date": str(int(time.time()) if stamp is None else stamp), "user": json.dumps({"id": user})}
    secret = hmac.new(b"WebAppData", TOKEN.encode(), hashlib.sha256).digest()
    signature = hmac.new(secret, "\n".join(f"{key}={value}" for key, value in sorted(data.items())).encode(), hashlib.sha256).hexdigest()
    return {"Authorization": "tma " + urlencode({**data, "hash": signature})}


@pytest.fixture
def client():
    config = Settings(_env_file=None, bot_token=TOKEN, database_url="sqlite://")
    with TestClient(create_app(config)) as value:
        yield value


def payload(**changes):
    return {"day": (today_kyiv() + timedelta(days=1)).isoformat(), "seat_id": "S001", "request_id": str(uuid4()), **changes}


def test_booking_ownership_availability_and_retry(client):
    body = payload()
    response = client.post("/api/v1/bookings", json=body, headers=auth())
    assert response.status_code == 201
    assert client.post("/api/v1/bookings", json=body, headers=auth()).json()["id"] == response.json()["id"]
    assert client.get("/api/v1/bookings/mine", headers=auth()).json()["bookings"] == [response.json()]
    assert client.get("/api/v1/bookings/mine", headers=auth(456)).json()["bookings"] == []
    available = client.get("/api/v1/pool/availability", params={"day": body["day"]}).json()
    assert available["reserved"] == ["S001"] and available["seat_count"] == 387
    assert "user" not in str(available)
    assert client.post("/api/v1/bookings", json=payload(), headers=auth(456)).status_code == 409
    # A different date is independent.
    assert client.post("/api/v1/bookings", json=payload(day=(today_kyiv()+timedelta(days=2)).isoformat()), headers=auth(456)).status_code == 201


@pytest.mark.parametrize("headers", [{}, {"Authorization": "tma forged"}, auth(stamp=1), auth(True)])
def test_untrusted_identity_rejected(client, headers):
    assert client.post("/api/v1/bookings", json=payload(), headers=headers).status_code == 401
    assert client.get("/api/v1/bookings/mine", headers=headers).status_code == 401


def test_invalid_seat_date_and_client_user_id(client):
    assert client.post("/api/v1/bookings", json=payload(seat_id="S999"), headers=auth()).status_code == 422
    assert client.post("/api/v1/bookings", json=payload(day=(today_kyiv()-timedelta(days=1)).isoformat()), headers=auth()).status_code == 422
    assert client.post("/api/v1/bookings", json=payload(user_id=456), headers=auth()).status_code == 422
    body = payload()
    assert client.post("/api/v1/bookings", json=body, headers=auth()).status_code == 201
    assert client.post("/api/v1/bookings", json={**body,"seat_id":"S002"}, headers=auth()).status_code == 409


def test_database_concurrency_and_persistence(tmp_path):
    url = "sqlite:///" + (tmp_path / "booking.db").as_posix()
    store = BookingStore(url); store.initialize()
    def attempt(user):
        try:
            store.reserve(user, today_kyiv(), "S001", str(uuid4()))
            return True
        except SeatTaken:
            return False
    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(attempt, range(1, 5)))
    assert results.count(True) == 1
    store.close()
    reopened = BookingStore(url)
    assert reopened.availability(today_kyiv()) == ["S001"]
    reopened.close()
