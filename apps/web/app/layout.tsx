import type { Metadata } from "next";
import Script from "next/script";
import { Shell } from "../components/shell";
import "./globals.css";
export const metadata: Metadata = {
  title: "U-Wellness Space",
  description: "Карта басейну U-Wellness Space",
};
export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#081b15",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk">
      <body>
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="beforeInteractive"
        />
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
