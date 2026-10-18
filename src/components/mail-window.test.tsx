// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MailWindow } from "./mail-window";
import { enterDemo, leaveDemo, snapshot } from "@/lib/api";
import type { Mail } from "@/lib/types";

let root: Root, host: HTMLDivElement;
let mail: Mail;
let closed = false;

async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (e) =>
      e.textContent?.trim() === label || e.getAttribute("aria-label") === label,
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
// jsdom 没有 PointerEvent：React 按事件名匹配，用 MouseEvent 触发即可。
async function pointer(element: Element, type: string, x: number, y: number) {
  await act(async () => {
    element.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
        clientX: x,
        clientY: y,
      }),
    );
  });
}
async function renderWindow(stackIndex = 0) {
  await act(async () =>
    root.render(
      <MailWindow
        key={`window-${stackIndex}`}
        mail={mail}
        demo
        stackIndex={stackIndex}
        onClose={() => {
          closed = true;
        }}
        onReply={() => {}}
        onExport={() => {}}
        onAttachment={async () => {}}
        onLink={() => {}}
      />,
    ),
  );
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  closed = false;
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  HTMLElement.prototype.scrollTo = vi.fn();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  enterDemo();
  const data = await snapshot({
    view: "all",
    accountId: "",
    folder: "",
    search: "",
    limit: 100,
    unreadOnly: false,
  });
  mail = data.messages[0];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await renderWindow();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  leaveDemo();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("floating mail window", () => {
  const dialog = () =>
    document.querySelector(".mail-window") as unknown as HTMLElement;
  const header = () =>
    dialog().querySelector('[data-slot="dialog-header"]') as unknown as Element;
  const style = (name: string) => dialog().style.getPropertyValue(name);

  it("非模态打开：没有遮罩，标题是主题，正文与附件区都在", async () => {
    expect(dialog()).toBeTruthy();
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeNull();
    expect(dialog().querySelector(".mail-window-title")?.textContent).toBe(
      mail.subject,
    );
    expect(
      dialog().querySelector(".mail-window-byline")?.textContent,
    ).toContain("lin@example.com");
    expect(document.querySelectorAll(".compose-resize-handle")).toHaveLength(8);
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("周末愉快"),
    );
    const tools = [...dialog().querySelectorAll(".mail-window-toolbar button")];
    expect(tools.map((b) => b.textContent?.trim())).toEqual([
      "回复",
      "全部回复",
      "转发",
      "导出原始邮件",
    ]);
  });

  it("拖动标题区切到浮动定位，位置按视口收敛", async () => {
    await pointer(header(), "pointerdown", 100, 60);
    expect(dialog().className).toContain("compose-floating");
    await pointer(header(), "pointermove", 140, 90);
    await pointer(header(), "pointerup", 140, 90);
    // 基准取 clampMailGeometry（jsdom 里 rect 全 0 → 8,8,640,420），再位移 (+40,+30)
    expect(style("--compose-left")).toBe("48px");
    expect(style("--compose-top")).toBe("38px");
    expect(style("--compose-width")).toBe("640px");
    expect(style("--compose-height")).toBe("420px");
  });

  it("双击标题区最大化，再双击还原，最大化时收掉缩放手柄", async () => {
    await act(async () => {
      header().dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(dialog().className).toContain("compose-expanded");
    expect(document.querySelectorAll(".compose-resize-handle")).toHaveLength(0);
    await act(async () => {
      header().dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(dialog().className).not.toContain("compose-expanded");
    expect(document.querySelectorAll(".compose-resize-handle")).toHaveLength(8);
  });

  it("右下角热区缩放，并在最小尺寸处停住", async () => {
    const se = dialog().querySelector(
      '.compose-resize-handle[data-dir="se"]',
    ) as unknown as Element;
    await pointer(se, "pointerdown", 200, 200);
    await pointer(se, "pointermove", 300, 280);
    expect(style("--compose-width")).toBe("740px");
    expect(style("--compose-height")).toBe("500px");
    await pointer(se, "pointermove", 0, 0);
    expect(style("--compose-width")).toBe("640px");
    expect(style("--compose-height")).toBe("420px");
  });

  it("最小化收起窗口并显示「继续阅读」还原条，点它回到原状", async () => {
    await click("最大化阅读窗口");
    await click("最小化阅读窗口");
    expect(dialog().className).toContain("compose-minimized");
    const bar = document.querySelector(".compose-restore-bar");
    expect(bar).toBeTruthy();
    expect(bar!.textContent).toContain("阅读 · ");
    expect(bar!.textContent).toContain(mail.subject);
    await click("继续阅读");
    expect(document.querySelector(".compose-restore-bar")).toBeNull();
    // 最小化不改最大化状态：回来以后仍是最大化（与写信窗口一致）
    expect(dialog().className).toContain("compose-expanded");
  });

  it("点窗口外面既不收起也不关闭（与写信窗口的关键差别）", async () => {
    await pointer(document.body, "pointerdown", 4, 4);
    await pointer(document.body, "pointerup", 4, 4);
    expect(document.querySelector(".mail-window")).toBeTruthy();
    expect(dialog().className).not.toContain("compose-minimized");
    expect(document.querySelector(".compose-restore-bar")).toBeNull();
    expect(closed).toBe(false);
  });

  it("红点关闭回调 onClose", async () => {
    await click("关闭阅读窗口");
    expect(closed).toBe(true);
  });

  it("第二扇窗按阶梯错开，不会叠在第一扇上", async () => {
    await renderWindow(1);
    const width = Math.min(Math.max(window.innerWidth - 360, 640), 980);
    expect(dialog().className).toContain("compose-floating");
    expect(style("--compose-width")).toBe(`${width}px`);
    expect(style("--compose-left")).toBe(
      `${(window.innerWidth - width) / 2 + 28}px`,
    );
  });
});
