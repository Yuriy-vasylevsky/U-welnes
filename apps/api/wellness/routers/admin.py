from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, StrictBool
from typing import Literal
from ..booking_store import BookingStore, InvalidBooking, NumberConflict, SeatChanged, PriceChanged, CATALOG
from .bookings import store, telegram_user

router = APIRouter(prefix="/admin", tags=["admin"])


def admin_user(request: Request, user_id: int = Depends(telegram_user)) -> int:
    if user_id not in request.app.state.settings.admin_telegram_ids:
        raise HTTPException(403, "admin_required")
    return user_id


class SeatNumberInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    number: int = Field(strict=True, ge=1, le=9999)
    expected_number: int | None = Field(strict=True, ge=1, le=9999)


class TariffInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    price_uah: int = Field(strict=True, ge=0, le=1_000_000)
    expected_price_uah: int = Field(strict=True, ge=0, le=1_000_000)


@router.get("/tariffs")
def list_tariffs(admin: int = Depends(admin_user), database: BookingStore = Depends(store)):
    return {"tariffs": database.admin_tariffs(), "currency": "UAH"}


@router.put("/tariffs/{weekday}/{period}")
def edit_tariff(weekday: int, period: Literal["full", "morning", "evening"], body: TariffInput, admin: int = Depends(admin_user), database: BookingStore = Depends(store)):
    try:
        return database.set_tariff(weekday, period, body.price_uah, body.expected_price_uah, admin)
    except InvalidBooking:
        raise HTTPException(404, "invalid_tariff") from None
    except PriceChanged as error:
        raise HTTPException(409, {"code": "price_changed", "price_uah": error.price_uah}) from None


class ClearNumbersInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirmation: Literal["CLEAR_ALL_NUMBERS"]


class AvailabilityInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool = Field(strict=True)
    expected_enabled: bool = Field(strict=True)


class BulkAvailabilityInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool = Field(strict=True)
    expected_enabled: dict[str, StrictBool] = Field(min_length=1, max_length=387)


@router.put("/seats/availability/batch")
def set_bulk_availability(body: BulkAvailabilityInput, admin: int = Depends(admin_user), database: BookingStore = Depends(store)):
    try:
        return database.set_seats_enabled(body.expected_enabled, body.enabled, admin)
    except InvalidBooking:
        raise HTTPException(404, "unknown_seat") from None
    except SeatChanged:
        raise HTTPException(409, "availability_changed") from None


@router.put("/seats/{seat_id}/availability")
def set_availability(seat_id: str, body: AvailabilityInput, admin: int = Depends(admin_user), database: BookingStore = Depends(store)):
    try:
        return database.set_seat_enabled(seat_id, body.enabled, body.expected_enabled, admin)
    except InvalidBooking:
        raise HTTPException(404, "unknown_seat") from None
    except SeatChanged:
        raise HTTPException(409, "availability_changed") from None


@router.post("/seats/clear-numbers")
def clear_numbers(body: ClearNumbersInput, admin: int = Depends(admin_user), database: BookingStore = Depends(store)):
    return {"cleared": database.clear_seat_numbers(admin), "numbers": database.seat_numbers()}


@router.get("/seats")
def list_seats(admin: int = Depends(admin_user), database: BookingStore = Depends(store)):
    return {"numbers": database.seat_numbers(), "enabled": database.seat_enabled(), "map_version": CATALOG["source_sha256"]}


@router.put("/seats/{seat_id}")
def rename(seat_id: str, body: SeatNumberInput, admin: int = Depends(admin_user), database: BookingStore = Depends(store)):
    try:
        return database.rename_seat(seat_id, body.number, body.expected_number, admin)
    except InvalidBooking:
        raise HTTPException(404, "unknown_seat") from None
    except NumberConflict:
        raise HTTPException(409, "number_in_use") from None
    except SeatChanged:
        raise HTTPException(409, "seat_changed") from None
