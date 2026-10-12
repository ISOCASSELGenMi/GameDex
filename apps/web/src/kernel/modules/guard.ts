import { isModuleEnabled } from "./enabled";

type Handler<A extends unknown[]> = (...args: A) => Response | Promise<Response>;

/**
 * 薄路由的啟用檢查（02 §Manifest「薄路由」）：模組停用 → 404。
 * 用法：export const GET = guardModule("discord", h.GET);
 */
export function guardModule<A extends unknown[]>(moduleName: string, handler: Handler<A>): Handler<A> {
  return (...args: A) => {
    if (!isModuleEnabled(moduleName)) {
      return new Response("Not Found", { status: 404 });
    }
    return handler(...args);
  };
}
