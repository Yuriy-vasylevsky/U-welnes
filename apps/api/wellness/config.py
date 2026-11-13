from pathlib import Path
from urllib.parse import urlparse
from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[3]

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")
    bot_token: SecretStr = SecretStr("")
    webapp_url: str = ""
    api_host: str = "127.0.0.1"
    api_port: int = 8000
    environment: str = "development"
    database_url: SecretStr = SecretStr("")
    cors_origins: list[str] = ["http://localhost:3000"]

    def validate_bot(self) -> None:
        from aiogram.utils.token import validate_token, TokenValidationError
        token = self.bot_token.get_secret_value()
        if not token:
            raise ValueError("BOT_TOKEN is required. Set it in your environment or root .env.")
        try:
            validate_token(token)
        except TokenValidationError:
            raise ValueError("BOT_TOKEN has an invalid format.") from None
        url = urlparse(self.webapp_url)
        if url.scheme != "https" or not url.hostname or url.username or url.password:
            raise ValueError("WEBAPP_URL must be a publicly reachable HTTPS URL.")
