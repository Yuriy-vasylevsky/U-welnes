"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

export function AdminMenu() {
  const [status, setStatus] = useState("Перевіряємо доступ…");
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    const token = window.Telegram?.WebApp?.initData;
    if (!token) {
      setStatus("Відкрийте адмінпанель через /admin у Telegram-боті.");
      return;
    }
    const controller = new AbortController();
    fetch("/api/v1/admin/tariffs", {
      headers: { Authorization: `tma ${token}` },
      signal: controller.signal,
      cache: "no-store",
    })
      .then((response) => {
        if (!response.ok)
          throw new Error(
            response.status === 403
              ? "Доступ лише для адміністратора."
              : "Не вдалося перевірити доступ. Відкрийте панель знову через бота.",
          );
        setAllowed(true);
        setStatus("");
      })
      .catch((error) => {
        if (!controller.signal.aborted) setStatus(error.message);
      });
    return () => controller.abort();
  }, []);
  return (
    <div className="booking-page admin-menu-page">
      <p className="eyebrow">U-WELLNESS / АДМІНІСТРАТОР</p>
      <h1>Меню адміністратора</h1>
      {status && (
        <p role="status" className="booking-note">
          {status}
        </p>
      )}
      {allowed && (
        <div className="admin-menu-cards">
          <Link href="/admin/seats" className="admin-menu-card">
            <span aria-hidden="true">🗺</span>
            <h2>Карта й місця</h2>
            <p>Номери шезлонгів і доступність для бронювання.</p>
          </Link>
          <Link href="/admin/prices" className="admin-menu-card">
            <span aria-hidden="true">💰</span>
            <h2>Редагування цін</h2>
            <p>Тарифи за кожен день тижня та період відвідування.</p>
          </Link>
        </div>
      )}
    </div>
  );
}
