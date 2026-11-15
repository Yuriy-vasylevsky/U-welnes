"use client";
import { useEffect, useState } from "react";

type Tariff = {
  weekday: number;
  id: string;
  label: string;
  visit_time: string;
  price_uah: number;
  adults_only: boolean;
};
const weekdays = [
  "Понеділок",
  "Вівторок",
  "Середа",
  "Четвер",
  "П’ятниця",
  "Субота",
  "Неділя",
];
const keyOf = (item: Tariff) => `${item.weekday}/${item.id}`;

export function PriceAdmin() {
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [allowed, setAllowed] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  useEffect(() => {
    const raw = window.Telegram?.WebApp?.initData;
    if (!raw) {
      setError("Відкрийте адмінпанель через /admin у Telegram-боті.");
      setLoading(false);
      return;
    }
    setToken(raw);
    const controller = new AbortController();
    fetch("/api/v1/admin/tariffs", {
      headers: { Authorization: `tma ${raw}` },
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            response.status === 403
              ? "Доступ лише для адміністратора."
              : "Не вдалося завантажити ціни. Відкрийте панель знову.",
          );
        const data = await response.json();
        if (controller.signal.aborted) return;
        setTariffs(data.tariffs);
        setDrafts(
          Object.fromEntries(
            data.tariffs.map((item: Tariff) => [
              keyOf(item),
              String(item.price_uah),
            ]),
          ),
        );
        setAllowed(true);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  async function save(item: Tariff) {
    const key = keyOf(item),
      price = Number(drafts[key]);
    if (
      saving ||
      !allowed ||
      !/^\d+$/.test(drafts[key] ?? "") ||
      price > 1_000_000 ||
      price === item.price_uah
    )
      return;
    setSaving(key);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(`/api/v1/admin/tariffs/${key}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `tma ${token}`,
        },
        body: JSON.stringify({
          price_uah: price,
          expected_price_uah: item.price_uah,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAllowed(false);
          throw new Error(
            "Сесія завершилась або немає доступу. Відкрийте панель через бота.",
          );
        }
        if (data.detail?.code === "price_changed") {
          setTariffs((items) =>
            items.map((value) =>
              keyOf(value) === key
                ? { ...value, price_uah: data.detail.price_uah }
                : value,
            ),
          );
          setDrafts((values) => ({
            ...values,
            [key]: String(data.detail.price_uah),
          }));
          throw new Error(
            "Ціну вже змінив інший адміністратор. Показуємо актуальну ціну — перевірте її та повторіть зміну.",
          );
        }
        throw new Error(
          "Не вдалося зберегти ціну. Перевірте значення й спробуйте ще раз.",
        );
      }
      setTariffs((items) =>
        items.map((value) =>
          keyOf(value) === key
            ? { ...value, price_uah: data.price_uah }
            : value,
        ),
      );
      setDrafts((values) => ({ ...values, [key]: String(data.price_uah) }));
      setSuccess(
        `${weekdays[item.weekday]}, ${item.label.toLowerCase()}: збережено ${data.price_uah.toLocaleString("uk-UA")} грн.`,
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : "Помилка мережі.");
    } finally {
      setSaving("");
    }
  }

  return (
    <div className="booking-page price-admin">
      <p className="eyebrow">U-WELLNESS / ТАРИФИ</p>
      <h1>Редагування цін</h1>
      <p className="booking-note">
        Ціна в гривнях за один шезлонг. Зміни діють для нових бронювань; суми
        збережених бронювань залишаються незмінними.
      </p>
      {loading && <p role="status">Завантажуємо тарифи…</p>}
      {error && (
        <p className="booking-error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="booking-success" role="status">
          {success}
        </p>
      )}
      {allowed &&
        weekdays.map((day, weekday) => (
          <section key={day} className="tariff-day" aria-label={day}>
            <h2>{day}</h2>
            <div className="tariff-grid">
              {tariffs
                .filter((item) => item.weekday === weekday)
                .map((item) => {
                  const key = keyOf(item),
                    draft = drafts[key] ?? "";
                  const valid =
                    /^\d+$/.test(draft) && Number(draft) <= 1_000_000;
                  return (
                    <form
                      key={key}
                      className="tariff-edit"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void save(item);
                      }}
                    >
                      <h3>
                        {item.label} {item.adults_only && <span>18+</span>}
                      </h3>
                      <p>{item.visit_time}</p>
                      <label>
                        Ціна, грн
                        <input
                          aria-label={`${day}: ${item.label}`}
                          type="number"
                          inputMode="numeric"
                          min="0"
                          max="1000000"
                          step="1"
                          required
                          value={draft}
                          disabled={!!saving}
                          onChange={(event) =>
                            setDrafts((values) => ({
                              ...values,
                              [key]: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <button
                        className="gold-button"
                        disabled={
                          !!saving || !valid || Number(draft) === item.price_uah
                        }
                      >
                        {saving === key ? "Зберігаємо…" : "Зберегти"}
                      </button>
                    </form>
                  );
                })}
            </div>
          </section>
        ))}
    </div>
  );
}
