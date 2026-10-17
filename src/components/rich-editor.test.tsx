// @vitest-environment jsdom
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { RichEditor } from "./rich-editor";
import { FONT_OPTIONS } from "@/lib/fonts";
import { toast } from "sonner";
const mode = vi.hoisted(() => ({ demo: false }));
vi.mock("@/lib/api", () => ({ native: true, isDemo: () => mode.demo }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn() } }));
const picker = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => picker);
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=";
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  Range.prototype.getBoundingClientRect = () => ({
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON() {},
  });
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
    setTimeout(cb, 0),
  );
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mode.demo = false;
  vi.clearAllMocks();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function paste() {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      getData: () => "",
      files: [
        new File(
          [Uint8Array.from(atob(png), (c) => c.charCodeAt(0))],
          "paste.png",
          { type: "image/png" },
        ),
      ],
    },
  });
  await act(async () =>
    document.querySelector(".rich-body")!.dispatchEvent(event),
  );
}
it("pastes raster bytes into editable body, reports preparation and preserves formatting", async () => {
  const change = vi.fn(),
    busy = vi.fn();
  await act(async () =>
    root.render(
      <RichEditor
        body=""
        html={
          '<p><span style="font-family:SimSun;font-size:18pt">正文</span></p>'
        }
        disabled={false}
        onChange={change}
        onBusy={busy}
        readImages={vi.fn()}
      />,
    ),
  );
  await paste();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  expect(vi.mocked(toast.error).mock.calls).toEqual([]);
  expect(busy.mock.calls.map((call) => call[0])).toEqual([true, false]);
  expect(change.mock.calls.at(-1)?.[1]).toContain(png);
  await vi.waitFor(() =>
    expect(
      document.querySelector(".rich-body img[src]")?.getAttribute("src"),
    ).toContain(png),
  );
  const html = change.mock.calls.at(-1)![1];
  expect(html).toContain(png);
  expect(html).toContain("18pt");
  expect(html).toContain("font-family");
  expect(
    document.querySelector(".rich-body img[src]")?.getAttribute("src"),
  ).toContain(png);
  expect(busy.mock.calls.map((call) => call[0])).toEqual([true, false]);
});
it("inserts from native picker once and drops late results after editor closes", async () => {
  picker.open.mockResolvedValue(["/tmp/fictional.png"]);
  let resolve!: (value: { src: string; name: string }[]) => void;
  const read = vi.fn(
      () =>
        new Promise<{ src: string; name: string }[]>((done) => {
          resolve = done;
        }),
    ),
    change = vi.fn(),
    busy = vi.fn();
  await act(async () =>
    root.render(
      <RichEditor
        body=""
        html=""
        disabled={false}
        onChange={change}
        onBusy={busy}
        readImages={read}
      />,
    ),
  );
  await act(async () =>
    (
      document.querySelector('button[aria-label="插入正文图片"]') as HTMLElement
    ).click(),
  );
  await vi.waitFor(() =>
    expect(read).toHaveBeenCalledWith(["/tmp/fictional.png"]),
  );
  expect(busy).toHaveBeenCalledWith(true);
  await act(async () => root.render(null));
  await act(async () =>
    resolve([{ src: `data:image/png;base64,${png}`, name: "fictional.png" }]),
  );
  expect(change).not.toHaveBeenCalled();
  expect(busy).toHaveBeenLastCalledWith(false);
});
it("preview rejects real clipboard files and disables the native image picker", async () => {
  mode.demo = true;
  const change = vi.fn(),
    read = vi.fn();
  await act(async () =>
    root.render(
      <RichEditor
        body=""
        html=""
        disabled={false}
        onChange={change}
        onBusy={vi.fn()}
        readImages={read}
      />,
    ),
  );
  await paste();
  expect(change).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
  expect(toast.info).toHaveBeenCalled();
  expect(
    (
      document.querySelector(
        'button[aria-label="插入正文图片"]',
      ) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});

it("right-clicks only the target image, locks proportions, supports independent sizes and cancel", async () => {
  const change = vi.fn();
  await act(async () =>
    root.render(
      <RichEditor
        body=""
        html={`<p><img src="data:image/png;base64,${png}" width="800" height="400"><img src="data:image/png;base64,${png}" width="200" height="100"></p>`}
        disabled={false}
        onChange={change}
        onBusy={vi.fn()}
        readImages={vi.fn()}
      />,
    ),
  );
  const context = async () => {
    await act(async () =>
      document.querySelector(".rich-body img[src]")!.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 20,
          clientY: 20,
        }),
      ),
    );
    const item = [...document.querySelectorAll('[role="menuitem"]')].find(
      (e) => e.textContent?.trim() === "调整图片尺寸",
    ) as HTMLElement;
    expect(item).toBeTruthy();
    await act(async () => item.click());
  };
  const field = async (id: string, value: string) => {
    await act(async () => {
      const input = document.getElementById(id) as HTMLInputElement;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  await context();
  await field("rich-image-width", "300");
  expect(
    (document.getElementById("rich-image-height") as HTMLInputElement).value,
  ).toBe("150");
  await act(async () =>
    (document.getElementById("rich-image-proportion") as HTMLElement).click(),
  );
  await field("rich-image-height", "80");
  await act(async () =>
    document
      .getElementById("rich-image-width")!
      .closest("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  const images = document.querySelectorAll(".rich-body img[src]");
  expect(images[0].getAttribute("width")).toBe("300");
  expect(images[0].getAttribute("height")).toBe("80");
  expect(images[1].getAttribute("width")).toBe("200");
  expect(change.mock.calls.at(-1)?.[1]).toContain('height="80"');
  await context();
  await field("rich-image-width", "100");
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  expect(
    document.querySelector(".rich-body img[src]")?.getAttribute("width"),
  ).toBe("300");
});

it("inserts the greeting as the first editable paragraph in its configured style", async () => {
  const greeting = {
    text: "您好：",
    fontFamily: FONT_OPTIONS[1].stack,
    fontSize: "16pt",
  };
  await act(async () =>
    root.render(
      <RichEditor
        body=""
        html=""
        disabled={false}
        onChange={() => {}}
        onBusy={vi.fn()}
        readImages={vi.fn()}
        greeting={greeting}
      />,
    ),
  );
  await vi.waitFor(() =>
    expect(document.querySelectorAll(".rich-body p").length).toBe(2),
  );
  const paragraphs = document.querySelectorAll(".rich-body p");
  expect(paragraphs[0].textContent).toBe("您好：");
  expect(paragraphs[0].getAttribute("data-yanxin-greeting")).toBe("true");
  expect(paragraphs[0].innerHTML).toContain(
    `font-family: ${FONT_OPTIONS[1].label}`,
  );
  expect(paragraphs[0].innerHTML).toContain("font-size: 16pt");
  // 第二段带真实全角空格：所见即所得，缩进会随邮件发出
  expect(paragraphs[1].textContent).toBe("　　");
  expect(paragraphs[1].getAttribute("data-yanxin-indented")).toBe("true");
});

it("leaves an existing body alone instead of greeting it again", async () => {
  await act(async () =>
    root.render(
      <RichEditor
        body="正文内容"
        html=""
        disabled={false}
        onChange={() => {}}
        onBusy={vi.fn()}
        readImages={vi.fn()}
        greeting={{ text: "您好：", fontFamily: null, fontSize: null }}
      />,
    ),
  );
  await vi.waitFor(() =>
    expect(document.querySelector(".rich-body p")?.textContent).toBe(
      "正文内容",
    ),
  );
  expect(document.querySelector(".rich-body")!.textContent).not.toContain(
    "您好：",
  );
});

async function checkedMenuItem(label: string, open: string) {
  await act(async () => {
    (
      document.querySelector(`button[aria-label="${open}"]`) as HTMLElement
    ).dispatchEvent(
      new MouseEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
      }),
    );
  });
  await vi.waitFor(() =>
    expect(document.querySelector('[role="menuitemradio"]')).toBeTruthy(),
  );
  const item = [...document.querySelectorAll('[role="menuitemradio"]')].find(
    (node) => node.textContent?.trim() === label,
  );
  expect(item).toBeTruthy();
  return item!.getAttribute("data-state");
}

it("shows 仿宋/14pt defaults and matches a quoted font stack in the toolbar", async () => {
  await act(async () =>
    root.render(
      <RichEditor
        body=""
        html=""
        disabled={false}
        onChange={() => {}}
        onBusy={vi.fn()}
        readImages={vi.fn()}
      />,
    ),
  );
  await vi.waitFor(() =>
    expect(document.querySelector(".rich-body")).toBeTruthy(),
  );
  expect(await checkedMenuItem("默认字体（仿宋）", "正文字体")).toBe("checked");
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  expect(await checkedMenuItem("14pt", "正文字号")).toBe("checked");
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  await act(async () =>
    root.render(
      <RichEditor
        key="quoted-stack"
        body=""
        html={
          '<p><span style="font-family: 楷体, KaiTi, STKaiti; font-size:16pt;">楷体正文</span></p>'
        }
        disabled={false}
        onChange={() => {}}
        onBusy={vi.fn()}
        readImages={vi.fn()}
      />,
    ),
  );
  await vi.waitFor(() =>
    expect(document.querySelector(".rich-body")?.textContent).toContain(
      "楷体正文",
    ),
  );
  expect(await checkedMenuItem("楷体", "正文字体")).toBe("checked");
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  expect(await checkedMenuItem("16pt", "正文字号")).toBe("checked");
});

it("registers copied files as attachments instead of inserting them into the body", async () => {
  const attach = vi.fn(),
    change = vi.fn();
  await act(async () =>
    root.render(
      <RichEditor
        body=""
        html=""
        disabled={false}
        onChange={change}
        onBusy={vi.fn()}
        readImages={vi.fn()}
        onAttachFiles={attach}
      />,
    ),
  );
  await vi.waitFor(() =>
    expect(document.querySelector(".rich-body")).toBeTruthy(),
  );
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      files: [],
      getData: (type: string) =>
        type === "text/uri-list" ? "file:///tmp/contract.pdf" : "",
    },
  });
  await act(async () =>
    document.querySelector(".rich-body")!.dispatchEvent(event),
  );
  expect(event.defaultPrevented).toBe(true);
  expect(attach).toHaveBeenCalledWith(["/tmp/contract.pdf"]);
  expect(change).not.toHaveBeenCalled();
  expect(document.querySelector(".rich-body img[src]")).toBeNull();
});
