"""Telegram booking cards; expired days stay in storage, not in the display."""
from collections import defaultdict
from datetime import date, timedelta
from html import escape
from .booking_store import today_kyiv


def units(text: str) -> int:
    return len(text.encode("utf-16-le")) // 2


def format_bookings(items: list[dict], today: date | None = None) -> list[str]:
    today = today or today_kyiv()
    groups = defaultdict(list)
    for item in items:
        day = date.fromisoformat(item["day"])
        if day < today:
            continue
        # Future visit periods can provide this label without changing the card.
        visit = str(item.get("visit_time") or "Цілий день")[:80]
        groups[(day, visit)].append(item)
    title = "🎟 <b>Мої бронювання</b>"
    cards = []
    for (day, visit), records in sorted(groups.items()):
        suffix = " · Сьогодні" if day == today else " · Завтра" if day == today + timedelta(days=1) else ""
        short_date = day.strftime("%d.%m") if day.year == today.year else day.strftime("%d.%m.%y")
        labels = []
        for record in sorted(records, key=lambda item: (item.get("seat_number") is None, item.get("seat_number") or 0, item["seat_id"])):
            number = record.get("seat_number")
            label = f"№ {number}" if number is not None else record["seat_id"]
            labels.append(escape(str(label)))
        # A date can have hundreds of places; split labels without losing any.
        chunks, chunk = [], []
        for label in labels:
            if chunk and units(", ".join([*chunk, label])) > 2200:
                chunks.append(chunk); chunk = []
            chunk.append(label)
        if chunk:
            chunks.append(chunk)
        for chunk in chunks:
            noun = "Шезлонг" if len(chunk) == 1 else "Шезлонги"
            summary = ""
            if chunk is chunks[0]:
                if all(record.get("price_uah") is not None for record in records):
                    total = sum(record["price_uah"] for record in records)
                    summary += f"\n💰 <b>{total:,} грн</b> за {len(records)} місць".replace(",", " ")
                if any(record.get("adults_only") for record in records):
                    summary += "\n🔞 <b>Лише для гостей 18+</b>"
            cards.append(
                f"📅 <b>{short_date}</b>{suffix}\n"
                f"🛏 {noun}: <b>{', '.join(chunk)}</b>\n"
                f"🕒 <b>{escape(visit)}</b>{summary}"
            )
    if not cards:
        return ["🗓 <b>Немає актуальних бронювань</b>\n\nОберіть день і вільні місця через «Забронювати»."]
    messages, message = [], title
    for card in cards:
        if units(message + "\n\n" + card) > 3500:
            messages.append(message); message = title
        message += "\n\n" + card
    messages.append(message)
    return messages
