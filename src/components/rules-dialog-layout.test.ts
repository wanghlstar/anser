// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const css = readFileSync(path.join(process.cwd(), "src/index.css"), "utf8");
const rule = (selector: string) =>
  new RegExp(`${selector.replace(/[[\]]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(
    css,
  )?.[1];

describe("rule dialog keeps a stable frame with one inner scroll", () => {
  it("scrolls the condition list instead of the whole form", () => {
    const conditions = rule("\\.conditions");
    expect(conditions).not.toBeUndefined();
    expect(conditions).toContain("max-height");
    expect(conditions).toContain("overflow-y: auto");
  });
  it("does not add a second scrollbar on the form", () => {
    // 嵌套滚动会把条件区挤压成看不见的一小条（选服务器动作时出现过）
    const form = rule("\\.rule-form");
    expect(form).not.toBeUndefined();
    expect(form).not.toContain("overflow-y: auto");
  });
  it("caps the dialog height so it stays centred and never grows past the screen", () => {
    const panel = readFileSync(
      path.join(process.cwd(), "src/components/rules-panel.tsx"),
      "utf8",
    );
    // 弹窗限高 + 兜底滚动：内容真超高时按钮仍可达
    expect(panel).toContain("sm:max-h-[85vh] overflow-y-auto");
  });
  it("keeps the action row in normal flow, not floating", () => {
    // sticky 在无滚动容器里会飘到中间和内容重叠
    const actions = rule("\\.dialog-actions");
    expect(actions).not.toBeUndefined();
    expect(actions).not.toContain("position: sticky");
  });
});
