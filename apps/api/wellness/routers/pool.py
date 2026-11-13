from datetime import date
from fastapi import APIRouter, Depends
from ..booking_store import BookingStore, CATALOG, today_kyiv
from .bookings import store

router = APIRouter(prefix="/pool", tags=["pool"])


@router.get("/availability")
def availability(day: date, database: BookingStore = Depends(store)):
    return {"day": day.isoformat(), "today": today_kyiv().isoformat(),
            "reserved": database.availability(day), "seat_count": len(CATALOG["seats"]),
            "map_version": CATALOG["source_sha256"]}
