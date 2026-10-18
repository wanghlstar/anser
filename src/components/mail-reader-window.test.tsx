// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MailReaderWindow } from "./mail-reader-window";
import { enterDemo, leaveDemo, snapshot } from "@/lib/api";
import { parseAddresses } from "@/lib/addresses";
import type { Mail } from "@/lib/types";

// 原生运行时在 jsdom 里不存在：窗口反查（invoke）与回传动作（emitTo）都换成替身。
const { invoke, emitTo } = vi.hoisted(() => ({
  invoke: vi.fn(),
  emitTo: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => false }));
vi.mock("@tauri-apps/api/event", () => ({ emitTo, listen: vi.fn() }));

let root: Root;
let host: HTMLDivElement;
let mail: Mail;

async function render(label: string) {
  await act(async () =>
    root.render(<MailReaderWindow key={label} label={label} />),
  );
}
async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (e) =>
      e.textContent?.trim() === label || e.getAttribute("aria-label") === label,
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
  invoke.mockResolvedValue(mail.id);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await render("mail-window-0");
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  leaveDemo();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("mail reader window", () => {
  it("按自己的窗口 label 反查邮件，并渲染主题、发件人与正文", async () => {
    expect(invoke).toHaveBeenCalledWith("mail_window_mail", {
      label: "mail-window-0",
    });
    await vi.waitFor(() =>
      expect(document.querySelector(".mail-reader-title")?.textContent).toBe(
        mail.subject,
      ),
    );
    const byline = document.querySelector(".mail-reader-byline")?.textContent;
    expect(byline).toContain(parseAddresses(mail.sender)[0].email);
    // 演示模式没有 MIME 正文（html 为空），窗口回落到纯文本，正文片段应出现在窗口里。
    const snippet = mail.body
      .split("\n")
      .find((line) => line.trim())!
      .trim()
      .slice(0, 6);
    expect(document.querySelector(".mail-reader")?.textContent).toContain(
      snippet,
    );
  });
  it("把回复 / 转发 / 导出原始邮件发回主窗口处理", async () => {
    await vi.waitFor(() =>
      expect(document.querySelector(".mail-reader-title")?.textContent).toBe(
        mail.subject,
      ),
    );
    await click("回复");
    expect(emitTo).toHaveBeenCalledWith("main", "mail-window-action", {
      action: "reply",
      id: mail.id,
    });
    await click("全部回复");
    expect(emitTo).toHaveBeenCalledWith("main", "mail-window-action", {
      action: "reply-all",
      id: mail.id,
    });
    await click("转发");
    expect(emitTo).toHaveBeenCalledWith("main", "mail-window-action", {
      action: "forward",
      id: mail.id,
    });
    await click("导出原始邮件");
    expect(emitTo).toHaveBeenCalledWith("main", "mail-window-action", {
      action: "export",
      id: mail.id,
    });
  });
  it("查不到对应邮件时给出提示与重新加载", async () => {
    invoke.mockResolvedValue(null);
    await render("mail-window-9");
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("正文加载失败"),
    );
    expect(document.body.textContent).toContain("这扇窗口没有对应的邮件");
    expect(await click("重新加载")).toBeUndefined();
  });
});
