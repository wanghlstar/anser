// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { ComposeDialog } from "./compose-dialog";
import * as api from "@/lib/api";
import { toast } from "sonner";
import { call, enterDemo, leaveDemo, newDraft, snapshot } from "@/lib/api";
import type { Account, Compose, OutboxRecord } from "@/lib/types";
import { localDateTime } from "@/lib/schedule-time";
let root: Root, host: HTMLDivElement;
let seed: Compose;
let accounts: Account[];
let renderHarness: () => Promise<void>;
async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (e) =>
      e.textContent?.trim() === label || e.getAttribute("aria-label") === label,
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
// 关闭有内容的写信窗口会先问「保存 / 不保存 / 取消」，选「保存」再关。
async function closeSaving() {
  await click("保存草稿并关闭");
  await click("保存");
}
async function input(selector: string, value: string) {
  const e = document.querySelector(selector) as HTMLInputElement;
  await act(async () => {
    const prototype =
      e.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(e, value);
    e.dispatchEvent(new Event("input", { bubbles: true }));
    e.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
// 富文本编辑器是 contenteditable，jsdom 里用 DOM 变更 + selectionchange 让 ProseMirror 读回输入。
async function richBody(value: string) {
  const editor = await bodyEditor();
  await act(async () => {
    const paragraph = editor.querySelector("p") ?? editor;
    paragraph.replaceChildren(document.createTextNode(value));
    editor.ownerDocument.dispatchEvent(new Event("selectionchange"));
  });
}
// 富文本编辑器懒加载，等待它替换掉 Suspense 占位。
async function bodyEditor() {
  let element: Element | null = null;
  await vi.waitFor(async () => {
    await act(async () => {});
    element = document.querySelector('[aria-label="邮件正文"]');
    expect(element).toBeTruthy();
  });
  await act(async () => {});
  return element as unknown as HTMLElement;
}
async function format(value: string) {
  await act(async () => {
    document
      .querySelector('button[aria-label="正文格式"]')!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
  });
  const labels: Record<string, string> = {
    rich: "富文本",
    markdown: "Markdown",
    html: "HTML 源码",
  };
  const item = [...document.querySelectorAll('[role="option"]')].find((e) =>
    e.textContent?.includes(labels[value]),
  );
  expect(item).toBeTruthy();
  await act(async () => (item as HTMLElement).click());
}
// DOM 顺序断言：earlier 必须出现在 later 之前
function follows(earlier: Element, later: Element) {
  expect(
    earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  // 预加载懒加载的富文本编辑器，让 Suspense 只在 act 作用域内解析。
  await act(async () => {
    await import("./rich-editor");
  });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
    setTimeout(cb, 16),
  );
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
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
  seed = {
    ...newDraft(data.accounts[0].id),
    to: "receiver@example.com",
    subject: "Source test",
  };
  accounts = data.accounts;
  function Harness() {
    const [draft, setDraft] = useState<Compose | null>(seed);
    return (
      <ComposeDialog
        draft={draft}
        accounts={data.accounts}
        onClose={() => setDraft(null)}
        onSent={() => {}}
      />
    );
  }
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  renderHarness = async () => {
    await act(async () => root.render(<Harness key={seed.id} />));
    // 富文本编辑器懒加载：等它挂载，避免后续状态更新落在 act 之外。
    await bodyEditor();
  };
  await renderHarness();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  leaveDemo();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("compose formats and scheduling", () => {
  it("renders original separately, previews delivery, and saves the include-original choice", async () => {
    seed = {
      ...seed,
      id: "quote-test",
      body: "新写内容",
      quote: {
        kind: "forward",
        included: true,
        sender: "lin@example.com",
        recipients: "me@example.com",
        date: "2026-10-01T10:00:00Z",
        subject: "Report",
        body: "Original",
        html: '<style>.report td{color:red}</style><table class="report"><tr><td>Original</td></tr></table>',
      },
    };
    await renderHarness();
    expect((await bodyEditor()).textContent).toBe("新写内容");
    expect(
      document
        .querySelector('iframe[title="引用原文"]')
        ?.getAttribute("srcdoc"),
    ).toContain('<table class="report">');
    await click("发送预览");
    expect(
      document
        .querySelector('iframe[title="发送效果预览正文"]')
        ?.getAttribute("srcdoc"),
    ).toContain("新写内容");
    expect(
      document
        .querySelector('iframe[title="发送效果预览正文"]')
        ?.getAttribute("srcdoc"),
    ).toContain("Original");
    await act(async () =>
      (
        document.querySelector(
          '.delivery-preview-dialog button[data-slot="dialog-close"]',
        ) as HTMLButtonElement
      ).click(),
    );
    const toggle = document.querySelector(
      '[role="switch"]',
    ) as HTMLButtonElement;
    await act(async () => toggle.click());
    expect(document.querySelector('iframe[title="引用原文"]')).toBeNull();
    await click("发送预览");
    expect(
      document
        .querySelector('iframe[title="发送效果预览正文"]')
        ?.getAttribute("srcdoc"),
    ).not.toContain("Original");
    await act(async () =>
      (
        document.querySelector(
          '.delivery-preview-dialog button[data-slot="dialog-close"]',
        ) as HTMLButtonElement
      ).click(),
    );
    await closeSaving();
    const saved = (await call<Compose[]>("list_drafts"))[0];
    expect(saved.quote?.included).toBe(false);
    expect(saved.quote?.html).toContain("<table");
    expect(saved.body).toBe("新写内容");
  });
  it("can maximize and restore without losing typed content", async () => {
    await richBody("Still here");
    await click("最大化写信窗口");
    expect(document.querySelector(".compose-expanded")).toBeTruthy();
    await click("还原写信窗口");
    expect(document.querySelector(".compose-expanded")).toBeNull();
    expect((await bodyEditor()).textContent).toBe("Still here");
  });
  it("saves Markdown source and preview, reopens without switching to rich text", async () => {
    await format("markdown");
    await input(
      'textarea[aria-label="Markdown 源码"]',
      "# Heading\n\n**bold**",
    );
    expect(
      document
        .querySelector('iframe[title="写信正文预览"]')
        ?.getAttribute("srcdoc"),
    ).toContain("<strong>bold</strong>");
    await closeSaving();
    const drafts = await call<Compose[]>("list_drafts");
    expect(drafts[0].format).toBe("markdown");
    expect(drafts[0].source).toContain("**bold**");
    expect(drafts[0].body).not.toContain("**");
  });
  it("offers rich text as the default body mode without a plain text option", async () => {
    await act(async () => {
      document
        .querySelector('button[aria-label="正文格式"]')!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
        );
    });
    expect(
      [...document.querySelectorAll('[role="option"]')].map((e) =>
        e.textContent?.trim(),
      ),
    ).toEqual(["富文本", "Markdown", "HTML 源码"]);
    expect(document.querySelector(".rich-editor")).toBeTruthy();
    expect(
      document.querySelector('textarea[aria-label="邮件正文"]'),
    ).toBeNull();
  });
  it("merges the format controls into the editor toolbar in rich text mode", async () => {
    // 富文本是默认模式：格式/预览/导入控件并入编辑器工具条，独立格式栏消失
    expect(document.querySelector(".compose-format")).toBeNull();
    expect(
      document
        .querySelector('button[aria-label="正文格式"]')!
        .closest(".format-toolbar"),
    ).toBeTruthy();
    await format("markdown");
    const formatBar = document.querySelector(".compose-format");
    expect(formatBar).toBeTruthy();
    expect(
      formatBar!.querySelector('button[aria-label="正文格式"]'),
    ).toBeTruthy();
  });
  it("expands 密送 on click and folds it back with 收起密送", async () => {
    // 抄送常显，密送默认收起；展开后必须能再收回去（哪怕已经填了地址）。
    const bccRow = () =>
      document.querySelector("#bcc")?.closest(".compose-row");
    expect(document.querySelector("#cc")?.closest(".compose-row")).toBeTruthy();
    expect(bccRow()).toBeFalsy();
    await click("密送");
    expect(bccRow()).toBeTruthy();
    await input("#bcc", "hidden@example.com");
    await click("收起密送");
    expect(bccRow()).toBeFalsy();
  });
  it("creates a frozen demo plan and cancellation returns a new editable draft", async () => {
    seed = {
      ...seed,
      id: "scheduled-quote",
      quote: {
        kind: "forward",
        included: true,
        sender: "lin@example.com",
        recipients: "",
        date: "2026-10-01T10:00:00Z",
        subject: "Report",
        body: "original quote",
        html: "<p>original quote</p>",
      },
    };
    await renderHarness();
    await format("html");
    await input(
      'textarea[aria-label="HTML 源码"]',
      "<style>td{color:red}</style><table><tr><td>planned</td></tr></table>",
    );
    await click("定时发送");
    const selectedTime = localDateTime(new Date(Date.now() + 86400000));
    await click("选择发送日期");
    const nextDay = new Date(selectedTime);
    const day = document.querySelector(
      `[data-day="${nextDay.toLocaleDateString()}"]`,
    ) as HTMLButtonElement;
    expect(day).toBeTruthy();
    await act(async () => day.click());
    for (const [label, time] of [
      ["发送小时", selectedTime.slice(11, 13)],
      ["发送分钟", selectedTime.slice(14, 16)],
    ]) {
      await act(async () => {
        document
          .querySelector(`button[aria-label="${label}"]`)!
          .dispatchEvent(
            new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
          );
      });
      const option = [...document.querySelectorAll('[role="option"]')].find(
        (e) => e.textContent?.trim() === time,
      );
      expect(option).toBeTruthy();
      await act(async () => (option as HTMLElement).click());
    }
    await click("确认定时发送");
    const records = await call<OutboxRecord[]>("list_outbox");
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("scheduled");
    expect(records[0].scheduledAt).toBe(new Date(selectedTime).toISOString());
    expect(records[0].draft.html).toContain("td{color:red}");
    expect(records[0].draft.deliveryHtml).toContain("original quote");
    expect(records[0].draft.html).not.toContain("original quote");
    expect(await call<Compose[]>("list_drafts")).toHaveLength(0);
    const restored = await call<Compose>("cancel_schedule", { id: seed.id });
    expect(restored.id).not.toBe(seed.id);
    expect(restored.source).toContain("<table>");
    expect(restored.quote?.included).toBe(true);
    expect(restored.quote?.html).toBe("<p>original quote</p>");
    expect((await call<OutboxRecord[]>("list_outbox"))[0].status).toBe(
      "cancelled",
    );
  });
});

it("names an empty subject after the pasted attachment file", async () => {
  seed = { ...seed, id: "paste-attachment", subject: "" };
  await renderHarness();
  const subject = document.querySelector<HTMLInputElement>("#subject")!;
  await act(async () => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: {
        files: [],
        getData: (type: string) =>
          type === "text/uri-list"
            ? "file:///Users/me/%E5%90%88%E5%90%8C.pdf"
            : "",
      },
    });
    subject.dispatchEvent(event);
  });
  expect(document.querySelector(".compose-attachments")?.textContent).toContain(
    "合同.pdf",
  );
  expect(subject.value).toBe("合同");
});
it("uses a shadcn confirmation for an empty subject and cancellation keeps the draft", async () => {
  seed = { ...seed, id: "empty-subject", subject: "" };
  await renderHarness();
  await click("定时发送");
  await click("确认定时发送");
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(
    "邮件主题为空",
  );
  const cancel = [
    ...document.querySelectorAll('[role="alertdialog"] button'),
  ].find(
    (button) => button.textContent?.trim() === "取消",
  ) as HTMLButtonElement;
  await act(async () => cancel.click());
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  expect(document.querySelector(".compose-dialog")).toBeTruthy();
  expect(document.body.textContent).not.toContain("撤销发送 · 8s");
});

describe("signature composition", () => {
  it("loads the account signature, saves a disabled choice and retains the draft snapshot", async () => {
    await call("save_mail_signature", {
      accountId: seed.accountId,
      signature: {
        enabled: true,
        useHtml: false,
        text: "Snapshot signature",
        fileName: "",
        fileText: "",
        fileHtml: "",
      },
    });
    seed = {
      ...seed,
      id: "signature-test",
      body: "正文内容",
      signature: undefined,
    };
    await renderHarness();
    expect(
      document.querySelector('[aria-label="本封邮件签名"]')?.textContent,
    ).toContain("Snapshot signature");
    await act(async () =>
      (
        document.querySelector(
          '[id^="include-signature-"]',
        ) as HTMLButtonElement
      ).click(),
    );
    await closeSaving();
    const saved = (await call<Compose[]>("list_drafts")).find(
      (d) => d.id === seed.id,
    )!;
    expect(saved.body).toBe(seed.body);
    expect(saved.signature?.included).toBe(false);
    expect(saved.signature?.body).toBe("Snapshot signature");
    await call("save_mail_signature", {
      accountId: seed.accountId,
      signature: {
        enabled: true,
        useHtml: false,
        text: "Changed settings",
        fileName: "",
        fileText: "",
        fileHtml: "",
      },
    });
    seed = { ...saved, id: "signature-reopen" };
    await renderHarness();
    expect(document.querySelector('iframe[title="本封邮件签名"]')).toBeNull();
    await act(async () =>
      (
        document.querySelector(
          '[id^="include-signature-"]',
        ) as HTMLButtonElement
      ).click(),
    );
    const signaturePreview = () =>
      document.querySelector('[aria-label="本封邮件签名"]');
    expect(signaturePreview()?.textContent).toContain("Snapshot signature");
    expect(signaturePreview()?.textContent).not.toContain("Changed settings");
  });
});

describe("greeting in the body", () => {
  const greetingSeed = (id: string) => ({
    ...seed,
    id,
    body: "正文内容",
    signature: {
      accountId: seed.accountId,
      included: true,
      greeting: "您好：",
      greetingHtml: "",
      body: "祝您工作顺利",
      html: "",
    },
  });
  it("puts the account greeting into the editable body as its first line", async () => {
    seed = { ...greetingSeed("greeting-first-line"), body: "" };
    await renderHarness();
    // 问候语不再是正文上方的预览块，而是可编辑正文的第一行
    expect(document.querySelector('iframe[title="本封邮件问候语"]')).toBeNull();
    const body = (await bodyEditor()) as HTMLElement;
    expect(body.querySelectorAll("p")[0].textContent).toBe("您好：");
    expect(document.querySelector(".compose-editor")!.className).toContain(
      "with-signature",
    );
    follows(document.querySelector(".format-toolbar")!, body);
    // 签名预览与问候语同源：不用 iframe，直接作为编辑器下方连续的一部分。
    expect(
      document.querySelector('[aria-label="本封邮件签名"]')?.textContent,
    ).toContain("祝您工作顺利");
    expect(document.querySelector('iframe[title="本封邮件签名"]')).toBeNull();
  });
  it("keeps the greeting out of the way when the draft already has a body", async () => {
    seed = greetingSeed("greeting-existing-body");
    await renderHarness();
    expect((await bodyEditor()).textContent).toBe("正文内容");
    expect(document.querySelector('iframe[title="本封邮件问候语"]')).toBeNull();
  });
  it("puts the toolbar right under the subject row in rich text mode", async () => {
    seed = greetingSeed("greeting-toolbar-order");
    await renderHarness();
    const editor = document.querySelector(".compose-editor")!;
    const subjectRow = document
      .querySelector("#subject")!
      .closest(".compose-row")!;
    // 主题行之后直接进入正文区，工具条是其中的第一个元素
    expect(subjectRow.nextElementSibling).toBe(editor);
    expect(editor.querySelector(".compose-format")).toBeNull();
    const toolbar = document.querySelector(".format-toolbar")!;
    expect(toolbar.closest(".compose-editor")).toBe(editor);
    follows(subjectRow, toolbar);
    expect(editor.previousElementSibling).toBe(subjectRow);
  });
  it("leaves the greeting to send time in markdown mode", async () => {
    seed = {
      ...seed,
      id: "greeting-markdown",
      body: "正文内容",
      signature: {
        accountId: seed.accountId,
        included: true,
        greeting: "您好：",
        greetingHtml: "<p>您好：</p>",
        body: "祝您工作顺利",
        html: "",
      },
    };
    await renderHarness();
    await format("markdown");
    const editor = document.querySelector(".compose-editor")!;
    expect(document.querySelector('iframe[title="本封邮件问候语"]')).toBeNull();
    expect(document.querySelector(".rich-editor")).toBeNull();
    expect(
      (
        document.querySelector(
          'textarea[aria-label="Markdown 源码"]',
        ) as HTMLTextAreaElement
      ).value,
    ).toBe("正文内容");
    expect(
      document
        .querySelector(".compose-format")!
        .compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // 问候语不在编辑区，发送时才拼到正文之前
    await click("发送预览");
    expect(
      document
        .querySelector('iframe[title="发送效果预览正文"]')
        ?.getAttribute("srcdoc"),
    ).toContain("data-yanxin-greeting");
  });
  it("reads the HTML greeting snapshot into the first editable line", async () => {
    seed = {
      ...seed,
      id: "greeting-html",
      signature: {
        accountId: seed.accountId,
        included: true,
        greeting: "您好：",
        greetingHtml: "<p><b>尊敬的</b>同事：</p>",
        body: "落款",
        html: "",
      },
    };
    await renderHarness();
    expect((await bodyEditor()).querySelector("p")!.textContent).toBe(
      "尊敬的同事：",
    );
    expect(document.querySelector('iframe[title="本封邮件问候语"]')).toBeNull();
  });
  it("greets nothing when the account has none or it is switched off", async () => {
    seed = {
      ...seed,
      id: "greeting-none",
      signature: {
        accountId: seed.accountId,
        included: true,
        greeting: "",
        greetingHtml: "",
        body: "落款",
        html: "",
      },
    };
    await renderHarness();
    expect((await bodyEditor()).textContent).toBe("");
    expect(document.querySelector('iframe[title="本封邮件问候语"]')).toBeNull();
    seed = {
      ...seed,
      id: "greeting-off",
      signature: {
        accountId: seed.accountId,
        included: false,
        greeting: "您好：",
        greetingHtml: "",
        body: "落款",
        html: "",
      },
    };
    await renderHarness();
    expect((await bodyEditor()).textContent).toBe("");
    expect(document.querySelector('iframe[title="本封邮件问候语"]')).toBeNull();
    expect(document.querySelector(".compose-editor")?.className).not.toContain(
      "with-signature",
    );
  });
});

describe("empty drafts", () => {
  it("starts a blank rich body without a hard-break paragraph", async () => {
    seed = {
      ...newDraft(seed.accountId),
      id: "blank-rich-body",
      to: "",
      subject: "",
    };
    await renderHarness();
    const editor = await bodyEditor();
    const doc = (
      editor as unknown as {
        editor: {
          state: { doc: { firstChild: { content: { size: number } } } };
        };
      }
    ).editor.state.doc;
    expect(doc.firstChild.content.size).toBe(0);
  });
  it("never autosaves a new empty message with an automatic signature and discards it on close", async () => {
    seed = {
      ...newDraft(seed.accountId),
      id: "blank-new",
      signature: {
        accountId: seed.accountId,
        included: true,
        greeting: "",
        greetingHtml: "",
        body: "Automatic signature",
        html: "<p>Automatic signature</p>",
      },
    };
    await renderHarness();
    expect(document.body.textContent).toContain("空白邮件不会保存");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
    expect(await call<Compose[]>("list_drafts")).toEqual([]);
    await click("舍弃空白邮件");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(await call<Compose[]>("list_drafts")).toEqual([]);
  });
  it("still saves a message that only has a recipient", async () => {
    seed = {
      ...newDraft(seed.accountId),
      id: "recipient-only",
      to: "recipient@example.com",
    };
    await renderHarness();
    await closeSaving();
    expect(
      (await call<Compose[]>("list_drafts")).find((d) => d.id === seed.id)?.to,
    ).toBe("recipient@example.com");
  });
  it("waits for an in-flight autosave before deleting content that was cleared, so the draft cannot reappear", async () => {
    seed = { ...newDraft(seed.accountId), id: "blank-after-edit" };
    await renderHarness();
    const original = api.call;
    let finishSave!: () => Promise<void>;
    vi.spyOn(api, "call").mockImplementation(
      async <T,>(command: string, args: Record<string, unknown> = {}) => {
        if (command === "save_draft")
          return new Promise<T>((resolve) => {
            finishSave = async () => {
              const result = await original<T>(command, args);
              resolve(result);
            };
          });
        return original<T>(command, args);
      },
    );
    await richBody("Temporary content");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
    expect(finishSave).toBeTypeOf("function");
    await richBody("");
    await click("舍弃空白邮件");
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => finishSave());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
    expect(await call<Compose[]>("list_drafts")).toEqual([]);
  });
  it("keeps the editor open and reports a failure when empty-draft cleanup fails", async () => {
    seed = { ...newDraft(seed.accountId), id: "blank-delete-fails" };
    await renderHarness();
    const original = api.call;
    const error = vi.spyOn(toast, "error").mockReturnValue(0);
    vi.spyOn(api, "call").mockImplementation(
      async <T,>(command: string, args: Record<string, unknown> = {}) => {
        if (command === "delete_draft") throw new Error("database unavailable");
        return original<T>(command, args);
      },
    );
    await click("舍弃空白邮件");
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(error).toHaveBeenCalledWith(
      "空白邮件舍弃失败：Error: database unavailable",
    );
  });
});

describe("compose window management", () => {
  const dialog = () =>
    document.querySelector(".compose-dialog") as unknown as HTMLElement;
  const header = () =>
    dialog().querySelector('[data-slot="dialog-header"]') as unknown as Element;
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
  async function doubleClickHeader() {
    await act(async () => {
      header().dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
      );
    });
  }
  const style = (name: string) => dialog().style.getPropertyValue(name);

  it("非模态打开：没有遮罩层，打字区仍在版面上", () => {
    expect(dialog()).toBeTruthy();
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeNull();
    expect(dialog().className).not.toContain("compose-expanded");
    expect(document.querySelectorAll(".compose-resize-handle")).toHaveLength(8);
  });

  it("拖动标题区切到浮动定位，位置按视口收敛", async () => {
    await pointer(header(), "pointerdown", 100, 60);
    expect(dialog().className).toContain("compose-floating");
    await pointer(header(), "pointermove", 140, 90);
    await pointer(header(), "pointerup", 140, 90);
    // 基准取 clampGeometry(jsdom 里 rect 全 0 → 8,8,640,420)，再位移 (+40,+30)
    expect(style("--compose-left")).toBe("48px");
    expect(style("--compose-top")).toBe("38px");
    expect(style("--compose-width")).toBe("640px");
    expect(style("--compose-height")).toBe("420px");
  });

  it("双击标题区最大化，再双击还原，最大化时收掉缩放手柄", async () => {
    await doubleClickHeader();
    expect(dialog().className).toContain("compose-expanded");
    expect(document.querySelectorAll(".compose-resize-handle")).toHaveLength(0);
    await doubleClickHeader();
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

  it("最小化收起正文、显示底部还原条，点还原条回来", async () => {
    await click("最小化写信窗口");
    expect(dialog().className).toContain("compose-minimized");
    const bar = document.querySelector(".compose-restore-bar");
    expect(bar).toBeTruthy();
    expect(bar!.textContent).toContain("撰写邮件");
    await click("继续写信");
    expect(dialog().className).not.toContain("compose-minimized");
    expect(document.querySelector(".compose-restore-bar")).toBeNull();
    expect(document.querySelector('[aria-label="邮件正文"]')).toBeTruthy();
  });

  it("点击窗口之外自动收成细条，且不会关闭正在写的草稿", async () => {
    await pointer(document.body, "pointerdown", 4, 4);
    await pointer(document.body, "pointerup", 4, 4);
    expect(document.querySelector(".compose-dialog")).toBeTruthy();
    expect(dialog().className).toContain("compose-minimized");
    expect(document.querySelector(".compose-restore-bar")).toBeTruthy();
    expect(document.querySelector('[aria-label="邮件正文"]')).toBeTruthy();
  });

  it("Dock/托盘重新激活后的第一下点击不收起写信窗", async () => {
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await pointer(document.body, "pointerdown", 4, 4);
    await pointer(document.body, "pointerup", 4, 4);
    expect(dialog().className).not.toContain("compose-minimized");
  });

  it("点写信窗口自己的弹层不会把窗口收起来", async () => {
    // 字体/字号下拉这些弹层在 DOM 上挂在 .compose-dialog 之外，点它们不算离开写信窗口
    const listbox = document.createElement("div");
    listbox.setAttribute("role", "listbox");
    document.body.append(listbox);
    await pointer(listbox, "pointerdown", 10, 10);
    await pointer(listbox, "pointerup", 10, 10);
    listbox.remove();
    expect(dialog().className).not.toContain("compose-minimized");
    expect(document.querySelector(".compose-restore-bar")).toBeNull();
  });

  it("点写信窗派生出来的浮层（图片缩放浮条 / 通知 / 提示气泡）不会把窗口收起来", async () => {
    // 用户反馈的误触：图片缩放 − % + 浮条（.rich-image-zoom，portal 到 body）、
    // sonner 通知、富文本工具条的提示气泡，以前都不在白名单里，点一下正在写的信就被收起来。
    const zoomBar = document.createElement("div");
    zoomBar.className = "rich-image-zoom";
    const notice = document.createElement("div");
    notice.setAttribute("data-sonner-toast", "");
    const tip = document.createElement("div");
    tip.setAttribute("role", "tooltip");
    // 别的写信窗收成细条后的「继续写信」条
    const otherBar = document.createElement("div");
    otherBar.className = "compose-restore-bar";
    document.body.append(zoomBar, notice, tip, otherBar);
    for (const element of [zoomBar, notice, tip, otherBar]) {
      await pointer(element, "pointerdown", 10, 10);
      await pointer(element, "pointerup", 10, 10);
    }
    zoomBar.remove();
    notice.remove();
    tip.remove();
    otherBar.remove();
    expect(dialog().className).not.toContain("compose-minimized");
    expect(document.querySelector(".compose-restore-bar")).toBeNull();
  });

  it("拖动基准取实际盒子，居中不再依赖会被生产构建吃掉的 translate", async () => {
    // 居中改成 left/right + margin:auto：DialogContent 自带的 translate-x/y-[-50%] 必须被顶掉，
    // 否则一旦设了 left/top，窗口会整体偏半个身位；而生产 CSS 压缩器会把 translate 覆盖折进
    // transform 一起丢掉（dev 下看不出来），所以覆盖手段不能是 CSS。
    const classes = dialog().className;
    expect(classes).toContain("translate-x-0");
    expect(classes).toContain("translate-y-0");
    expect(classes).not.toContain("translate-x-[-50%]");
    expect(classes).not.toContain("translate-y-[-50%]");
    // 基准直接取 rect：窗口用 transform:none 关掉了入场缩放，rect 就是真实盒子，不用再折半。
    const element = dialog();
    element.getBoundingClientRect = () =>
      ({
        left: 60,
        top: 50,
        width: 640,
        height: 420,
        right: 700,
        bottom: 470,
        x: 60,
        y: 50,
        toJSON: () => ({}),
      }) as DOMRect;
    await pointer(header(), "pointerdown", 300, 200);
    // 按下本身不移动窗口
    expect(style("--compose-left")).toBe("60px");
    expect(style("--compose-top")).toBe("50px");
    await pointer(header(), "pointermove", 340, 230);
    expect(style("--compose-left")).toBe("100px");
    expect(style("--compose-top")).toBe("80px");
    expect(style("--compose-width")).toBe("640px");
    expect(style("--compose-height")).toBe("420px");
  });

  it("在窗口外松开后再滑回标题区，不会带着旧基准把窗口拽走", async () => {
    await pointer(header(), "pointerdown", 100, 60);
    await pointer(header(), "pointermove", 140, 90);
    expect(style("--compose-left")).toBe("48px");
    // 松手发生在窗口之外（收不到元素上的 pointerup），再滑回标题区时不得继续拖动
    await pointer(document.body, "pointerup", 9, 9);
    await pointer(header(), "pointermove", 900, 600);
    expect(style("--compose-left")).toBe("48px");
    expect(style("--compose-top")).toBe("38px");
  });

  it("窗口控制是标题左侧的三灯：关闭 / 最小化 / 最大化", () => {
    const heading = dialog().querySelector(".compose-heading")!;
    const lights = heading.firstElementChild as HTMLElement;
    expect(lights.className).toContain("compose-lights");
    const buttons = [...lights.querySelectorAll(".compose-light")];
    expect(buttons).toHaveLength(3);
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      expect.stringMatching(/^(保存草稿并关闭|舍弃空白邮件)$/),
      "最小化写信窗口",
      "最大化写信窗口",
    ]);
    expect(buttons.map((b) => b.className)).toEqual([
      expect.stringContaining("compose-light-close"),
      expect.stringContaining("compose-light-min"),
      expect.stringContaining("compose-light-zoom"),
    ]);
    // 标题紧跟三灯之后
    expect(heading.lastElementChild?.tagName).toBe("H2");
  });

  it("WKWebView 里移动事件报 buttons=0 时依然能拖动窗口", async () => {
    // 真机实测：WKWebView 的 pointermove/mousemove 的 buttons 恒为 0（131 次移动全是 0），
    // 手势绝不能靠 buttons 判断「鼠标还按着」，否则第一次 move 就取消，表现为拖不动。
    await pointer(header(), "pointerdown", 100, 60);
    await act(async () => {
      header().dispatchEvent(
        new MouseEvent("pointermove", {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: 0,
          clientX: 140,
          clientY: 90,
        }),
      );
    });
    expect(style("--compose-left")).toBe("48px");
    expect(style("--compose-top")).toBe("38px");
  });

  it("最大化后最小化，点「继续写信」仍回到最大化", async () => {
    await doubleClickHeader();
    expect(dialog().className).toContain("compose-expanded");
    await click("最小化写信窗口");
    expect(dialog().className).toContain("compose-minimized");
    await click("继续写信");
    expect(dialog().className).not.toContain("compose-minimized");
    expect(dialog().className).toContain("compose-expanded");
  });
});

describe("closing a draft with content", () => {
  const prompt = () =>
    document.body.textContent?.includes("保存这封邮件的草稿？") ?? false;
  // 等自动保存落库，后面的断言才能确认真实存在过一份草稿。
  async function settled() {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
  }
  async function listDrafts() {
    return await call<Compose[]>("list_drafts");
  }
  it("asks on the close light and keeps both the draft and the window when cancelled", async () => {
    seed = {
      ...newDraft(accounts[0].id),
      id: "prompt-cancel",
      to: "keep@example.com",
      subject: "Keep me",
    };
    await renderHarness();
    await settled();
    await click("保存草稿并关闭");
    expect(prompt()).toBe(true);
    await click("取消");
    expect(prompt()).toBe(false);
    expect(document.querySelector(".compose-dialog")).not.toBeNull();
    expect((await listDrafts()).some((d) => d.id === "prompt-cancel")).toBe(
      true,
    );
  });
  it("deletes the autosaved draft when the user chooses not to save", async () => {
    seed = {
      ...newDraft(accounts[0].id),
      id: "prompt-discard",
      to: "drop@example.com",
      subject: "Drop me",
    };
    await renderHarness();
    await settled();
    expect((await listDrafts()).some((d) => d.id === "prompt-discard")).toBe(
      true,
    );
    await click("保存草稿并关闭");
    await click("不保存");
    expect(document.querySelector(".compose-dialog")).toBeNull();
    expect((await listDrafts()).some((d) => d.id === "prompt-discard")).toBe(
      false,
    );
  });
  it("asks for confirmation on ⌘W instead of closing the window outright", async () => {
    seed = {
      ...newDraft(accounts[0].id),
      id: "prompt-shortcut",
      to: "shortcut@example.com",
      subject: "Shortcut",
    };
    await renderHarness();
    await settled();
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "w",
          metaKey: true,
          bubbles: true,
        }),
      );
    });
    expect(prompt()).toBe(true);
    await click("保存");
    expect(document.querySelector(".compose-dialog")).toBeNull();
  });
  it("saves from the button and closes without asking again", async () => {
    seed = {
      ...newDraft(accounts[0].id),
      id: "prompt-button",
      to: "button@example.com",
      subject: "Save button",
    };
    await renderHarness();
    await settled();
    await click("保存草稿");
    await settled();
    expect(document.querySelector(".compose-dialog")).not.toBeNull();
    await click("保存草稿并关闭");
    expect(prompt()).toBe(false);
    expect(document.querySelector(".compose-dialog")).toBeNull();
    expect((await listDrafts()).some((d) => d.id === "prompt-button")).toBe(
      true,
    );
  });
  it("treats ⌘S as saved and closes without asking again", async () => {
    seed = {
      ...newDraft(accounts[0].id),
      id: "prompt-manual-save",
      to: "manual@example.com",
      subject: "Manual save",
    };
    await renderHarness();
    await settled();
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "s",
          metaKey: true,
          bubbles: true,
        }),
      );
    });
    await settled();
    await click("保存草稿并关闭");
    expect(prompt()).toBe(false);
    expect(document.querySelector(".compose-dialog")).toBeNull();
    expect(
      (await listDrafts()).some((d) => d.id === "prompt-manual-save"),
    ).toBe(true);
  });
  it("prompts after further edits made since the explicit save", async () => {
    seed = {
      ...newDraft(accounts[0].id),
      id: "prompt-manual-edit",
      to: "manual@example.com",
      subject: "Manual save",
    };
    await renderHarness();
    await settled();
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "s",
          metaKey: true,
          bubbles: true,
        }),
      );
    });
    await settled();
    await input("#subject", "Edited after save");
    await click("保存草稿并关闭");
    expect(prompt()).toBe(true);
    await click("取消");
    expect(document.querySelector(".compose-dialog")).not.toBeNull();
  });
  it("asks on the close signal sent by the app for ⌘W", async () => {
    seed = {
      ...newDraft(accounts[0].id),
      id: "prompt-signal",
      to: "signal@example.com",
      subject: "Signal",
    };
    function SignalHarness() {
      const [draft, setDraft] = useState<Compose | null>(seed);
      const [signal, setSignal] = useState(0);
      return (
        <>
          <ComposeDialog
            draft={draft}
            accounts={accounts}
            closeSignal={signal}
            onClose={() => setDraft(null)}
            onSent={() => {}}
          />
          <button type="button" onClick={() => setSignal((n) => n + 1)}>
            请求关闭
          </button>
        </>
      );
    }
    await act(async () => root.render(<SignalHarness key={seed.id} />));
    await bodyEditor();
    await settled();
    await click("请求关闭");
    expect(prompt()).toBe(true);
    await click("不保存");
    expect(document.querySelector(".compose-dialog")).toBeNull();
    expect((await listDrafts()).some((d) => d.id === "prompt-signal")).toBe(
      false,
    );
  });
});
