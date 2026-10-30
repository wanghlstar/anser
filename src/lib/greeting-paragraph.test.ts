// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { GreetingParagraph } from "./greeting-paragraph";

describe("greeting paragraph attributes", () => {
  const attrs = GreetingParagraph.config.addAttributes!.call({
    parent: () => ({}),
  } as never) as Record<
    string,
    {
      parseHTML: (el: Element) => string | null;
      renderHTML: (attrs: Record<string, unknown>) => Record<string, string>;
    }
  >;
  it("round-trips the greeting marker through HTML", () => {
    expect(attrs.greeting.renderHTML({ greeting: "true" })).toEqual({
      "data-yanxin-greeting": "true",
    });
    const element = document.createElement("p");
    element.setAttribute("data-yanxin-greeting", "true");
    expect(attrs.greeting.parseHTML(element)).toBe("true");
    const plain = document.createElement("p");
    expect(attrs.greeting.parseHTML(plain)).toBeNull();
  });
  it("marks paragraphs that already carry a real indent", () => {
    // 缩进是真实全角空格；标记用于避免重复插入，不再联动 CSS
    const source = readFileSync(
      path.join(process.cwd(), "src/lib/greeting-paragraph.ts"),
      "utf8",
    );
    expect(source).toContain("data-yanxin-indented");
    expect(attrs.indented.renderHTML({ indented: "true" })).toEqual({
      "data-yanxin-indented": "true",
    });
  });
  it("keeps the greeting paragraph flush left", () => {
    const css = readFileSync(path.join(process.cwd(), "src/index.css"), "utf8");
    const rule = css.match(
      /\.rich-body p\[data-yanxin-greeting\]\s*\{([^}]*)\}/,
    );
    expect(rule).not.toBeNull();
    expect(rule![1]).toContain("text-indent: 0");
  });
});
