"""Authoritative per-seat UAH tariffs by local visit date and period."""
from datetime import date, datetime, time
from zoneinfo import ZoneInfo

PERIODS = {
    "full": ("Повний день", "08:00–21:00"),
    "morning": ("Ранок", "08:00–13:00"),
    "evening": ("Вечір", "14:00–21:00"),
}


def has_ended(day: date, period: str) -> bool:
    end = time(13) if period == "morning" else time(21)
    return datetime.combine(day, end, ZoneInfo("Europe/Kyiv")) <= datetime.now(ZoneInfo("Europe/Kyiv"))


def tariffs_for(day: date, overrides: dict[str, int] | None = None) -> list[dict]:
    weekday = day.weekday()
    if weekday in (0, 1, 3):
        prices = {"full": 900, "morning": 600, "evening": 600}
    elif weekday in (4, 6):
        prices = {"full": 1350, "morning": 1100, "evening": 1100}
    elif weekday == 2:
        prices = {"full": 1500, "morning": 900, "evening": 900}
    else:
        prices = {"morning": 1100, "evening": 1950}
    if overrides:
        prices = {period: overrides.get(period, price) for period, price in prices.items()}
    return [dict(id=period, label=PERIODS[period][0], visit_time=PERIODS[period][1],
                 price_uah=price, adults_only=weekday == 2 or (weekday == 5 and period == "evening"), ended=has_ended(day, period))
            for period, price in prices.items()]


def tariff_for(day: date, period: str) -> dict:
    for tariff in tariffs_for(day):
        if tariff["id"] == period:
            return tariff
    raise ValueError("invalid_period")


def tariff_summary(overrides: dict[int, dict[str, int]] | None = None) -> str:
    from datetime import timedelta
    monday = date(2026, 1, 5)
    names = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"]
    lines = ["💰 Тарифи за відвідування"]
    for offset, name in enumerate(names):
        lines.append("\n📅 " + name)
        for tariff in tariffs_for(monday + timedelta(days=offset), (overrides or {}).get(offset)):
            lines.append(f"{tariff['label']} {tariff['visit_time']} — {tariff['price_uah']} грн" + (" · 18+" if tariff["adults_only"] else ""))
    return "\n".join(lines)
