/**
 * 伺服器啟動時執行一次（每個實例各一次；多實例靠 advisory lock 避免任務重跑）。
 * 只在 Node runtime 執行；Node 專用模組在判斷內動態 import（02 §排程）。
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { bootstrap } = await import("./bootstrap");
  await bootstrap();
}

/**
 * 伺服器端請求錯誤（頁面渲染、route handler、proxy）→ 結構化錯誤 log（16 §營運 §錯誤監控）。
 * 一律先經 scrubEvent 清掉 token、標頭、email 等；錯誤監控選型（Sentry／GlitchTip）定案後在 reportError 旁接 SDK。
 */
export async function onRequestError(
  error: unknown,
  request: { path: string; method: string; headers: { [key: string]: string | string[] | undefined } },
  context: { routerKind: string; routePath: string; routeType: string; renderSource?: string; revalidateReason?: string; renderType?: string },
): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { moduleFromRoutePath, reportError } = await import("./kernel/observability/report");
  reportError({
    error,
    module: moduleFromRoutePath(context.routePath),
    request: { path: request.path, method: request.method, headers: request.headers },
    context: { ...context },
  });
}
