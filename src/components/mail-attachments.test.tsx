// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { MailAttachments } from "./mail-attachments";
import { call } from "../lib/api";
import { toast } from "sonner";
vi.mock("../lib/api", () => ({ native: true, call: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));
let root: Root, host: HTMLDivElement;
const attachments = [
  { index: 4, name: "合同.pdf", size: 1200, mime: "application/pdf" },
];
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.clearAllMocks();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const card = (index: number) =>
  host.querySelector<HTMLElement>(`[data-attachment-index="${index}"]`)!;
const download = (name: string) =>
  host.querySelector<HTMLButtonElement>(
    `button[aria-label="下载附件 ${name}"]`,
  )!;

it("selects on click and opens with a double click or the spacebar", async () => {
  vi.mocked(call).mockResolvedValue(undefined);
  await act(async () =>
    root.render(
      <MailAttachments
        mailId="selected-message"
        attachments={attachments}
        onDownload={async () => {}}
      />,
    ),
  );
  await act(async () => card(4).click());
  expect(card(4).dataset.selected).toBe("true");
  expect(call).not.toHaveBeenCalled();
  card(4).focus();
  await act(async () =>
    card(4).dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true }),
    ),
  );
  expect(call).toHaveBeenCalledExactlyOnceWith("preview_attachment", {
    id: "selected-message",
    index: 4,
  });
});

it("keeps Save As a separate action", async () => {
  const save = vi.fn(async () => {});
  vi.mocked(call).mockResolvedValue(undefined);
  await act(async () =>
    root.render(
      <MailAttachments
        mailId="selected-message"
        attachments={attachments}
        onDownload={save}
      />,
    ),
  );
  await act(async () => download("合同.pdf").click());
  expect(save).toHaveBeenCalledExactlyOnceWith(4, "合同.pdf");
  expect(call).not.toHaveBeenCalled();
});

it("prevents duplicate opens while loading and lets the user retry after an error", async () => {
  let reject!: (error: Error) => void;
  vi.mocked(call).mockImplementation(
    () =>
      new Promise((_, r) => {
        reject = r;
      }),
  );
  await act(async () =>
    root.render(
      <MailAttachments
        mailId="thread-message"
        attachments={attachments}
        onDownload={async () => {}}
      />,
    ),
  );
  await act(async () =>
    card(4).dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true }),
    ),
  );
  expect(host.querySelector('[role="status"]')?.textContent).toContain(
    "正在打开",
  );
  await act(async () =>
    card(4).dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true }),
    ),
  );
  expect(call).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error("没有对应应用")));
  expect(toast.error).toHaveBeenCalledWith("Error: 没有对应应用");
  vi.mocked(call).mockResolvedValue(undefined);
  await act(async () =>
    card(4).dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true }),
    ),
  );
  expect(call).toHaveBeenCalledTimes(2);
});

it("does not open a damaged attachment or invoke native commands from demo data", async () => {
  await act(async () =>
    root.render(
      <MailAttachments
        mailId="demo-mail"
        demo
        attachments={[
          ...attachments,
          {
            ...attachments[0],
            index: 5,
            name: "损坏.pdf",
            error: "Base64 编码异常",
          },
        ]}
        onDownload={async () => {}}
      />,
    ),
  );
  expect(card(5).dataset.error).toBeUndefined();
  expect(host.textContent).toContain("附件编码异常");
  await act(async () =>
    card(4).dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true }),
    ),
  );
  expect(call).not.toHaveBeenCalled();
  expect(toast.info).toHaveBeenCalled();
});

it("extends the selection with meta and shift like Foxmail", async () => {
  vi.mocked(call).mockResolvedValue(undefined);
  const list = [
    ...attachments,
    { index: 5, name: "报表.pdf", size: 200, mime: "application/pdf" },
    { index: 6, name: "图.png", size: 300, mime: "image/png" },
  ];
  await act(async () =>
    root.render(
      <MailAttachments
        mailId="multi"
        attachments={list}
        onDownload={async () => {}}
      />,
    ),
  );
  await act(async () => card(4).click());
  await act(async () =>
    card(6).dispatchEvent(
      new MouseEvent("click", { metaKey: true, bubbles: true }),
    ),
  );
  expect([4, 5, 6].map((i) => card(i).dataset.selected)).toEqual([
    "true",
    "false",
    "true",
  ]);
  // ⇧ 以单选锚点（4）为基准扩展到 5，不是接着上一次的 ⌘ 点选。
  await act(async () =>
    card(5).dispatchEvent(
      new MouseEvent("click", { shiftKey: true, bubbles: true }),
    ),
  );
  expect([4, 5, 6].map((i) => card(i).dataset.selected)).toEqual([
    "true",
    "true",
    "false",
  ]);
});

it("copies the selected attachments to the clipboard", async () => {
  vi.mocked(call).mockResolvedValue(undefined);
  const list = [
    ...attachments,
    { index: 5, name: "报表.pdf", size: 200, mime: "application/pdf" },
  ];
  await act(async () =>
    root.render(
      <MailAttachments
        mailId="multi"
        attachments={list}
        onDownload={async () => {}}
      />,
    ),
  );
  await act(async () => card(4).click());
  await act(async () =>
    card(5).dispatchEvent(
      new MouseEvent("click", { metaKey: true, bubbles: true }),
    ),
  );
  card(5).focus();
  await act(async () =>
    card(5).dispatchEvent(
      new KeyboardEvent("keydown", { key: "c", metaKey: true, bubbles: true }),
    ),
  );
  expect(call).toHaveBeenCalledWith("copy_mail_attachments", {
    id: "multi",
    indexes: [4, 5],
  });
  expect(toast.success).toHaveBeenCalled();
});

it("clears the selection when the click lands outside the attachment strip", async () => {
  await act(async () =>
    root.render(
      <MailAttachments
        mailId="selected-message"
        attachments={attachments}
        onDownload={async () => {}}
      />,
    ),
  );
  await act(async () => card(4).click());
  expect(card(4).dataset.selected).toBe("true");
  const outside = document.createElement("p");
  document.body.append(outside);
  await act(async () =>
    outside.dispatchEvent(new Event("pointerdown", { bubbles: true })),
  );
  expect(card(4).dataset.selected).toBe("false");
  outside.remove();
});

it("clears the selection with Escape and when the focus enters the message body", async () => {
  await act(async () =>
    root.render(
      <MailAttachments
        mailId="selected-message"
        attachments={attachments}
        onDownload={async () => {}}
      />,
    ),
  );
  await act(async () => card(4).click());
  expect(card(4).dataset.selected).toBe("true");
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
  );
  expect(card(4).dataset.selected).toBe("false");
  await act(async () => card(4).click());
  expect(card(4).dataset.selected).toBe("true");
  // 点进正文 iframe：焦点落到 frame，window 收到 blur。
  const frame = document.createElement("iframe");
  document.body.append(frame);
  frame.focus();
  await act(async () => window.dispatchEvent(new Event("blur")));
  expect(card(4).dataset.selected).toBe("false");
  frame.remove();
});
