"use client";
import { useEffect, useRef, useState } from "react";
import { PoolMap } from "./pool-map";
import catalog from "../data/seats.json";

type Reservation = {
  id: string;
  seat_id: string;
  seat_number?: number | null;
  day: string;
  created_at: string;
  visit_time?: string;
  price_uah?: number | null;
  adults_only?: boolean;
};
type Period = "full" | "morning" | "evening";
type Tariff = {
  id: Period;
  label: string;
  visit_time: string;
  price_uah: number;
  adults_only: boolean;
  ended: boolean;
};
type Availability = {
  reserved: string[];
  today: string;
  map_version: string;
  numbers?: Record<string, number | null>;
  enabled?: Record<string, boolean>;
  period: Period;
  tariffs: Tariff[];
};
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
  seat_unavailable:
    "Одне з обраних місць вже заброньоване. Нічого не збережено. Приберіть недоступне місце й підтвердьте решту.",
  seat_disabled:
    "Один з обраних шезлонгів закритий для бронювання. Нічого не збережено. Приберіть його з вибору.",
  past_date: "Оберіть сьогоднішню або майбутню дату.",
  past_period: "Цей період уже завершився. Оберіть інший час або дату.",
  invalid_period: "Цей період недоступний у вибрану дату. Оберіть інший.",
  price_changed:
    "Адміністратор оновив ціну. Перевірте нову суму та підтвердьте ще раз.",
  adult_confirmation_required:
    "Підтвердьте, що всім гостям виповнилося 18 років.",
  booking_unavailable: "Бронювання тимчасово недоступне. Спробуйте пізніше.",
};

export function Booking() {
  const [day, setDay] = useState("");
  const [period, setPeriod] = useState<Period | "">("");
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [adultConfirmed, setAdultConfirmed] = useState(false);
  const tariff = tariffs.find((item) => item.id === period);
  const [minimum, setMinimum] = useState("");
  const [reserved, setReserved] = useState<string[]>([]);
  const [numbers, setNumbers] = useState<Record<string, number | null>>({});
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const activeSeats = catalog.seats.filter((seat) => enabled[seat.id] === true);
  const closed = catalog.seats
    .filter((seat) => enabled[seat.id] !== true)
    .map((seat) => seat.id);
  const [selected, setSelected] = useState<string[]>([]);
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [initData, setInitData] = useState("");
  const [success, setSuccess] = useState<Reservation[] | null>(null);
  const resultDialog = useRef<HTMLDialogElement>(null);
  const dateInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const dialog = resultDialog.current;
    if (success && dialog && !dialog.open) dialog.showModal();
    else if (!success && dialog?.open) dialog.close();
  }, [success]);
  const request = useRef<{ key: string; id: string } | null>(null);

  useEffect(() => {
    const value = today();
    setDay(value);
    setMinimum(value);
    setInitData(window.Telegram?.WebApp?.initData || "");
  }, []);

  useEffect(() => {
    if (!day) return;
    const controller = new AbortController();
    setSelected([]);
    setSuccess(null);
    setAvailable(false);
    setLoading(true);
    setError("");
    async function load() {
      try {
        const response = await fetch(
          `/api/v1/pool/availability?day=${encodeURIComponent(day)}${period ? `&period=${period}` : ""}`,
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
          if (
            !Array.isArray(data.tariffs) ||
            !data.tariffs.some((item) => item.id === data.period)
          )
            throw new Error(
              "Не вдалося отримати тарифи. Закрийте Mini App і відкрийте знову.",
            );
          setTariffs(data.tariffs);
          if (!period) {
            const chosen =
              data.tariffs.find((item) => !item.ended)?.id ?? data.period;
            setPeriod(chosen);
            // Availability must be loaded for the chosen period, not an earlier default.
            return;
          }
          setReserved(data.reserved);
          setNumbers(data.numbers ?? {});
          setEnabled(data.enabled ?? {});
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
  }, [day, period]);

  async function submit() {
    if (
      !selected.length ||
      !initData ||
      saving ||
      !available ||
      !tariff ||
      tariff.ended ||
      (tariff.adults_only && !adultConfirmed) ||
      selected.some((id) => reserved.includes(id) || enabled[id] !== true)
    )
      return;
    setSaving(true);
    setError("");
    const key = `${day}/${period}/${selected.slice().sort().join(",")}`;
    if (request.current?.key !== key)
      request.current = { key, id: crypto.randomUUID() };
    try {
      const response = await fetch("/api/v1/bookings/batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `tma ${initData}`,
        },
        body: JSON.stringify({
          day,
          seat_ids: selected,
          request_id: request.current.id,
          period,
          adult_confirmed: adultConfirmed,
          expected_price_uah: tariff.price_uah,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        const code =
          typeof data.detail === "string" ? data.detail : data.detail?.code;
        const blocked: string[] = Array.isArray(data.detail?.seat_ids)
          ? data.detail.seat_ids
          : selected;
        if (
          code === "price_changed" &&
          Number.isInteger(data.detail?.price_uah)
        ) {
          setTariffs((items) =>
            items.map((item) =>
              item.id === period
                ? { ...item, price_uah: data.detail.price_uah }
                : item,
            ),
          );
        }
        if (code === "seat_disabled")
          setEnabled((values) => ({
            ...values,
            ...Object.fromEntries(blocked.map((id) => [id, false])),
          }));
        if (code === "seat_unavailable")
          setReserved((values) => [...new Set([...values, ...blocked])]);
        throw new Error(
          messages[code] || "Не вдалося зберегти бронювання. Спробуйте ще раз.",
        );
      }
      setSuccess(data.bookings);
      setReserved((values) => [...new Set([...values, ...selected])]);
      setSelected([]);
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
    <div className="booking-page map-booking-page">
      <h1 className="visually-hidden">Ваш день біля басейну</h1>
      <div className="booking-toolbar">
        <label>
          <input
            ref={dateInput}
            aria-label="Дата відвідування"
            type="date"
            value={day}
            min={minimum}
            disabled={saving}
            onChange={(event) => {
              if (event.target.value) {
                setAvailable(false);
                setSelected([]);
                setTariffs([]);
                setPeriod("");
                setAdultConfirmed(false);
                setDay(event.target.value);
              }
            }}
          />
        </label>
        <span>
          {loading
            ? "Перевіряємо місця…"
            : available
              ? `Вільно ${activeSeats.filter((seat) => !reserved.includes(seat.id)).length} із ${activeSeats.length}`
              : "Доступність не визначена"}
        </span>
      </div>
      <div className="period-picker" role="group" aria-label="Час відвідування">
        {tariffs.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={period === item.id}
            disabled={saving || item.ended}
            onClick={() => {
              if (period === item.id) return;
              setAvailable(false);
              setSelected([]);
              setAdultConfirmed(false);
              setPeriod(item.id);
            }}
          >
            <span>
              {item.label}
              {item.adults_only ? " · 18+" : ""}
            </span>
            <small>{item.visit_time}</small>
            <strong>{item.price_uah.toLocaleString("uk-UA")} грн</strong>
            {item.ended && <small>Завершено</small>}
          </button>
        ))}
      </div>
      <PoolMap
        immersive
        closed={closed}
        numbers={numbers}
        showNumbers
        selectable={available && !saving && !!tariff && !tariff.ended}
        reserved={reserved}
        selectedIds={selected}
        onSelect={(id) => {
          setSelected((values) =>
            values.includes(id)
              ? values.filter((value) => value !== id)
              : [...values, id],
          );
          setSuccess(null);
          setError("");
        }}
      />
      <div className="booking-confirm booking-dock">
        <div className="booking-feedback">
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
        </div>
        <div className="booking-selection">
          {!selected.length && (
            <p className="booking-selection-hint">
              {tariff?.ended
                ? "На сьогодні цей період завершено. Оберіть іншу дату."
                : "Оберіть місця на карті. Ціна вказана за один шезлонг."}
            </p>
          )}

          {selected.length > 0 && (
            <>
              <p>
                Обрано місць: <strong>{selected.length}</strong> ·{" "}
                {new Intl.DateTimeFormat("uk-UA", {
                  day: "numeric",
                  month: "short",
                }).format(new Date(`${day}T12:00:00`))}{" "}
                · {tariff?.visit_time}
              </p>
              <div className="selected-seats">
                {selected.map((id) => (
                  <button
                    type="button"
                    key={id}
                    className="text-button"
                    disabled={saving}
                    aria-label={`Прибрати шезлонг ${numbers[id] ?? id}`}
                    onClick={() =>
                      setSelected((values) =>
                        values.filter((value) => value !== id),
                      )
                    }
                  >
                    № {numbers[id] ?? id}
                    {reserved.includes(id)
                      ? " (зайнято)"
                      : enabled[id] !== true
                        ? " (закрито)"
                        : ""}{" "}
                    ×
                  </button>
                ))}
              </div>
            </>
          )}
          {selected.length > 0 && tariff && (
            <p className="booking-total">
              За {selected.length} місць{" "}
              <strong>
                {(selected.length * tariff.price_uah).toLocaleString("uk-UA")}{" "}
                грн
              </strong>
            </p>
          )}
        </div>
        {tariff?.adults_only && !tariff.ended && (
          <label className="adult-confirmation">
            <input
              type="checkbox"
              checked={adultConfirmed}
              disabled={saving}
              onChange={(event) => setAdultConfirmed(event.target.checked)}
            />
            <span>🔞 Усім гостям виповнилося 18 років</span>
          </label>
        )}
        <button
          className="gold-button"
          disabled={
            !selected.length ||
            !initData ||
            saving ||
            !available ||
            !tariff ||
            tariff.ended ||
            (tariff.adults_only && !adultConfirmed) ||
            selected.some(
              (id) => reserved.includes(id) || enabled[id] !== true,
            ) ||
            day < minimum
          }
          onClick={submit}
        >
          {saving ? "Зберігаємо…" : "Підтвердити бронювання"}
        </button>
      </div>
      <dialog
        ref={resultDialog}
        className="booking-result"
        aria-labelledby="booking-result-title"
        aria-describedby="booking-result-summary"
        onClose={() => {
          setSuccess(null);
          dateInput.current?.focus({ preventScroll: true });
        }}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const box = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom
          )
            setSuccess(null);
        }}
      >
        {success && (
          <div className="booking-result-content" role="status">
            <div className="booking-result-icon" aria-hidden="true">
              ✓
            </div>
            <h2 id="booking-result-title">Бронювання збережено</h2>
            <p id="booking-result-summary">Кількість місць: {success.length}</p>
            <p>
              📅{" "}
              {new Intl.DateTimeFormat("uk-UA", {
                day: "numeric",
                month: "long",
                year: "numeric",
              }).format(new Date(`${success[0].day}T12:00:00`))}
            </p>
            <p>🕒 {success[0]?.visit_time}</p>
            <ul>
              {success.map((item) => (
                <li key={item.id}>
                  Шезлонг{" "}
                  <strong>
                    №{" "}
                    {item.seat_number ?? numbers[item.seat_id] ?? item.seat_id}
                  </strong>
                </li>
              ))}
            </ul>
            <p className="booking-result-total">
              <strong>
                Разом:{" "}
                {success
                  .reduce((total, item) => total + (item.price_uah ?? 0), 0)
                  .toLocaleString("uk-UA")}{" "}
                грн
              </strong>
            </p>
            {success.some((item) => item.adults_only) && (
              <p>🔞 Відвідування лише для гостей 18+</p>
            )}
            <p className="booking-note">
              Онлайн-оплата не проводилась. Переглянути свої бронювання можна в
              боті.
            </p>
          </div>
        )}
        <button
          type="button"
          className="gold-button"
          autoFocus
          onClick={() => setSuccess(null)}
        >
          Повернутися до карти
        </button>
      </dialog>
    </div>
  );
}
