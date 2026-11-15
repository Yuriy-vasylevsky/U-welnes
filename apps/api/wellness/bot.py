import asyncio
import logging
from pathlib import Path

from aiogram import Bot, Dispatcher, F, Router
from aiogram.enums import ChatType
from aiogram.filters import Command, CommandStart
from aiogram.types import (
    BotCommand, CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup,
    MenuButtonWebApp, Message, WebAppInfo, FSInputFile,
)

from .config import Settings
from .booking_display import format_bookings

BOOK = "Забронювати"
BOOKINGS = "Мої бронювання"
INFO = "Інформація"
WELCOME_PHOTO = Path(__file__).parent / "media" / "welcome.png"
WELCOME_CAPTION = (
    "☀️ <b>Вітаємо в U-Wellness Space!</b>\n\n"
    "💦 Ваш день біля басейну починається тут — обирайте зручне місце та плануйте відпочинок.\n\n"
    "🗓 <b>Забронювати</b> — оберіть дату й один або кілька шезлонгів на карті.\n"
    "🎟 <b>Мої бронювання</b> — усі ваші заплановані відвідування.\n"
    "🌿 <b>Інформація</b> — більше про наш простір.\n\n"
    "🕒 Обирайте повний день або пів дня — тариф залежить від дати та часу.\n"
    "🔞 У середу весь день і в суботу ввечері — відпочинок 18+.\n\n"
    "👇 Натисніть «Забронювати» та оберіть своє місце для відпочинку!"
)


def booking_url(url: str) -> str:
    return url.rstrip("/") + "/book"


def main_keyboard(url: str, is_admin: bool = False) -> InlineKeyboardMarkup:
    # Inline Web App launch provides signed initData for API authentication.
    # Reply-keyboard Web Apps may have empty initData and cannot identify users.
    rows = [
        [InlineKeyboardButton(text=BOOK, web_app=WebAppInfo(url=booking_url(url)))],
        [InlineKeyboardButton(text=BOOKINGS, callback_data="bookings"),
         InlineKeyboardButton(text=INFO, callback_data="info")],
    ]
    if is_admin:
        rows.append([InlineKeyboardButton(text="Адмінпанель", web_app=WebAppInfo(url=url.rstrip("/") + "/admin"))])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def launch_keyboard(url: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text=BOOK, web_app=WebAppInfo(url=booking_url(url)))
    ]])


def bot_commands() -> list[BotCommand]:
    return [
        BotCommand(command="start", description="Головне меню"),
        BotCommand(command="book", description=BOOK),
        BotCommand(command="bookings", description=BOOKINGS),
        BotCommand(command="info", description=INFO),
        BotCommand(command="help", description="Допомога"),
    ]


def create_router(settings: Settings) -> Router:
    router = Router()

    @router.message(CommandStart())
    async def start(message: Message) -> None:
        if message.chat.type != ChatType.PRIVATE:
            await message.answer("Відкрийте приватний чат із ботом, щоб переглянути карту басейну.")
            return
        await message.answer_photo(
            photo=FSInputFile(WELCOME_PHOTO),
            caption=WELCOME_CAPTION,
            parse_mode="HTML",
            reply_markup=main_keyboard(settings.webapp_url, bool(message.from_user and message.from_user.id in settings.admin_telegram_ids)),
        )

    @router.message(F.chat.type == ChatType.PRIVATE, Command("book"))
    @router.message(F.chat.type == ChatType.PRIVATE, F.text == BOOK)
    async def book(message: Message) -> None:
        await message.answer(
            "🗓 Оберіть дату, час відвідування та вільні шезлонги на карті.\n"
            "💰 Ціну за місце й загальну суму побачите перед підтвердженням. Онлайн-оплата ще не підключена.",
            reply_markup=launch_keyboard(settings.webapp_url),
        )

    @router.message(F.chat.type == ChatType.PRIVATE, Command("bookings"))
    @router.message(F.chat.type == ChatType.PRIVATE, F.text == BOOKINGS)
    async def bookings(message: Message) -> None:
        if message.from_user:
            await send_bookings(message, message.from_user.id)

    async def send_bookings(message: Message, user_id: int) -> None:
        from .booking_store import BookingStore
        if not settings.database_url.get_secret_value():
            await message.answer("Перегляд бронювань тимчасово недоступний. Спробуйте пізніше.")
            return
        try:
            def load():
                store = BookingStore(settings.database_url.get_secret_value())
                try:
                    return store.for_user(user_id)
                finally:
                    store.close()
            items = await asyncio.to_thread(load)
        except Exception:
            logging.getLogger(__name__).warning("Could not load bookings")
            await message.answer("Не вдалося завантажити бронювання. Спробуйте пізніше.")
            return
        for text in format_bookings(items):
            await message.answer(text, parse_mode="HTML", reply_markup=main_keyboard(
                settings.webapp_url, user_id in settings.admin_telegram_ids,
            ))

    @router.message(F.chat.type == ChatType.PRIVATE, Command("info"))
    @router.message(F.chat.type == ChatType.PRIVATE, F.text == INFO)
    async def info(message: Message) -> None:
        from .tariffs import tariff_summary
        overrides = None
        if settings.database_url.get_secret_value():
            def load_tariffs():
                from .booking_store import BookingStore
                database = BookingStore(settings.database_url.get_secret_value())
                try:
                    return database.tariff_overrides()
                finally:
                    database.close()
            try:
                overrides = await asyncio.to_thread(load_tariffs)
            except Exception:
                await message.answer("🌿 U-Wellness Space\n\nНе вдалося отримати актуальні тарифи. Спробуйте пізніше.", reply_markup=main_keyboard(settings.webapp_url))
                return
        await message.answer(
            "🌿 U-Wellness Space\n\n" + tariff_summary(overrides) +
            "\n\nЦіни за один шезлонг. Онлайн-оплата ще не підключена.\n"
            "Для бронювання відкрийте карту через кнопку нижче.",
            reply_markup=main_keyboard(settings.webapp_url),
        )

    @router.callback_query(F.data == "bookings")
    async def bookings_callback(query: CallbackQuery) -> None:
        await query.answer()
        if isinstance(query.message, Message) and query.message.chat.type == ChatType.PRIVATE:
            await send_bookings(query.message, query.from_user.id)

    @router.callback_query(F.data == "info")
    async def info_callback(query: CallbackQuery) -> None:
        await query.answer()
        if isinstance(query.message, Message) and query.message.chat.type == ChatType.PRIVATE:
            await info(query.message)

    @router.message(Command("help"))
    async def help_message(message: Message) -> None:
        await message.answer(
            "Надішліть /start у приватному чаті, щоб відкрити головне меню.\n"
            "«Забронювати» відкриває карту; «Мої бронювання» показує ваші записи.\n"
            "Масштабуйте карту двома пальцями або кнопками та натисніть на шезлонг.",
            reply_markup=main_keyboard(settings.webapp_url) if message.chat.type == ChatType.PRIVATE else None,
        )

    @router.message(F.chat.type == ChatType.PRIVATE, Command("admin"))
    async def admin_panel(message: Message) -> None:
        if not message.from_user or message.from_user.id not in settings.admin_telegram_ids:
            await message.answer("Доступ лише для адміністратора.")
            return
        keyboard = InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(text="Відкрити адмінпанель", web_app=WebAppInfo(url=settings.webapp_url.rstrip("/") + "/admin"))
        ]])
        await message.answer("🛠 Меню адміністратора: карта й доступність місць або редагування цін.", reply_markup=keyboard)

    return router


async def run(settings: Settings) -> None:
    settings.validate_bot()
    async with Bot(settings.bot_token.get_secret_value()) as bot:
        dispatcher = Dispatcher()
        dispatcher.include_router(create_router(settings))
        if (await bot.get_webhook_info()).url:
            raise ValueError("A webhook is configured. Remove it explicitly before using polling.")
        await bot.set_my_commands(bot_commands())
        await bot.set_chat_menu_button(menu_button=MenuButtonWebApp(
            text=BOOK, web_app=WebAppInfo(url=booking_url(settings.webapp_url))
        ))
        await dispatcher.start_polling(bot, allowed_updates=dispatcher.resolve_used_update_types())


def main() -> None:
    settings = Settings()
    try:
        settings.validate_bot()
    except ValueError as exc:
        raise SystemExit(f"Bot startup error: {exc}") from None
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run(settings))


if __name__ == "__main__":
    main()
