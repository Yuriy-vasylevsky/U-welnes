import asyncio
import logging

from aiogram import Bot, Dispatcher, F, Router
from aiogram.enums import ChatType
from aiogram.filters import Command, CommandStart
from aiogram.types import (
    BotCommand, CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup,
    MenuButtonWebApp, Message, WebAppInfo,
)

from .config import Settings

BOOK = "Забронювати"
BOOKINGS = "Мої бронювання"
INFO = "Інформація"


def booking_url(url: str) -> str:
    return url.rstrip("/") + "/book"


def main_keyboard(url: str) -> InlineKeyboardMarkup:
    # Inline Web App launch provides signed initData for API authentication.
    # Reply-keyboard Web Apps may have empty initData and cannot identify users.
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=BOOK, web_app=WebAppInfo(url=booking_url(url)))],
        [InlineKeyboardButton(text=BOOKINGS, callback_data="bookings"),
         InlineKeyboardButton(text=INFO, callback_data="info")],
    ])


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
        await message.answer(
            "Вітаємо в U-Wellness Space!\n\n"
            "«Забронювати» — обрати дату й шезлонг на карті.\n"
            "«Мої бронювання» — переглянути свої записи.\n"
            "«Інформація» — дізнатися про простір.",
            reply_markup=main_keyboard(settings.webapp_url),
        )

    @router.message(F.chat.type == ChatType.PRIVATE, Command("book"))
    @router.message(F.chat.type == ChatType.PRIVATE, F.text == BOOK)
    async def book(message: Message) -> None:
        await message.answer(
            "Оберіть дату та вільний шезлонг на карті. Бронювання — на цілий день.\n"
            "Онлайн-оплата поки не підключена; тарифи й умови уточнюються.",
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
        if not items:
            await message.answer("У вас поки немає бронювань.", reply_markup=main_keyboard(settings.webapp_url))
            return
        # Keep messages below Telegram's limit without dropping any records.
        for offset in range(0, len(items), 25):
            lines = ["Мої бронювання", ""]
            for item in items[offset:offset + 25]:
                lines.append(f"{item['day']} · шезлонг {item['seat_id']} · на цілий день")
                lines.append(f"Номер: {item['id']}")
            await message.answer("\n".join(lines), reply_markup=main_keyboard(settings.webapp_url))

    @router.message(F.chat.type == ChatType.PRIVATE, Command("info"))
    @router.message(F.chat.type == ChatType.PRIVATE, F.text == INFO)
    async def info(message: Message) -> None:
        await message.answer(
            "U-Wellness Space\n\n"
            "У Mini App можна переглянути карту басейну й обрати шезлонг на цілий день.\n"
            "Для бронювання відкрийте Mini App через цього бота.\n\n"
            "Онлайн-оплата ще не підключена. Тарифи, розклад і правила скасування уточнюються.",
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
