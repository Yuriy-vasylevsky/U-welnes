import uvicorn
from .config import Settings
if __name__ == "__main__":
    settings = Settings()
    uvicorn.run("wellness.main:app", host=settings.api_host, port=settings.api_port,
                reload=settings.environment == "development")
