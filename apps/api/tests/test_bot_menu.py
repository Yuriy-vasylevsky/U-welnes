import asyncio
from unittest.mock import AsyncMock, patch

from aiogram import Bot, Dispatcher
from aiogram.types import Update
from wellness.bot import BOOK, BOOKINGS, INFO, create_router, main_keyboard
from wellness.config import Settings
from wellness.booking_store import today_kyiv

TOKEN = "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijk"


def test_three_inline_buttons():
    keyboard = main_keyboard("https://uwelnes.site/")
    assert [button.text for row in keyboard.inline_keyboard for button in row] == [BOOK, BOOKINGS, INFO]
    assert keyboard.inline_keyboard[0][0].web_app.url == "https://uwelnes.site/book"
    assert keyboard.inline_keyboard[1][0].callback_data == "bookings"
    assert keyboard.inline_keyboard[1][1].callback_data == "info"


def test_menu_text_commands_and_actual_bookings():
    async def scenario():
        dispatcher = Dispatcher()
        dispatcher.include_router(create_router(Settings(_env_file=None, webapp_url="https://uwelnes.site", database_url="sqlite://")))
        bot = Bot(TOKEN)
        try:
            for text in [INFO, "/info", BOOK, "/book", BOOKINGS, "/bookings"]:
                message = {"message_id":1,"date":1700000000,"chat":{"id":123,"type":"private"},"from":{"id":123,"is_bot":False,"first_name":"Test"},"text":text}
                if text.startswith("/"):
                    message["entities"]=[{"type":"bot_command","offset":0,"length":len(text)}]
                update=Update.model_validate({"update_id":1,"message":message})
                bot.session.make_request=AsyncMock()
                with patch("wellness.booking_store.BookingStore") as store:
                    store.return_value.for_user.return_value=[{"id":"test-booking","seat_id":"S001","day":today_kyiv().isoformat()}]
                    await dispatcher.feed_update(bot,update)
                    method=bot.session.make_request.call_args.args[1]
                    if text in [BOOKINGS,"/bookings"]:
                        store.return_value.for_user.assert_called_once_with(123)
                        assert "S001" in method.text and "test-booking" not in method.text
                        assert method.parse_mode == "HTML"
                    elif text in [BOOK,"/book"]:
                        assert method.reply_markup.inline_keyboard[0][0].web_app.url.endswith("/book")
                    else:
                        assert "U-Wellness Space" in method.text
            # Callback messages are authored by the bot; ownership must come
            # from the person who clicked, not from message.from_user.
            callback = Update.model_validate({"update_id":2,"callback_query":{
                "id":"callback-1", "chat_instance":"private-chat", "data":"bookings",
                "from":{"id":456,"is_bot":False,"first_name":"Owner"},
                "message":{"message_id":1,"date":1700000000,"chat":{"id":456,"type":"private"},
                           "from":{"id":123456789,"is_bot":True,"first_name":"Bot"},"text":"Menu"},
            }})
            bot.session.make_request = AsyncMock()
            with patch("wellness.booking_store.BookingStore") as store:
                store.return_value.for_user.return_value=[]
                await dispatcher.feed_update(bot, callback)
                store.return_value.for_user.assert_called_once_with(456)
                assert bot.session.make_request.call_count == 2
        finally:
            await bot.session.close()
    asyncio.run(scenario())
