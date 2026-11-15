from fastapi import APIRouter

router = APIRouter(prefix="/api/v1")
# Versioned pool availability and authenticated booking routes.
from . import bookings, users, pool, admin
for resource in (bookings, users, pool, admin):
    router.include_router(resource.router)
