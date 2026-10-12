/**
 * 目前請求的情境（02 §目前使用者：catalog 不依賴 accounts）。
 * `accounts` 啟用時由它的 middleware 填入；未啟用時為空，catalog 照常運作。
 */
export interface RequestContext {
  currentUser?: { id: number; role: "member" | "content_manager" | "admin" };
  locale?: string;
  preferredPlatformIds?: number[];
}

export const EMPTY_REQUEST_CONTEXT: Readonly<RequestContext> = Object.freeze({});
