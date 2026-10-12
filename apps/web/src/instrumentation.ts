/**
 * 伺服器啟動時執行一次（每個實例各一次；多實例靠 advisory lock 避免任務重跑）。
 * 只在 Node runtime 執行；Node 專用模組在判斷內動態 import（02 §排程）。
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { bootstrap } = await import("./bootstrap");
  await bootstrap();
}
