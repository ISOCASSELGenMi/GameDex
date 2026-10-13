// @module catalog
// [locale] 底下沒有對應路由的網址 → 該語系的 404 頁（[locale]/not-found.tsx）。
import { notFound } from "next/navigation";

export const instant = false;

export default function CatchAll(): never {
  notFound();
}
