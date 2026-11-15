from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from typing import Literal
from ..tariffs import tariffs_for
from ..booking_store import BookingStore, CATALOG, today_kyiv
from .bookings import store

router = APIRouter(prefix="/pool", tags=["pool"])


@router.get("/availability")
def availability(day: date, period: Literal["full", "morning", "evening"] | None = None, database: BookingStore = Depends(store)):
    tariffs = database.tariffs_for(day)
    period = period or tariffs[0]["id"]
    if period not in {tariff["id"] for tariff in tariffs}:
        raise HTTPException(422, "invalid_period")
    return {"day": day.isoformat(), "today": today_kyiv().isoformat(),
            "period": period, "tariffs": tariffs, "currency": "UAH",
            "reserved": database.availability(day, period), "seat_count": len(CATALOG["seats"]),
            "map_version": CATALOG["source_sha256"], "numbers": database.seat_numbers(), "enabled": database.seat_enabled()}


@router.get("/seats")
def seat_catalog(database: BookingStore = Depends(store)):
    return {"numbers": database.seat_numbers(), "enabled": database.seat_enabled(), "map_version": CATALOG["source_sha256"]}
