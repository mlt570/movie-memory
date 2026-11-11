import { describe, expect, it } from "vitest";
import { toPlainText } from "@/lib/openai";

describe("toPlainText", () => {
  it("removes inline web-search citations", () => {
    expect(
      toPlainText("It premiered on June 20, 2025. ([netflix.com](https://www.netflix.com/tudum?utm_source=openai))"),
    ).toBe("It premiered on June 20, 2025.");
  });

  it("keeps the label of other markdown links", () => {
    expect(toPlainText("Directed by [Maggie Kang](https://example.com).")).toBe("Directed by Maggie Kang.");
  });

  it("leaves plain text unchanged", () => {
    expect(toPlainText("  Bullet time used a ring of still cameras.  ")).toBe(
      "Bullet time used a ring of still cameras.",
    );
  });
});
