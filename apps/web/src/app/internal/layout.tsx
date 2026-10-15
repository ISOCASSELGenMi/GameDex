// @module admin
// /internal/* 的根版面（內部管理介面，不分語系、不索引；Basic auth 與 no-store 由 proxy.ts 處理）。
import type { Metadata } from "next";
import "../globals.css";

export const metadata: Metadata = {
  title: { default: "SoK 管理", template: "%s | SoK 管理" },
  robots: { index: false, follow: false },
};

export default function InternalLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant" className="antialiased">
      <body>{children}</body>
    </html>
  );
}
