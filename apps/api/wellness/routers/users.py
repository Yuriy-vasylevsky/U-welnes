"""Future users integration. No endpoints or persistence yet."""
from fastapi import APIRouter
router = APIRouter(prefix="/users", tags=["users"])
