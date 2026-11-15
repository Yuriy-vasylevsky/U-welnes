"use client";
import { useEffect, useState } from "react";
import { PoolMap } from "./pool-map";
import catalog from "../data/seats.json";

const errors: Record<string, string> = {
  admin_required: "Доступ лише для адміністратора.",
  invalid_telegram_data:
    "Сесія завершилась. Закрийте панель і відкрийте її через /admin у боті.",
  telegram_required: "Відкрийте адмінпанель командою /admin у Telegram-боті.",
  number_in_use:
    "Цей номер уже використовується іншим шезлонгом. Оберіть вільний номер.",
  seat_changed:
    "Номер уже змінив інший адміністратор. Перевірте поточний номер і повторіть дію.",
  availability_changed:
    "Доступність уже змінив інший адміністратор. Перевірте поточний стан і повторіть дію.",
};

export function SeatAdmin() {
  const [token, setToken] = useState("");
  const [numbers, setNumbers] = useState<Record<string, number | null>>({});
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selected = selectedIds.length === 1 ? selectedIds[0] : "";
  const [draft, setDraft] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function load(raw: string, signal?: AbortSignal) {
    const response = await fetch("/api/v1/admin/seats", {
      headers: { Authorization: `tma ${raw}` },
      cache: "no-store",
      signal,
    });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401 || response.status === 403)
        setAuthorized(false);
      throw new Error(
        errors[data.detail] ||
          "Не вдалося завантажити місця. Спробуйте відкрити панель знову.",
      );
    }
    if (data.map_version !== catalog.source_sha256)
      throw new Error("Карту оновлено. Закрийте панель і відкрийте знову.");
    if (!signal?.aborted) {
      setNumbers(data.numbers);
      setEnabled(data.enabled ?? {});
      setAuthorized(true);
    }
    return data.numbers as Record<string, number | null>;
  }

  useEffect(() => {
    const raw = window.Telegram?.WebApp?.initData || "";
    const controller = new AbortController();
    setToken(raw);
    if (!raw) {
      setLoading(false);
      setError(errors.telegram_required);
      return;
    }
    load(raw, controller.signal)
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  function choose(id: string) {
    setSelectedIds((ids) => ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]);
    setDraft(numbers[id] == null ? "" : String(numbers[id]));
    setConfirmClear(false);
    setError("");
    setSuccess("");
  }
  useEffect(() => {
    setDraft(selected && numbers[selected] != null ? String(numbers[selected]) : "");
  }, [selected, numbers]);
  const newNumber = Number(draft);
  const valid =
    /^\d+$/.test(draft) &&
    Number.isInteger(newNumber) &&
    newNumber >= 1 &&
    newNumber <= 9999;
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !authorized || !valid || saving) return;
    setSaving(true);
    setError("");
    setSuccess("");
    const old = numbers[selected];
    try {
      const response = await fetch(
        `/api/v1/admin/seats/${encodeURIComponent(selected)}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `tma ${token}`,
          },
          body: JSON.stringify({ number: newNumber, expected_number: old }),
        },
      );
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 401 || response.status === 403)
          setAuthorized(false);
        if (data.detail === "seat_changed") {
          const fresh = await load(token);
          setDraft(fresh[selected] == null ? "" : String(fresh[selected]));
        }
        throw new Error(
          errors[data.detail] || "Не вдалося зберегти номер. Спробуйте ще раз.",
        );
      }
      setNumbers((values) => ({ ...values, [selected]: data.number }));
      setDraft(String(data.number));
      setSuccess(
        `Номер змінено: ${old ?? "без номера"} → ${data.number}. Бронювання збережено.`,
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : "Помилка мережі.");
    } finally {
      setSaving(false);
    }
  }

  async function clearNumbers() {
    if (!authorized || saving || !confirmClear) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/v1/admin/seats/clear-numbers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `tma ${token}`,
        },
        body: JSON.stringify({ confirmation: "CLEAR_ALL_NUMBERS" }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 401 || response.status === 403)
          setAuthorized(false);
        throw new Error(
          errors[data.detail] ||
            "Не вдалося очистити номери. Спробуйте ще раз.",
        );
      }
      setNumbers(data.numbers);
      setSelectedIds([]);
      setDraft("");
      setConfirmClear(false);
      setSuccess(
        `Номери очищено: ${data.cleared}. Шезлонги та бронювання збережено. Можна задати нові номери.`,
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : "Помилка мережі.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleAvailability() {
    if (!authorized || !selected || saving) return;
    const current = enabled[selected] === true;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(
        `/api/v1/admin/seats/${encodeURIComponent(selected)}/availability`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `tma ${token}`,
          },
          body: JSON.stringify({
            enabled: !current,
            expected_enabled: current,
          }),
        },
      );
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 401 || response.status === 403)
          setAuthorized(false);
        if (data.detail === "availability_changed") await load(token);
        throw new Error(
          errors[data.detail] || "Не вдалося змінити доступність.",
        );
      }
      setEnabled((values) => ({ ...values, [selected]: data.enabled }));
      setSuccess(
        data.enabled
          ? "Місце відкрите для нових бронювань."
          : "Місце закрите для нових бронювань. Наявні бронювання збережено.",
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : "Помилка мережі.");
    } finally {
      setSaving(false);
    }
  }

  async function setBulkAvailability(value: boolean) {
    if (!authorized || !selectedIds.length || saving) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/v1/admin/seats/availability/batch", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `tma ${token}` },
        body: JSON.stringify({ enabled: value, expected_enabled: Object.fromEntries(selectedIds.map((id) => [id, enabled[id] === true])) }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) setAuthorized(false);
        if (data.detail === "availability_changed") await load(token);
        throw new Error(errors[data.detail] || "Не вдалося змінити доступність місць.");
      }
      setEnabled((values) => ({ ...values, ...data.enabled }));
      setSuccess(`${value ? "Відкрито" : "Закрито"} для бронювання: ${selectedIds.length}.`);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Помилка мережі.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="booking-page admin-page">
      <p className="eyebrow">U-WELLNESS / АДМІНІСТРАТОР</p>
      <h1>Нумерація шезлонгів</h1>
      <p className="booking-note">
        Натисніть на місце на карті та задайте новий номер. Збільште карту, щоб
        краще бачити номери. Сірі місця закриті для бронювання; їх можна
        активувати нижче.
      </p>
      {loading && <p role="status">Перевіряємо доступ…</p>}
      {error && (
        <p role="alert" className="booking-error">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="booking-success">
          {success}
        </p>
      )}
      {authorized && (
        <>
          <div className="admin-clear-controls">
            {!confirmClear ? (
              <button
                className="danger-button"
                disabled={
                  saving ||
                  !Object.values(numbers).some((number) => number !== null)
                }
                onClick={() => {
                  setConfirmClear(true);
                  setSuccess("");
                  setError("");
                }}
              >
                Очистити всі номери
              </button>
            ) : (
              <section
                className="booking-confirm"
                aria-label="Підтвердження очищення номерів"
              >
                <h2>Очистити всі номери?</h2>
                <p>
                  Буде прибрано номери з усіх шезлонгів. Місця, карта й
                  бронювання залишаться. Нові номери можна буде задати вручну.
                </p>
                <button
                  className="danger-button"
                  disabled={saving}
                  onClick={clearNumbers}
                >
                  {saving ? "Очищаємо…" : "Підтвердити очищення"}
                </button>
                <button
                  className="text-button"
                  disabled={saving}
                  onClick={() => setConfirmClear(false)}
                >
                  Скасувати
                </button>
              </section>
            )}
          </div>
          <PoolMap
            editMode
            closed={catalog.seats
              .filter((seat) => enabled[seat.id] !== true)
              .map((seat) => seat.id)}
            selectable={!saving}
            numbers={numbers}
            showNumbers
            selectedIds={selectedIds}
            onSelect={choose}
          />
          <form className="booking-confirm" onSubmit={save}>
            {selectedIds.length > 0 && (
              <section aria-label="Вибрані місця">
                <h2>Вибрано місць: {selectedIds.length}</h2>
                <p>{selectedIds.map((id) => numbers[id] == null ? id : `№ ${numbers[id]}`).join(", ")}</p>
                <button type="button" className="gold-button" disabled={saving || selectedIds.every((id) => enabled[id] === true)} onClick={() => setBulkAvailability(true)}>Відкрити вибрані</button>
                <button type="button" className="text-button" disabled={saving || selectedIds.every((id) => enabled[id] !== true)} onClick={() => setBulkAvailability(false)}>Закрити вибрані</button>
                <button type="button" className="text-button" disabled={saving} onClick={() => { setSelectedIds([]); setDraft(""); }}>Зняти вибір</button>
                {selectedIds.length > 1 && <p className="booking-note">Щоб змінити номер, залиште вибраним один шезлонг. Повторне натискання на місце знімає вибір.</p>}
              </section>
            )}
            {selectedIds.length === 0 && (
              <p>
                Натисніть на шезлонг на карті, щоб змінити його номер або
                доступність.
              </p>
            )}

            {selected && (
              <>
                <div className="availability-control">
                  <p>
                    Статус:{" "}
                    <strong>
                      {enabled[selected] === true
                        ? "Доступний для бронювання"
                        : "Недоступний для бронювання"}
                    </strong>
                  </p>
                  <button
                    type="button"
                    role="switch"
                    aria-label="Доступний для бронювання"
                    aria-checked={enabled[selected] === true}
                    disabled={saving}
                    className="text-button"
                    onClick={toggleAvailability}
                  >
                    {enabled[selected] === true
                      ? "Закрити для бронювання"
                      : "Відкрити для бронювання"}
                  </button>
                </div>
                <p>
                  Поточний номер:{" "}
                  <strong>{numbers[selected] ?? "Без номера"}</strong>
                </p>
                <label>
                  Новий номер
                  <input
                    aria-label="Новий номер"
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max="9999"
                    step="1"
                    required
                    value={draft}
                    disabled={saving}
                    onChange={(event) => setDraft(event.target.value)}
                  />
                </label>
                <p className="booking-note">
                  Номер від 1 до 9999, унікальний для кожного шезлонга.
                </p>
                <button
                  className="gold-button"
                  disabled={!valid || saving || newNumber === numbers[selected]}
                >
                  {saving ? "Зберігаємо…" : "Зберегти номер"}
                </button>
              </>
            )}
          </form>
        </>
      )}
    </div>
  );
}
