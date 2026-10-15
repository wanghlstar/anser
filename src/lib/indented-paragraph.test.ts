// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = readFileSync(
  path.join(process.cwd(), "src/lib/indented-paragraph.ts"),
  "utf8",
);
const css = readFileSync(path.join(process.cwd(), "src/index.css"), "utf8");

describe("body indent is a real character, not CSS", () => {
  it("removes text-indent from rich-body so mail matches the editor", () => {
    // CSS text-indent 只影响本地渲染，发出去的 HTML 没有缩进
    expect(css).not.toMatch(/\.rich-body p\s*\{[^}]*text-indent: 2em/);
    expect(css).not.toMatch(
      /\.rich-body p\[data-yanxin-indented\]\s*\{[^}]*text-indent: 0/,
    );
  });
  it("inserts the indent after the split via appendTransaction", () => {
    // 在 Enter 的 chain 里读 tr.selection 会拿到分裂前的位置，
    // 把缩进插到上一段段尾——这是已经出现过的 bug。
    expect(source).toContain("appendTransaction");
    expect(source).not.toContain("createParagraphNear");
    expect(source).not.toContain(".insertContent(INDENT)");
    expect(source).not.toContain("insertText(INDENT, at)");
  });
  it("uses two full-width spaces and marks the paragraph", () => {
    expect(source).toContain('const INDENT = "　　"');
    expect(source).toContain('indented: "true"');
  });
  it("backfills existing drafts on mount so old text is not sent flush left", () => {
    expect(source).toContain("view: ()");
    expect(source).toContain("prevState");
  });
  it("never touches the greeting paragraph", () => {
    expect(source).toContain("node.attrs.greeting");
  });
});
