import type { Metadata } from "next";
import "./globals.css";

// Phase 3a 會改成 [locale] 路由與語言選單（06）；這裡只是 Phase 0/1 的佔位版面。
export const metadata: Metadata = {
  title: "SoK Game Calendar",
  description: "遊戲上市月曆與時間軸",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-Hant" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
