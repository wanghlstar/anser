// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { mailDocumentHeight } from "../lib/mail-layout";
import { MailContent } from "./mail-content";

// WebKit 在禁止脚本的沙箱帧里会静默丢弃帧内事件监听器：少了 allow-scripts，
// 图片点选蓝框、双击打开、自研右键菜单、⌘C 复制会一起失灵。
describe("mail body sandbox", () => {
  let root: Root;
  let host: HTMLDivElement;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });
  it("runs the frame with scripts so frame listeners still fire", async () => {
    await act(async () => {
      root.render(<MailContent html="<p>正文</p>" onOpenLink={() => {}} />);
    });
    expect(host.querySelector("iframe")?.getAttribute("sandbox")).toBe(
      "allow-same-origin allow-scripts",
    );
  });
});

function layout(top: number, height: number, contentBottom: number) {
  const doc = document.implementation.createHTMLDocument("邮件布局");
  vi.spyOn(doc.body, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, top, 700, height),
  );
  Object.defineProperty(doc.body, "scrollHeight", {
    value: height,
    configurable: true,
  });
  Object.defineProperty(doc.documentElement, "scrollHeight", { value: 2000 });
  vi.spyOn(doc, "createRange").mockReturnValue({
    selectNodeContents: vi.fn(),
    getBoundingClientRect: () => new DOMRect(0, top, 700, contentBottom - top),
  } as unknown as Range);
  return doc;
}

describe("HTML mail content height", () => {
  it("includes the collapsed top margin that previously cut off the footer", () => {
    expect(mailDocumentHeight(layout(40, 472, 512))).toBe(514);
  });
  it("includes content extending beyond the body's normal box", () => {
    expect(mailDocumentHeight(layout(0, 200, 900))).toBe(902);
  });
  it("shrinks after wider content reflows rather than keeping the old iframe viewport height", () => {
    expect(mailDocumentHeight(layout(0, 1200, 1200))).toBe(1202);
    expect(mailDocumentHeight(layout(0, 400, 400))).toBe(402);
  });
  it("reserves space for a horizontal scrollbar on fixed-width email templates", () => {
    const doc = layout(40, 472, 512);
    Object.defineProperties(doc.documentElement, {
      scrollWidth: { value: 685 },
      clientWidth: { value: 400 },
      clientHeight: { value: 785 },
    });
    Object.defineProperty(doc, "defaultView", {
      value: {
        innerHeight: 800,
        scrollY: 0,
        getComputedStyle: () => ({ marginBottom: "0" }),
      },
    });
    expect(mailDocumentHeight(doc)).toBe(529);
  });
});
