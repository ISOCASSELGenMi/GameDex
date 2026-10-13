// @module kernel
// UI slot 的組裝（02 §Manifest 與擴充點）：catalog 版面不 import 可選模組，由薄路由從 registry 取出已啟用模組提供的元件。
import type { ComponentType, ReactNode } from "react";
import type { UiSlotName } from "@/kernel/modules/types";
import { enabledModules } from "@/modules/registry";

export function renderUiSlot(name: UiSlotName, props: Record<string, unknown>): ReactNode {
  const components = enabledModules().flatMap((m) => {
    const c = m.uiSlots?.[name];
    return c ? [c as ComponentType<Record<string, unknown>>] : [];
  });
  if (components.length === 0) return null;
  return components.map((C, i) => <C key={i} {...props} />);
}
