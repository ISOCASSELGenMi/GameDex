/** Better Auth 實例的建立（不快取；lazy 單例在 use-cases/auth-instance.ts）。 */
import { betterAuth } from "better-auth";
import { buildAuthOptions, type BuildAuthOptionsInput } from "./options";

export function createAuth(input: BuildAuthOptionsInput) {
  return betterAuth(buildAuthOptions(input));
}

export type AccountsAuth = ReturnType<typeof createAuth>;
