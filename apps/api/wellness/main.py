from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
from sqlalchemy.exc import SQLAlchemyError
from .booking_store import BookingStore
from .config import Settings
from .routers.v1 import router

def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    @asynccontextmanager
    async def lifespan(app):
        database = None
        if settings.database_url.get_secret_value():
            database = BookingStore(settings.database_url.get_secret_value())
            database.initialize()
        app.state.booking_store = database
        try:
            yield
        finally:
            if database:
                database.close()

    app = FastAPI(title="U-Wellness Space", version="0.2.0", lifespan=lifespan)
    app.state.settings = settings

    @app.middleware("http")
    async def no_booking_cache(request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(SQLAlchemyError)
    async def database_error(request, error):
        return JSONResponse(status_code=503, content={"detail": "booking_unavailable"})
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins,
                       allow_credentials=False, allow_methods=["GET", "POST", "PUT"], allow_headers=["Content-Type", "Authorization"])
    @app.get("/health", tags=["health"])
    def health() -> dict[str, str]:
        database = getattr(app.state, "booking_store", None)
        if database:
            with database.engine.connect() as connection:
                connection.exec_driver_sql("SELECT 1")
        return {"status": "ok"}
    app.include_router(router)
    return app

app = create_app()
