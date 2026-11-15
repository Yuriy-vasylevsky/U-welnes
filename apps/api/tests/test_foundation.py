import asyncio
import hashlib
import hmac
from urllib.parse import urlencode
from unittest.mock import AsyncMock
import pytest
from aiogram import Bot, Dispatcher
from aiogram.types import Update
from fastapi.testclient import TestClient
from wellness.config import Settings
from wellness.main import create_app
from wellness.bot import create_router, launch_keyboard
from wellness.telegram_auth import validate_init_data

TOKEN = "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijk"
def settings(**kwargs):
    return Settings(_env_file=None, **kwargs)

def test_health_and_cors():
    client = TestClient(create_app(settings()))
    assert client.get("/health").json() == {"status": "ok"}
    response = client.get("/health", headers={"Origin": "http://localhost:3000"})
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert "access-control-allow-origin" not in client.get("/health", headers={"Origin": "https://untrusted.example"}).headers
    assert client.get("/api/v1/bookings/mine").status_code == 401

@pytest.mark.parametrize("values,match", [({"bot_token":""}, "BOT_TOKEN is required"), ({"bot_token":"bad"}, "invalid format"), ({"bot_token":TOKEN,"webapp_url":"http://localhost:3000"},"HTTPS")])
def test_bot_configuration(values, match):
    with pytest.raises(ValueError, match=match):
        settings(**values).validate_bot()

def test_keyboard():
    config = settings(bot_token=TOKEN, webapp_url="https://pool.example")
    config.validate_bot()
    button = launch_keyboard(config.webapp_url).inline_keyboard[0][0]
    assert button.text == "Забронювати"
    assert button.web_app.url == config.webapp_url + "/book"

def test_bot_commands_without_network():
    async def scenario():
        dispatcher = Dispatcher()
        dispatcher.include_router(create_router(settings(webapp_url="https://pool.example")))
        bot = Bot(TOKEN)
        try:
            for command in ("/start", "/help"):
                message = {"message_id":1,"date":1700000000,"chat":{"id":123,"type":"private"},"from":{"id":123,"is_bot":False,"first_name":"Test"},"text":command,"entities":[{"type":"bot_command","offset":0,"length":len(command)}]}
                update = Update.model_validate({"update_id":1,"message":message})
                bot.session.make_request = AsyncMock()
                await dispatcher.feed_update(bot, update)
                method = bot.session.make_request.call_args.args[1]
                if command == "/start":
                    from aiogram.methods import SendPhoto
                    from wellness.bot import WELCOME_PHOTO, WELCOME_CAPTION
                    assert isinstance(method, SendPhoto)
                    assert WELCOME_PHOTO.is_file()
                    assert method.caption == WELCOME_CAPTION
                    assert method.parse_mode == "HTML"
                    assert len(method.caption) < 1024
                    assert method.reply_markup.inline_keyboard[0][0].web_app.url == "https://pool.example/book"
                else:
                    assert "/start" in method.text
        finally:
            await bot.session.close()
    asyncio.run(scenario())

def signed(**changes):
    data = {"auth_date":"1000", "user":'{"id":123}', **changes}
    secret = hmac.new(b"WebAppData", TOKEN.encode(), hashlib.sha256).digest()
    signature = hmac.new(secret, "\n".join(f"{k}={v}" for k,v in sorted(data.items())).encode(), hashlib.sha256).hexdigest()
    return urlencode({**data,"hash":signature})

def test_init_data():
    assert validate_init_data(signed(), TOKEN, now=1001)["user"] == '{"id":123}'
    for raw,now in [(signed()+"&user=duplicate",1001),(signed().replace("123","456"),1001),(signed(),5000),(signed(auth_date="2000"),1000),("",1000)]:
        with pytest.raises(ValueError):
            validate_init_data(raw,TOKEN,now=now)
