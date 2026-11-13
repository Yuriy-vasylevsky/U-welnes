from datetime import date
import json
from typing import Annotated
from uuid import UUID
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict
from ..booking_store import BookingStore, InvalidBooking, SeatTaken
from ..telegram_auth import validate_init_data

router = APIRouter(prefix="/bookings", tags=["bookings"])


def store(request: Request) -> BookingStore:
    value = getattr(request.app.state, "booking_store", None)
    if value is None:
        raise HTTPException(503, "booking_unavailable")
    return value


def telegram_user(request: Request, authorization: Annotated[str | None, Header()] = None) -> int:
    if not authorization or not authorization.startswith("tma ") or len(authorization) > 16384:
        raise HTTPException(401, "telegram_required")
    try:
        data = validate_init_data(authorization[4:], request.app.state.settings.bot_token.get_secret_value())
        user_id = json.loads(data["user"])["id"]
        if type(user_id) is not int or not 0 < user_id < 2**63:
            raise ValueError()
        return user_id
    except (ValueError, KeyError, TypeError):
        raise HTTPException(401, "invalid_telegram_data") from None


class BookingInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    day: date
    seat_id: str
    request_id: UUID


@router.get("/mine")
def mine(user_id: int = Depends(telegram_user), database: BookingStore = Depends(store)):
    return {"bookings": database.for_user(user_id)}


@router.post("", status_code=201)
def reserve(body: BookingInput, user_id: int = Depends(telegram_user), database: BookingStore = Depends(store)):
    try:
        return database.reserve(user_id, body.day, body.seat_id, str(body.request_id))
    except InvalidBooking as error:
        raise HTTPException(422, str(error)) from None
    except SeatTaken:
        raise HTTPException(409, "seat_unavailable") from None
