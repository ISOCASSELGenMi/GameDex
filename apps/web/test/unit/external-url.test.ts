import { describe, expect, it } from "vitest";
import { safeExternalUrl } from "@/modules/catalog/ui/external-url";

describe("safeExternalUrl（外部連結唯一白名單）", () => {
  it("放行 http(s)", () => {
    expect(safeExternalUrl("https://twitch.tv/x")).toBe("https://twitch.tv/x");
    expect(safeExternalUrl("http://example.com/a")).toBe("http://example.com/a");
    expect(safeExternalUrl("  https://example.com/a  ")).toBe("https://example.com/a");
    expect(safeExternalUrl("HTTPS://Example.com/")).toBe("https://example.com/");
  });
  it("擋掉 javascript:、data:（含大小寫、前置空白）、其他協定、相對網址、空值", () => {
    for (const u of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "  javascript:alert(1)",
      "\tjavascript:alert(1)",
      "data:text/html,x",
      "DATA:text/html,x",
      "vbscript:x",
      "file:///etc/passwd",
      "ftp://example.com/",
      "/relative/path",
      "//example.com/x",
      "example.com",
      "not a url",
      "",
      "   ",
    ]) {
      expect(safeExternalUrl(u), u).toBeNull();
    }
    expect(safeExternalUrl(null)).toBeNull();
    expect(safeExternalUrl(undefined)).toBeNull();
  });
});
