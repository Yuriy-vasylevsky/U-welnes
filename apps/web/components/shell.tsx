"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
type WebApp = {
  initData?: string;
  ready: () => void;
  expand: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  viewportStableHeight?: number;
  safeAreaInset?: { top: number; bottom: number };
  contentSafeAreaInset?: { top: number; bottom: number };
  onEvent: (event: string, fn: () => void) => void;
  offEvent: (event: string, fn: () => void) => void;
};
declare global {
  interface Window {
    Telegram?: { WebApp?: WebApp };
  }
}
const links = [
  ["/", "Басейн"],
  ["/services", "Послуги"],
  ["/contacts", "Контакти"],
];
export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else if (dialog.current?.open) {
      dialog.current.close();
      trigger.current?.focus();
    }
  }, [open]);
  useEffect(() => {
    const app = window.Telegram?.WebApp;
    if (!app) return;
    const sync = () => {
      const s = document.documentElement.style;
      if (app.viewportStableHeight)
        s.setProperty("--app-height", `${app.viewportStableHeight}px`);
      s.setProperty(
        "--tg-top",
        `${(app.safeAreaInset?.top ?? 0) + (app.contentSafeAreaInset?.top ?? 0)}px`,
      );
      s.setProperty(
        "--tg-bottom",
        `${(app.safeAreaInset?.bottom ?? 0) + (app.contentSafeAreaInset?.bottom ?? 0)}px`,
      );
    };
    app.ready();
    app.expand();
    app.setHeaderColor?.("#081b15");
    app.setBackgroundColor?.("#081b15");
    sync();
    const events = [
      "viewportChanged",
      "safeAreaChanged",
      "contentSafeAreaChanged",
    ];
    events.forEach((e) => app.onEvent(e, sync));
    return () => events.forEach((e) => app.offEvent(e, sync));
  }, []);
  const navigation = () =>
    links.map(([href, label]) => (
      <Link
        key={href}
        href={href}
        aria-current={pathname === href ? "page" : undefined}
      >
        {label}
      </Link>
    ));
  return (
    <div className="app-shell">
      <a className="skip" href="#main">
        До вмісту
      </a>
      <header>
        <Link
          href="/"
          className="brand"
          aria-label="U-Wellness Space — головна"
        >
          <span className="brand-mark">U</span>
          <span>
            U-WELLNESS<small>SPACE</small>
          </span>
        </Link>
        <nav className="desktop-nav" aria-label="Головна навігація">
          {navigation()}
        </nav>
        <button
          ref={trigger}
          className="menu-button"
          onClick={() => setOpen(true)}
          aria-label="Відкрити меню"
          aria-expanded={open}
          aria-controls="mobile-menu"
        >
          ☰
        </button>
      </header>
      <dialog
        id="mobile-menu"
        ref={dialog}
        onCancel={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setOpen(false);
        }}
      >
        <button
          className="close-menu"
          onClick={() => setOpen(false)}
          aria-label="Закрити меню"
        >
          ×
        </button>
        <p className="eyebrow">U-WELLNESS SPACE</p>
        <nav aria-label="Мобільна навігація">{navigation()}</nav>
      </dialog>
      <main id="main">{children}</main>
      <footer>
        <span>U-Wellness Space</span>
        <span>Простір вашого відпочинку</span>
      </footer>
    </div>
  );
}
