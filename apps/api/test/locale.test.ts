import { describe, expect, it } from "vitest";
import { getMessages, localizeRuntimeMessage, resolveLocale } from "../src/locale";

describe("locale", () => {
  it("resolves explicit locale header and accept-language fallback", () => {
    expect(resolveLocale({
      headers: {
        "x-stratium-locale": " zh ",
        "accept-language": "en-US,en;q=0.9"
      }
    })).toBe("zh");

    expect(resolveLocale({
      headers: {
        "accept-language": "ja-JP,ja;q=0.9"
      }
    })).toBe("ja");

    expect(resolveLocale({
      headers: {
        "accept-language": "fr-FR,fr;q=0.9"
      }
    })).toBe("en");
  });

  it("returns translated messages and preserves unknown runtime messages", () => {
    expect(getMessages("zh").auth.loginRequired).toContain("登录");
    expect(getMessages("ja").trading.leverageMax(10, "BTC")).toContain("10x");
    expect(getMessages("en").admin.batchJobRequestFailed).toBe("Batch job request failed.");

    expect(localizeRuntimeMessage("zh", "Manual tick requires bid lower than ask.")).toContain("bid");
    expect(localizeRuntimeMessage("en", "Unknown runtime message")).toBe("Unknown runtime message");
  });
});
