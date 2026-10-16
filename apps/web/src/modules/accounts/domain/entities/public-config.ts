import type { SocialProvider } from "./providers";

/** 登入頁／註冊頁要顯示什麼（不含任何 secret）：哪些社群登入可用、是否開放註冊。 */
export interface AccountsPublicConfig {
  signupEnabled: boolean;
  socialProviders: SocialProvider[];
}
