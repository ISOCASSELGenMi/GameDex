// 佔位首頁：Phase 3a 由 [locale]/ 月曆取代。
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-4 px-4 py-16">
      <h1 className="text-2xl font-semibold">SoK Game Calendar</h1>
      <p>開發中：Phase 0／1（環境、kernel、資料模型）已完成，月曆頁面在 Phase 3a。</p>
      <p className="text-sm opacity-70">
        健康檢查：<a className="underline" href="/healthz">/healthz</a>、<a className="underline" href="/readyz">/readyz</a>
      </p>
    </main>
  );
}
