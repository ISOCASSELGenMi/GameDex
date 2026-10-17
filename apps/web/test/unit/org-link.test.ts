// 組織首頁連結（ORG_HOME_URL／ORG_NAME）：沒設、非 https、有設的各種情況。
import { describe, expect, it } from "vitest";
import { orgLink } from "@/modules/catalog/ui/layout/org-link";

describe("orgLink", () => {
  it("沒設（或空白）→ null", () => {
    expect(orgLink({})).toBeNull();
    expect(orgLink({ ORG_HOME_URL: "   ", ORG_NAME: "X" })).toBeNull();
  });
  it("不是 https 網址（http、其他協定、亂字串）→ null", () => {
    expect(orgLink({ ORG_HOME_URL: "http://org.example" })).toBeNull();
    expect(orgLink({ ORG_HOME_URL: "javascript:alert(1)" })).toBeNull();
    expect(orgLink({ ORG_HOME_URL: "not a url" })).toBeNull();
  });
  it("有設：用 ORG_NAME；沒設名稱時用主機名稱", () => {
    expect(orgLink({ ORG_HOME_URL: "https://org.example/", ORG_NAME: " Example Org " })).toEqual({ href: "https://org.example/", name: "Example Org" });
    expect(orgLink({ ORG_HOME_URL: "https://org.example" })).toEqual({ href: "https://org.example/", name: "org.example" });
  });
});
