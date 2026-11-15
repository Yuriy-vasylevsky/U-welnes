"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
type WebApp = {
  initData?: string;
  ready: () => void;
  expand: () => void;
  disableVerticalSwipes?: () => void;
  enableVerticalSwipes?: () => void;
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
export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const immersive = pathname === "/" || pathname === "/book";
  useEffect(() => {
    if (!immersive) return;
    const app = window.Telegram?.WebApp;
    app?.disableVerticalSwipes?.();
    return () => app?.enableVerticalSwipes?.();
  }, [immersive]);
  useEffect(() => {
    const inMap = (target: EventTarget | null) =>
      target instanceof Element && !!target.closest(".map-viewport");
    const stopGesture = (event: Event) => event.preventDefault();
    const stopPagePinch = (event: TouchEvent) => {
      if (event.touches.length > 1 && !inMap(event.target))
        event.preventDefault();
    };
    const stopPageWheelZoom = (event: WheelEvent) => {
      if (event.ctrlKey && !inMap(event.target)) event.preventDefault();
    };
    const stopPageZoomKeys = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        ["+", "=", "-", "_", "0"].includes(event.key)
      )
        event.preventDefault();
    };
    // Safari native gestures zoom the page; the map uses independent touch events.
    document.addEventListener("gesturestart", stopGesture, { passive: false });
    document.addEventListener("gesturechange", stopGesture, { passive: false });
    document.addEventListener("touchmove", stopPagePinch, { passive: false });
    document.addEventListener("wheel", stopPageWheelZoom, { passive: false });
    document.addEventListener("keydown", stopPageZoomKeys);
    return () => {
      document.removeEventListener("gesturestart", stopGesture);
      document.removeEventListener("gesturechange", stopGesture);
      document.removeEventListener("touchmove", stopPagePinch);
      document.removeEventListener("wheel", stopPageWheelZoom);
      document.removeEventListener("keydown", stopPageZoomKeys);
    };
  }, []);
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
  return (
    <div className={`app-shell${immersive ? " booking-shell" : ""}`}>
      <a className="skip" href="#main">
        До вмісту
      </a>
      <header>
        <Link
          href="/"
          className="brand"
          aria-label="U-Wellness Space — головна"
        >
          <img
            className="brand-logo"
            src="/brand/wellness-logo.png"
            alt=""
            width="52"
            height="62"
          />
          <span className="brand-name">WELLNESS</span>
        </Link>
      </header>
      <main id="main">{children}</main>
      <footer>
        <span>U-Wellness Space</span>
        <span>Простір вашого відпочинку</span>
      </footer>
    </div>
  );
}
