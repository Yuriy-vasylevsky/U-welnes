"use client";
import { useEffect, useRef, useState } from "react";
import { PoolMap } from "./pool-map";
import catalog from "../data/seats.json";

type Reservation = {
  id: string;
  seat_id: string;
  day: string;
  created_at: string;
};
type Availability = { reserved: string[]; today: string; map_version: string };
function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
const messages: Record<string, string> = {
  telegram_required:
    "Відкрийте Mini App через бота Telegram, щоб зберегти бронювання.",
  invalid_telegram_data:
    "Сесія Telegram завершилась. Закрийте Mini App і відкрийте її знову через бота.",
  seat_unavailable: "Це місце вже заброньоване. Оберіть інший шезлонг.",
  past_date: "Оберіть сьогоднішню або майбутню дату.",
  booking_unavailable: "Бронювання тимчасово недоступне. Спробуйте пізніше.",
};

export function Booking() {
  const [day, setDay] = useState("");
  const [minimum, setMinimum] = useState("");
  const [reserved, setReserved] = useState<string[]>([]);
  const [selected, setSelected] = useState("");
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [initData, setInitData] = useState("");
  const [success, setSuccess] = useState<Reservation | null>(null);
  const [mine, setMine] = useState<Reservation[]>([]);
  const [mineError, setMineError] = useState("");
  const request = useRef<{ key: string; id: string } | null>(null);

  useEffect(() => {
    const value = today();
    setDay(value);
    setMinimum(value);
    setInitData(window.Telegram?.WebApp?.initData || "");
  }, []);

  async function refreshMine(raw: string) {
    if (!raw) return;
    try {
      const response = await fetch("/api/v1/bookings/mine", {
        headers: { Authorization: `tma ${raw}` },
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          messages[data.detail] || "Не вдалося завантажити ваші бронювання.",
        );
      setMine(data.bookings);
      setMineError("");
    } catch (error) {
      setMineError(
        error instanceof Error
          ? error.message
          : "Не вдалося завантажити бронювання.",
      );
    }
  }
  useEffect(() => {
    if (initData) void refreshMine(initData);
  }, [initData]);

  useEffect(() => {
    if (!day) return;
    const controller = new AbortController();
    setSelected("");
    setSuccess(null);
    setAvailable(false);
    setLoading(true);
    setError("");
    async function load() {
      try {
        const response = await fetch(
          `/api/v1/pool/availability?day=${encodeURIComponent(day)}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!response.ok)
          throw new Error(
            "Не вдалося отримати доступність місць. Повторюємо перевірку автоматично.",
          );
        const data: Availability = await response.json();
        if (data.map_version !== catalog.source_sha256)
          throw new Error(
            "Карту оновлено. Закрийте Mini App і відкрийте знову.",
          );
        if (!controller.signal.aborted) {
          setReserved(data.reserved);
          setMinimum(data.today);
          setAvailable(true);
          setError("");
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setAvailable(false);
          setError(error instanceof Error ? error.message : "Помилка мережі.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [day]);

  async function submit() {
    if (
      !selected ||
      !initData ||
      saving ||
      !available ||
      reserved.includes(selected)
    )
      return;
    setSaving(true);
    setError("");
    const key = `${day}/${selected}`;
    if (request.current?.key !== key)
      request.current = { key, id: crypto.randomUUID() };
    try {
      const response = await fetch("/api/v1/bookings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `tma ${initData}`,
        },
        body: JSON.stringify({
          day,
          seat_id: selected,
          request_id: request.current.id,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409)
          setReserved((values) => [...new Set([...values, selected])]);
        throw new Error(
          messages[data.detail] ||
            "Не вдалося зберегти бронювання. Спробуйте ще раз.",
        );
      }
      setSuccess(data);
      setReserved((values) => [...new Set([...values, selected])]);
      setSelected("");
      await refreshMine(initData);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Помилка мережі. Спробуйте ще раз.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="booking-page">
      <p className="eyebrow">U-WELLNESS / БРОНЮВАННЯ</p>
      <h1>Ваш день біля басейну</h1>
      <p className="booking-note">
        Оберіть дату та шезлонг на цілий день. Онлайн-оплата поки не підключена;
        тарифи й умови уточнюються.
      </p>
      <div className="booking-toolbar">
        <label>
          Дата відвідування
          <input
            aria-label="Дата відвідування"
            type="date"
            value={day}
            min={minimum}
            disabled={saving}
            onChange={(event) => {
              if (event.target.value) setDay(event.target.value);
            }}
          />
        </label>
        <span>
          {loading
            ? "Перевіряємо місця…"
            : available
              ? `Вільно ${catalog.seats.length - reserved.length} із ${catalog.seats.length}`
              : "Доступність не визначена"}
        </span>
      </div>
      {!initData && (
        <p className="booking-notice">
          Перегляд карти доступний у браузері. Для бронювання{" "}
          <a href="https://t.me/u_welnes_bot">
            відкрийте нашого бота в Telegram
          </a>{" "}
          та натисніть «Забронювати».
        </p>
      )}
      {error && (
        <p className="booking-error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <div className="booking-success" role="status">
          Бронювання збережено: шезлонг {success.seat_id}, {success.day}, на
          цілий день.
          <br />
          Номер: {success.id}
          <br />
          Онлайн-оплата не проводилась.
        </div>
      )}
      <div className="booking-legend">
        <span>○ Вільне</span>
        <span className="taken-key">● Зайняте</span>
        <span className="selected-key">● Обране</span>
      </div>
      <PoolMap
        selectable={available && !saving}
        reserved={reserved}
        selected={selected}
        onSelect={(id) => {
          setSelected(id);
          setSuccess(null);
          setError("");
        }}
      />
      <div className="booking-confirm">
        <label>
          Шезлонг
          <select
            aria-label="Шезлонг"
            value={selected}
            disabled={!available || saving}
            onChange={(event) => {
              setSelected(event.target.value);
              setSuccess(null);
            }}
          >
            <option value="">Оберіть на карті або зі списку</option>
            {catalog.seats.map((seat) => (
              <option
                key={seat.id}
                value={seat.id}
                disabled={reserved.includes(seat.id)}
              >
                {seat.id}
                {reserved.includes(seat.id) ? " — зайнято" : ""}
              </option>
            ))}
          </select>
        </label>
        {selected && (
          <p>
            Шезлонг <strong>{selected}</strong> · {day} · на цілий день
          </p>
        )}
        <button
          className="gold-button"
          disabled={
            !selected ||
            !initData ||
            saving ||
            !available ||
            reserved.includes(selected) ||
            day < minimum
          }
          onClick={submit}
        >
          {saving ? "Зберігаємо…" : "Підтвердити бронювання"}
        </button>
      </div>
      {initData && (
        <section className="my-bookings">
          <h2>Мої бронювання</h2>
          {mineError ? (
            <p role="alert">{mineError}</p>
          ) : mine.length ? (
            <ul>
              {mine.map((item) => (
                <li key={item.id}>
                  {item.day} · шезлонг {item.seat_id} · на цілий день
                  <small>№ {item.id}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p>У вас поки немає бронювань.</p>
          )}
          <button className="text-button" onClick={() => refreshMine(initData)}>
            Оновити список
          </button>
        </section>
      )}
    </div>
  );
}
