"use client";
/**
 * header.right slot 的傳遞（02 §UI slot）：根版面（app/[locale]/layout.tsx）從 registry 取得已啟用模組的元件，
 * 以 Provider 放進 context；每頁的 PageShell（伺服器元件）渲染 <HeaderRightOutlet />，由它取出放進 header。
 * 這樣十幾種頁面都不必各自傳 slot。元件本身是 client component（登入狀態在客戶端取得），所以頁面 HTML 與使用者無關、可快取。
 */
import { createContext, useContext, type ReactElement, type ReactNode } from "react";

const HeaderRightContext = createContext<ReactNode>(null);

export function HeaderRightProvider({ value, children }: { value: ReactNode; children: ReactNode }): ReactElement {
  return <HeaderRightContext.Provider value={value}>{children}</HeaderRightContext.Provider>;
}

export function HeaderRightOutlet(): ReactElement {
  return <>{useContext(HeaderRightContext)}</>;
}
