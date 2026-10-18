// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComposeWindow } from "./compose-window";
import { enterDemo, leaveDemo, newDraft, snapshot } from "@/lib/api";
import type { Account, Compose } from "@/lib/types";

// 原生运行时在 jsdom 里不存在：窗口反查（invoke）与事件（listen/emitTo）都换成替身。
const { invoke, emitTo, listeners } = vi.hoisted(() => ({
  invoke: vi.fn(),
  emitTo: vi.fn(),
  listeners: new Map<string, () => void>(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => false }));
vi.mock("@tauri-apps/api/event", () => ({
  emitTo,
  listen: (event: string, handler: () => void) => {
    listeners.set(event, handler);
    return Promise.resolve(() => listeners.delete(event));
  },
}));

let root: Root;
let host: HTMLDivElement;
let accounts: Account[];
let draft: Compose;

async function render(label: string) {
  await act(async () => {
    root.render(<ComposeWindow key={label} label={label} />);
  });
}
async function closeRequest() {
  // Rust 侧发来的是 compose-window-close（与主窗口收的 compose-close-requested 分开，
  // 避免两边同名事件跨窗互相触发）。
  await act(async () => listeners.get("compose-window-close")?.());
}
async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (e) => e.textContent?.trim() === label,
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
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
  vi.clearAllMocks();
  listeners.clear();
  enterDemo();
  const data = await snapshot({
    view: "all",
    accountId: "",
    folder: "",
    search: "",
    limit: 100,
    unreadOnly: false,
  });
  accounts = data.accounts;
  draft = {
    ...newDraft(accounts[0].id),
    to: "boss@example.com",
    subject: "季度汇报",
  };
  invoke.mockImplementation((command: string) =>
    Promise.resolve(
      command === "compose_window_draft" ? { draft, accounts } : undefined,
    ),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await render("compose-window-0");
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  leaveDemo();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("compose window", () => {
  it("按自己的窗口 label 反查草稿，并渲染主题与收件人", async () => {
    expect(invoke).toHaveBeenCalledWith("compose_window_draft", {
      label: "compose-window-0",
    });
    await vi.waitFor(() =>
      expect(document.querySelector(".compose-dialog")).toBeTruthy(),
    );
    const values = () =>
      [...document.querySelectorAll("input")].map((e) => e.value);
    await vi.waitFor(() => {
      expect(values()).toContain("boss@example.com");
      expect(values()).toContain("季度汇报");
    });
  });
  it("原生窗口里不再画自绘三灯与缩放手柄，窗口壳交给系统", async () => {
    await vi.waitFor(() =>
      expect(document.querySelector(".compose-dialog")).toBeTruthy(),
    );
    expect(document.querySelector(".compose-dialog")!.className).toContain(
      "compose-native",
    );
    expect(document.querySelector(".compose-lights")).toBeNull();
    expect(document.querySelector(".compose-resize-handle")).toBeNull();
  });
  it("有内容时 ⌘W 先问「保存 / 不保存 / 取消」，确认后才关窗", async () => {
    await vi.waitFor(() =>
      expect(document.querySelector(".compose-dialog")).toBeTruthy(),
    );
    await closeRequest();
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("保存这封邮件的草稿？"),
    );
    expect(invoke).not.toHaveBeenCalledWith(
      "close_compose_window",
      expect.anything(),
    );
    await click("不保存");
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("close_compose_window", {
        label: "compose-window-0",
      }),
    );
  });
  it("空白草稿的 ⌘W 直接关窗，不留草稿", async () => {
    draft = newDraft(accounts[0].id);
    await render("compose-window-1");
    await closeRequest();
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("close_compose_window", {
        label: "compose-window-1",
      }),
    );
  });
  it("查不到对应草稿时给出提示", async () => {
    invoke.mockResolvedValue(null);
    await render("compose-window-9");
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("写信窗口打不开"),
    );
    expect(document.body.textContent).toContain("这扇窗口没有对应的草稿");
  });
});
