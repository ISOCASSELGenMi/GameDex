/**
 * 密碼雜湊（D79）：argon2id（@node-rs/argon2，預編譯、無 install script）。
 * 參數 m=19 MiB／t=2／p=1（OWASP 最低組合之一；登入約數十毫秒，上線後視實測調整）。
 * 新系統沒有舊雜湊，不需要 scrypt 相容。
 */
import { hash, verify, type Algorithm } from "@node-rs/argon2";

/** Algorithm 是 ambient const enum（isolatedModules 不能引用），Argon2id＝2。 */
const ARGON2ID = 2 as Algorithm;

export const ARGON2_PARAMS = { algorithm: ARGON2ID, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_PARAMS);
}

export async function verifyPassword(input: { hash: string; password: string }): Promise<boolean> {
  try {
    return await verify(input.hash, input.password);
  } catch {
    return false;
  }
}
