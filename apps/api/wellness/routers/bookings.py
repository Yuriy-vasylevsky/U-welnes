from datetime import date
import json
from typing import Annotated, Literal
from uuid import UUID
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, StrictBool
from ..booking_store import BookingStore, InvalidBooking, SeatTaken, BatchConflict, PriceChanged
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
    period: Literal["full", "morning", "evening"] = "full"
    adult_confirmed: StrictBool = False
    expected_price_uah: int | None = Field(default=None, strict=True, ge=0, le=1_000_000)


class BatchInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    day: date
    seat_ids: list[str] = Field(min_length=1, max_length=387)
    request_id: UUID
    period: Literal["full", "morning", "evening"] = "full"
    adult_confirmed: StrictBool = False
    expected_price_uah: int | None = Field(default=None, strict=True, ge=0, le=1_000_000)


@router.post("/batch", status_code=201)
def reserve_batch(body: BatchInput, user_id: int = Depends(telegram_user), database: BookingStore = Depends(store)):
    try:
        records = database.reserve_batch(user_id, body.day, body.seat_ids, str(body.request_id), body.period, body.adult_confirmed, body.expected_price_uah)
        return {"bookings": records, "request_id": str(body.request_id), "total_uah": sum(record["price_uah"] or 0 for record in records)}
    except InvalidBooking as error:
        raise HTTPException(422, str(error)) from None
    except PriceChanged as error:
        raise HTTPException(409, {"code": "price_changed", "price_uah": error.price_uah}) from None
    except BatchConflict as error:
        raise HTTPException(409, {"code": error.code, "seat_ids": error.seat_ids}) from None
    except SeatTaken:
        raise HTTPException(409, "seat_unavailable") from None


@router.get("/mine")
def mine(user_id: int = Depends(telegram_user), database: BookingStore = Depends(store)):
    return {"bookings": database.for_user(user_id)}


@router.post("", status_code=201)
def reserve(body: BookingInput, user_id: int = Depends(telegram_user), database: BookingStore = Depends(store)):
    try:
        return database.reserve(user_id, body.day, body.seat_id, str(body.request_id), body.period, body.adult_confirmed, body.expected_price_uah)
    except InvalidBooking as error:
        raise HTTPException(409 if str(error) == "seat_disabled" else 422, str(error)) from None
    except PriceChanged as error:
        raise HTTPException(409, {"code": "price_changed", "price_uah": error.price_uah}) from None
    except SeatTaken:
        raise HTTPException(409, "seat_unavailable") from None
