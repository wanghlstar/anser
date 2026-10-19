// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import App from "./App";
import { call, enterDemo, leaveDemo, newDraft, snapshot } from "./lib/api";
import * as api from "./lib/api";
import type { Account, Query } from "./lib/types";
import { toast } from "sonner";

let root: Root;
let host: HTMLDivElement;
const localQuery: Query = {
  view: "local",
  accountId: "",
  folder: "",
  search: "",
  limit: 200,
  unreadOnly: false,
};
async function click(element: Element | null) {
  expect(element).not.toBeNull();
  await act(async () => {
    element!.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, button: 0 }),
    );
    (element as HTMLElement).click();
  });
}
function nav(title: string) {
  return (
    [...host.querySelectorAll("button.nav-item")].find((b) =>
      [...b.querySelectorAll("span")].some(
        (span) => span.childNodes[0]?.textContent === title,
      ),
    ) ?? null
  );
}
function filter(title: string) {
  return (
    [...host.querySelectorAll(".list-filters button")].find(
      (b) => b.textContent === title,
    ) ?? null
  );
}
async function openRowMenu(
  row: Element | null = host.querySelector("button.mail-row-main"),
) {
  expect(row).not.toBeNull();
  await act(async () => {
    row!.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 20,
      }),
    );
  });
}
function menuLabels() {
  return [
    ...document.querySelectorAll('[role="menuitem"],[role="menuitemcheckbox"]'),
  ].map((el) => (el.textContent || "").replace(/[⌘⇧A-Za-z]+$/, "").trim());
}
async function seedReplyThread() {
  const seed = await snapshot(localQuery);
  const mail = seed.messages[0];
  mail.messageId = "<root@example.com>";
  seed.messages.push({
    ...mail,
    id: "older-reply",
    messageId: "<older@example.com>",
    inReplyTo: [mail.messageId],
    references: [mail.messageId],
    date: new Date(new Date(mail.date).getTime() - 1000).toISOString(),
  });
  localStorage.setItem("mail-desktop-demo-v1", JSON.stringify(seed));
  api.restoreDemo();
}
async function chooseListMode(label: string) {
  await act(async () => {
    host
      .querySelector('[aria-label="邮件显示方式"]')!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
  });
  await click(
    [...document.querySelectorAll('[role="menuitemradio"]')].find(
      (item) => item.textContent === label,
    ) ?? null,
  );
}
async function seedLargeMailbox() {
  const seed = await snapshot(localQuery);
  const mail = seed.messages[0];
  const newest = new Date(mail.date).getTime();
  seed.messages = Array.from({ length: 205 }, (_, index) => ({
    ...mail,
    id: `page-${index}`,
    subject: `Pagination mail ${index}`,
    date: new Date(newest - index * 1000).toISOString(),
    messageId: `<page-${index}@example.com>`,
    isRead: false,
    starred: true,
  }));
  localStorage.setItem("mail-desktop-demo-v1", JSON.stringify(seed));
  api.restoreDemo();
  await click(nav("本地存档"));
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
  enterDemo();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<App />);
  });
});
it("applies the saved sidebar font scale to the CSS variable on mount", async () => {
  await call("save_preferences", {
    preferences: {
      syncIntervalMinutes: 5,
      newMailNotifications: true,
      sendResultNotifications: true,
      sidebarScale: 0.9,
    },
  });
  // jsdom 不支持 CSS 自定义属性，用 spy 验证赋值调用本身
  const setProperty = vi.spyOn(document.documentElement.style, "setProperty");
  // beforeEach 已挂载过 App，挂载 effect 不会重跑；换新 root 重挂载以触发
  await act(async () => root.unmount());
  host.remove();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<App />);
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  expect(setProperty).toHaveBeenCalledWith("--nav-scale", "0.9");
  setProperty.mockRestore();
});

afterEach(async () => {
  await act(async () => toast.dismiss());
  // Sonner keeps its exit-animation timeout alive after an immediate unmount.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
  });
  await act(async () => root.unmount());
  host.remove();
  leaveDemo();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("message and conversation display modes", () => {
  it("keeps unread status separate from account color on long subjects in both list modes", async () => {
    const seed = await snapshot(localQuery);
    const base = seed.messages[0];
    seed.messages = [
      {
        ...base,
        id: "long-unread",
        subject: "长标题".repeat(100),
        isRead: false,
        messageId: "<unread@example.com>",
      },
      {
        ...base,
        id: "long-read",
        subject: "已读长标题".repeat(100),
        isRead: true,
        messageId: "<read@example.com>",
      },
    ];
    localStorage.setItem("mail-desktop-demo-v1", JSON.stringify(seed));
    api.restoreDemo();
    await click(nav("本地存档"));
    for (const label of ["逐封邮件", "按对话分组"]) {
      await chooseListMode(label);
      const rows = [...host.querySelectorAll(".mail-row")];
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.querySelectorAll('[aria-label="未读"]')).toHaveLength(
          row.classList.contains("unread") ? 1 : 0,
        );
        expect(row.querySelector(".row-subject-text")?.textContent).toContain(
          "长标题",
        );
        expect(
          row
            .querySelector('.row-meta .mini-dot[aria-hidden="true"]')
            ?.getAttribute("title"),
        ).toBe("邮箱颜色标识");
      }
    }
  });
  it("reloads selected content when archival changes the original hash", async () => {
    const seed = await snapshot(localQuery);
    seed.messages = [{ ...seed.messages[0], savedLocally: false }];
    localStorage.setItem("mail-desktop-demo-v1", JSON.stringify(seed));
    api.restoreDemo();
    await click(nav("全部收件箱"));
    await chooseListMode("逐封邮件");
    let archived = false;
    const original = api.call;
    vi.spyOn(api, "call").mockImplementation(
      async <T,>(command: string, args: Record<string, unknown> = {}) => {
        if (command === "queue_archives") {
          archived = true;
          return { queued: 1, alreadySaved: 0, blocked: 0 } as T;
        }
        const result = await original<unknown>(command, args);
        if (command === "mail_detail") {
          const d = result as import("./lib/types").Detail;
          return {
            ...d,
            html: "",
            mail: {
              ...d.mail,
              hash: archived ? "full-hash" : "header-hash",
              savedLocally: archived,
              body: archived ? "Full archived original" : "Online body preview",
            },
          } as T;
        }
        if (command === "mail_metadata") {
          const m = result as import("./lib/types").Mail;
          return {
            ...m,
            hash: archived ? "full-hash" : "header-hash",
            savedLocally: archived,
            body: "",
          } as T;
        }
        return result as T;
      },
    );
    await click(host.querySelector("button.mail-row-main"));
    expect(host.textContent).toContain("Online body preview");
    await click(
      [...host.querySelectorAll(".message-metadata button")].find((b) =>
        b.textContent?.includes("完整保存到本地"),
      ) ?? null,
    );
    await click(host.querySelector('[title="星标"], [title="取消星标"]'));
    expect(host.textContent).toContain("Full archived original");
    expect(host.textContent).not.toContain("Online body preview");
  });
  it("queues a single online mail explicitly without changing account retention", async () => {
    const seed = await snapshot(localQuery);
    const mail = { ...seed.messages[0], savedLocally: false };
    seed.messages = [mail];
    localStorage.setItem("mail-desktop-demo-v1", JSON.stringify(seed));
    api.restoreDemo();
    await click(nav("全部收件箱"));
    await chooseListMode("逐封邮件");
    const original = api.call;
    const calls = vi
      .spyOn(api, "call")
      .mockImplementation(
        async <T,>(command: string, args: Record<string, unknown> = {}) =>
          command === "queue_archives"
            ? ({ queued: 1, alreadySaved: 0, blocked: 0 } as T)
            : original<T>(command, args),
      );
    await click(host.querySelector("button.mail-row-main"));
    await click(
      [...host.querySelectorAll(".message-metadata button")].find((b) =>
        b.textContent?.includes("完整保存到本地"),
      ) ?? null,
    );
    expect(calls).toHaveBeenCalledWith("queue_archives", {
      ids: [mail.id],
      conversations: false,
    });
    expect(
      calls.mock.calls.some(
        ([c]) => c === "edit_account_preferences" || c === "send_mail",
      ),
    ).toBe(false);
  });
  it("keeps grouped versus individual batch archival scope in the command", async () => {
    await seedReplyThread();
    await click(nav("本地存档"));
    const original = api.call;
    const calls = vi
      .spyOn(api, "call")
      .mockImplementation(
        async <T,>(command: string, args: Record<string, unknown> = {}) =>
          command === "queue_archives"
            ? ({ queued: 1, alreadySaved: 1, blocked: 0 } as T)
            : original<T>(command, args),
      );
    await click(host.querySelector('.row-check [role="checkbox"]'));
    await click(host.querySelector('.batch-toolbar [title="完整保存到本地"]'));
    expect(calls.mock.calls).toContainEqual([
      "queue_archives",
      { ids: ["demo-0"], conversations: true },
    ]);
    await chooseListMode("逐封邮件");
    await click(host.querySelector('.row-check [role="checkbox"]'));
    await click(host.querySelector('.batch-toolbar [title="完整保存到本地"]'));
    expect(calls.mock.calls).toContainEqual([
      "queue_archives",
      { ids: ["demo-0"], conversations: false },
    ]);
  });
  it("changes counts and keeps its preference across categories and reopening", async () => {
    await seedReplyThread();
    await click(nav("本地存档"));
    expect(host.querySelectorAll("button.mail-row-main")).toHaveLength(8);
    await chooseListMode("逐封邮件");
    expect(host.querySelectorAll("button.mail-row-main")).toHaveLength(9);
    expect(host.querySelector(".conversation-count")).toBeNull();
    expect(host.querySelector(".list-heading")?.textContent).toContain(
      "9 封邮件",
    );
    await click(nav("星标邮件"));
    expect(
      host.querySelector('[aria-label="邮件显示方式"]')?.textContent,
    ).toContain("逐封邮件");
    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(<App />));
    expect(
      host.querySelector('[aria-label="邮件显示方式"]')?.textContent,
    ).toContain("逐封邮件");
    await chooseListMode("按对话分组");
    expect(host.querySelectorAll("button.mail-row-main")).toHaveLength(8);
    expect(localStorage.getItem("mail-list-mode")).toBe("conversations");
  });
  it("reads and navigates single turns without loading or marking the rest of a thread", async () => {
    await seedReplyThread();
    await click(nav("本地存档"));
    await chooseListMode("逐封邮件");
    const calls = vi.spyOn(api, "call");
    await click(host.querySelector("button.mail-row-main"));
    expect(host.querySelector(".conversation-stream")).toBeNull();
    expect(host.querySelector(".reader-scroll .message-body")).not.toBeNull();
    expect(
      calls.mock.calls.some(([command]) => command === "mail_conversation"),
    ).toBe(false);
    const single = await snapshot({ ...localQuery, listMode: "messages" });
    expect(single.messages.find((m) => m.id === "demo-0")?.isRead).toBe(true);
    expect(single.messages.find((m) => m.id === "older-reply")?.isRead).toBe(
      false,
    );
    await click(host.querySelector('[aria-label="下一封邮件"]'));
    expect(calls).toHaveBeenCalledWith("mail_detail", { id: "older-reply" });
    expect(host.querySelectorAll(".mail-row.selected")).toHaveLength(1);
    await click(host.querySelector('[aria-label="上一封邮件"]'));
    expect(host.querySelectorAll(".mail-row.selected")).toHaveLength(1);
    await chooseListMode("按对话分组");
    expect(host.querySelectorAll(".conversation-turn")).toHaveLength(2);
  });
  it("toggles rows with the command key and clears the selection with Escape", async () => {
    await click(nav("本地存档"));
    await chooseListMode("逐封邮件");
    const rows = [...host.querySelectorAll("button.mail-row-main")];
    expect(rows.length).toBeGreaterThan(1);
    // ⌘+点击：不连续多选，且不打开邮件
    await act(async () => {
      rows[0].dispatchEvent(
        new MouseEvent("click", { metaKey: true, bubbles: true }),
      );
    });
    expect(host.querySelector(".batch-toolbar")?.textContent).toContain(
      "已选 1 封邮件",
    );
    expect(host.querySelectorAll(".mail-row.selected")).toHaveLength(0);
    await act(async () => {
      rows[2].dispatchEvent(
        new MouseEvent("click", { metaKey: true, bubbles: true }),
      );
    });
    expect(host.querySelector(".batch-toolbar")?.textContent).toContain(
      "已选 2 封邮件",
    );
    // 再 ⌘+点一次取消
    await act(async () => {
      rows[0].dispatchEvent(
        new MouseEvent("click", { metaKey: true, bubbles: true }),
      );
    });
    expect(host.querySelector(".batch-toolbar")?.textContent).toContain(
      "已选 1 封邮件",
    );
    // Esc 取消勾选
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(host.querySelector(".batch-toolbar")).toBeNull();
  });
  it("seeds the command-key selection with the mail already open and clears it by clicking the reader", async () => {
    await click(nav("本地存档"));
    await chooseListMode("逐封邮件");
    const rows = [...host.querySelectorAll("button.mail-row-main")];
    // 先普通点击打开第一封（此时没有勾选）
    await click(rows[0]);
    expect(host.querySelector(".batch-toolbar")).toBeNull();
    // ⌘+点击第二封：当前打开的 + 新点的，一起进选区
    await act(async () => {
      rows[1].dispatchEvent(
        new MouseEvent("click", { metaKey: true, bubbles: true }),
      );
    });
    expect(host.querySelector(".batch-toolbar")?.textContent).toContain(
      "已选 2 封邮件",
    );
    // 点正文就取消勾选，不必切文件夹
    await act(async () => {
      host.querySelector<HTMLElement>(".reader")!.click();
    });
    expect(host.querySelector(".batch-toolbar")).toBeNull();
  });
  it("applies a selected single-mail batch action without trashing its reply", async () => {
    await seedReplyThread();
    await click(nav("本地存档"));
    await chooseListMode("逐封邮件");
    await click(host.querySelector('.row-check [role="checkbox"]'));
    expect(host.querySelector(".batch-toolbar")?.textContent).toContain(
      "已选 1 封邮件",
    );
    await click(host.querySelector('.batch-toolbar [title="移到本地废纸篓"]'));
    const list = await snapshot({ ...localQuery, listMode: "messages" });
    expect(list.messages.some((m) => m.id === "demo-0")).toBe(false);
    expect(list.messages.some((m) => m.id === "older-reply")).toBe(true);
  });
  it("drops a permanently deleted trash row from the list right away", async () => {
    await seedReplyThread();
    await click(nav("本地存档"));
    await chooseListMode("逐封邮件");
    await click(host.querySelector('.row-check [role="checkbox"]'));
    await click(host.querySelector('.batch-toolbar [title="移到本地废纸篓"]'));
    await click(nav("本地废纸篓"));
    await chooseListMode("逐封邮件");
    expect(host.querySelectorAll("button.mail-row-main")).toHaveLength(1);
    await act(async () => {
      toast.dismiss();
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    await click(host.querySelector('.row-check [role="checkbox"]'));
    await click(
      host.querySelector('.batch-toolbar [title="彻底删除（含服务器副本）"]'),
    );
    expect(host.querySelectorAll("button.mail-row-main")).toHaveLength(0);
    expect(host.querySelector(".list-empty")).not.toBeNull();
    expect(host.querySelector(".list-heading")?.textContent).toContain(
      "0 封邮件",
    );
    expect(
      [...host.querySelectorAll("[data-sonner-toast]")]
        .filter((t) => t.getAttribute("data-removed") !== "true")
        .some((t) => t.querySelector("[data-action]")),
    ).toBe(false);
    const trash = await snapshot({ ...localQuery, view: "trash" });
    expect(trash.messages.some((m) => m.id === "demo-0")).toBe(false);
  });
  it("keeps a pending permanent deletion hidden when the trash is reopened", async () => {
    await seedReplyThread();
    await click(nav("本地存档"));
    await chooseListMode("逐封邮件");
    await click(host.querySelector('.row-check [role="checkbox"]'));
    await click(host.querySelector('.batch-toolbar [title="移到本地废纸篓"]'));
    await click(nav("本地废纸篓"));
    await chooseListMode("逐封邮件");
    expect(host.querySelectorAll("button.mail-row-main")).toHaveLength(1);
    // 服务器尚未确认时本地行仍在数据里，前端先隐藏
    const originalCall = api.call;
    vi.spyOn(api, "call").mockImplementation(
      async <T,>(command: string, args: Record<string, unknown> = {}) =>
        command === "update_mail" && args.action === "delete"
          ? (undefined as T)
          : originalCall<T>(command, args),
    );
    await click(host.querySelector('.row-check [role="checkbox"]'));
    await click(
      host.querySelector('.batch-toolbar [title="彻底删除（含服务器副本）"]'),
    );
    expect(host.querySelectorAll("button.mail-row-main")).toHaveLength(0);
    const trash = await snapshot({ ...localQuery, view: "trash" });
    expect(trash.messages.some((m) => m.id === "demo-0")).toBe(true);
    // 切到别的视图再回废纸篓：未确认删除的邮件保持隐藏，不闪回（其他视图
    // 本就不含已删邮件，不能据此清掉待删标记）
    await click(nav("全部收件箱"));
    await click(nav("本地废纸篓"));
    expect(host.querySelectorAll("button.mail-row-main")).toHaveLength(0);
  });
  it("cancels late conversation loading when the user switches to individual messages", async () => {
    await seedReplyThread();
    await click(nav("本地存档"));
    const originalCall = api.call;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(api, "call").mockImplementation(
      async <T,>(
        command: string,
        args: Record<string, unknown> = {},
      ): Promise<T> => {
        if (command === "mail_conversation") await gate;
        return originalCall<T>(command, args);
      },
    );
    await click(host.querySelector("button.mail-row-main"));
    await chooseListMode("逐封邮件");
    await act(async () => {
      release();
      await gate;
    });
    expect(host.querySelector(".conversation-stream")).toBeNull();
    const list = await snapshot({ ...localQuery, listMode: "messages" });
    expect(list.messages.find((m) => m.id === "older-reply")?.isRead).toBe(
      false,
    );
  });
});
describe("fixed cursor list loading", () => {
  it("requests only the next fixed page and appends without changing the query prefix", async () => {
    await seedLargeMailbox();
    const original = api.mailPage,
      calls = vi.spyOn(api, "mailPage").mockImplementation(original);
    await click(host.querySelector(".load-more"));
    expect(host.querySelectorAll("button.mail-row-main")).toHaveLength(205);
    expect(
      calls.mock.calls.some(([q, cursor]) => q.limit === 200 && !!cursor),
    ).toBe(true);
    expect(calls.mock.calls.every(([q]) => q.limit === 200)).toBe(true);
    expect(host.querySelector(".load-more")).toBeNull();
  });
  it("keeps loaded pages and the final cursor through an unchanged refresh", async () => {
    await seedLargeMailbox();
    const base = JSON.parse(
      localStorage.getItem("mail-desktop-demo-v1")!,
    ) as import("./lib/types").Snapshot;
    base.messages[0].isRead = true;
    localStorage.setItem("mail-desktop-demo-v1", JSON.stringify(base));
    api.restoreDemo();
    await click(nav("本地存档"));
    await click(host.querySelector(".load-more"));
    expect(host.querySelectorAll("button.mail-row-main")).toHaveLength(205);
    await click(host.querySelector("button.mail-row-main"));
    expect(host.querySelectorAll("button.mail-row-main")).toHaveLength(205);
    expect(host.querySelector(".load-more")).toBeNull();
  });
  it("replaces a stale page on a new message rather than combining generations", async () => {
    await seedLargeMailbox();
    const base = JSON.parse(
      localStorage.getItem("mail-desktop-demo-v1")!,
    ) as import("./lib/types").Snapshot;
    base.messages.push({
      ...base.messages[0],
      id: "new-arrival",
      messageId: "<new-arrival@example.com>",
      subject: "New arrival",
      date: new Date(Date.parse(base.messages[0].date) + 10000).toISOString(),
    });
    localStorage.setItem("mail-desktop-demo-v1", JSON.stringify(base));
    api.restoreDemo();
    await click(host.querySelector(".load-more"));
    expect(host.querySelectorAll("button.mail-row-main")).toHaveLength(200);
    expect(host.querySelector(".row-subject-text")?.textContent).toBe(
      "New arrival",
    );
    expect(document.body.textContent).toContain("已重新加载最新结果");
  });
  it("discards a delayed cursor page after moving to a different category", async () => {
    await seedLargeMailbox();
    const original = api.mailPage;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(api, "mailPage").mockImplementation(async (q, cursor) => {
      if (cursor) await gate;
      return original(q, cursor);
    });
    await click(host.querySelector(".load-more"));
    await click(nav("星标邮件"));
    await act(async () => {
      release();
      await gate;
    });
    expect(host.querySelectorAll("button.mail-row-main")).toHaveLength(200);
    expect(host.querySelector(".list-heading h1")?.textContent).toBe(
      "星标邮件",
    );
    expect(
      host.querySelector(".load-more")?.getAttribute("aria-busy"),
    ).not.toBe("true");
  });
});
describe("reading across loaded page boundaries", () => {
  it.each(["按对话分组", "逐封邮件"])(
    "loads the next page and keeps previous navigation in %s mode",
    async (mode) => {
      await seedLargeMailbox();
      if (mode === "逐封邮件") await chooseListMode(mode);
      expect(host.querySelectorAll("button.mail-row-main")).toHaveLength(200);
      await click(host.querySelectorAll("button.mail-row-main")[199]);
      await click(host.querySelector('[aria-label="下一封邮件"]'));
      expect(host.querySelector(".message-heading h1")?.textContent).toBe(
        "Pagination mail 200",
      );
      expect(host.querySelectorAll("button.mail-row-main")).toHaveLength(200);
      await click(host.querySelector('[aria-label="上一封邮件"]'));
      expect(host.querySelector(".message-heading h1")?.textContent).toBe(
        "Pagination mail 199",
      );
      for (let n = 0; n < 5; n++)
        await click(host.querySelector('[aria-label="下一封邮件"]'));
      expect(host.querySelector(".message-heading h1")?.textContent).toBe(
        "Pagination mail 204",
      );
      expect(
        (host.querySelector('[aria-label="下一封邮件"]') as HTMLButtonElement)
          .disabled,
      ).toBe(true);
    },
  );
  it("extends an unread boundary when the opened mail disappears from its filter", async () => {
    await seedLargeMailbox();
    await chooseListMode("逐封邮件");
    await click(filter("未读"));
    await click(host.querySelectorAll("button.mail-row-main")[199]);
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      "Pagination mail 199",
    );
    expect(host.querySelectorAll(".mail-row.selected")).toHaveLength(0);
    await click(host.querySelector('[aria-label="下一封邮件"]'));
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      "Pagination mail 200",
    );
  });
  it("does not extend an old position when a new filter excludes the current mail", async () => {
    await seedLargeMailbox();
    await click(host.querySelector("button.mail-row-main"));
    await click(filter("未读"));
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      "Pagination mail 0",
    );
    expect(host.querySelectorAll("button.mail-row-main")).toHaveLength(200);
    expect(
      (host.querySelector('[aria-label="下一封邮件"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
  it("keeps the current mail on seek failure, prevents duplicate navigation and allows retry", async () => {
    await seedLargeMailbox();
    const original = api.mailNeighbor;
    let reject!: (error: Error) => void;
    const gate = new Promise<never>((_, fail) => {
      reject = fail;
    });
    const calls = vi
      .spyOn(api, "mailNeighbor")
      .mockImplementation(async (q, id, direction) =>
        id === "page-199" && direction === "next"
          ? gate
          : original(q, id, direction),
      );
    await click(host.querySelectorAll("button.mail-row-main")[199]);
    await click(host.querySelector('[aria-label="下一封邮件"]'));
    expect(
      host
        .querySelector('[aria-label="下一封邮件"]')
        ?.getAttribute("aria-busy"),
    ).toBe("true");
    const before = calls.mock.calls.length;
    await act(async () =>
      host.querySelector(".reader")!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          altKey: true,
          bubbles: true,
        }),
      ),
    );
    expect(calls.mock.calls).toHaveLength(before);
    await act(async () => {
      reject(new Error("Test unavailable"));
    });
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      "Pagination mail 199",
    );
    expect(document.body.textContent).toContain("加载相邻邮件失败");
    calls.mockImplementation(original);
    await click(host.querySelector('[aria-label="下一封邮件"]'));
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      "Pagination mail 200",
    );
    expect(host.querySelectorAll("button.mail-row-main")).toHaveLength(200);
  });
  it.each(["category", "mode", "selection"])(
    "discards a delayed page after changing %s",
    async (change) => {
      await seedLargeMailbox();
      const original = api.mailNeighbor;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      vi.spyOn(api, "mailNeighbor").mockImplementation(
        async (q, id, direction) => {
          if (id === "page-199" && direction === "next") await gate;
          return original(q, id, direction);
        },
      );
      await click(host.querySelectorAll("button.mail-row-main")[199]);
      await click(host.querySelector('[aria-label="下一封邮件"]'));
      if (change === "category") await click(nav("星标邮件"));
      if (change === "mode") await chooseListMode("逐封邮件");
      if (change === "selection")
        await click(host.querySelector("button.mail-row-main"));
      await act(async () => {
        release();
        await gate;
      });
      expect(host.querySelectorAll("button.mail-row-main")).toHaveLength(200);
      expect(host.querySelector(".message-heading h1")?.textContent).toBe(
        change === "category"
          ? undefined
          : change === "mode"
            ? "Pagination mail 199"
            : "Pagination mail 0",
      );
      expect(
        host
          .querySelector('[aria-label="下一封邮件"]')
          ?.getAttribute("aria-busy"),
      ).not.toBe("true");
    },
  );
});
describe("reading unread mail within its current category", () => {
  it("navigates adjacent messages in the current list and protects its boundary", async () => {
    const seed = await snapshot({ ...localQuery, view: "all" });
    await click(host.querySelector("button.mail-row-main"));
    expect(
      (host.querySelector('[aria-label="上一封邮件"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await click(host.querySelector('[aria-label="下一封邮件"]'));
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      seed.messages[1].subject,
    );
    await click(host.querySelector('[aria-label="上一封邮件"]'));
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      seed.messages[0].subject,
    );
  });
  it("continues to the next unread message after the open message leaves the filter", async () => {
    const seed = await snapshot({
      ...localQuery,
      view: "all",
      unreadOnly: true,
    });
    await click(filter("未读"));
    await click(host.querySelector("button.mail-row-main"));
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      seed.messages[0].subject,
    );
    expect(host.querySelectorAll("button.mail-row-main")).toHaveLength(
      seed.messages.length - 1,
    );
    await click(host.querySelector('[aria-label="下一封邮件"]'));
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      seed.messages[1].subject,
    );
  });
  it("supports Alt navigation but leaves input and compose dialog keystrokes alone", async () => {
    const seed = await snapshot({ ...localQuery, view: "all" });
    await click(host.querySelector("button.mail-row-main"));
    async function key(target: Element, key: string) {
      await act(async () =>
        target.dispatchEvent(
          new KeyboardEvent("keydown", {
            key,
            altKey: true,
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
    }
    await key(host.querySelector('[aria-label="搜索邮件"]')!, "ArrowDown");
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      seed.messages[0].subject,
    );
    await key(host.querySelector(".reader")!, "ArrowDown");
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      seed.messages[1].subject,
    );
    await key(host.querySelector(".reader")!, "ArrowUp");
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      seed.messages[0].subject,
    );
    await click(
      [...host.querySelectorAll("button")].find((b) =>
        b.textContent?.startsWith("写邮件"),
      )!,
    );
    await key(document.querySelector('[role="dialog"] button')!, "ArrowDown");
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      seed.messages[0].subject,
    );
  });
  it("keeps a second compose window instead of overwriting the first draft", async () => {
    const writeButton = () =>
      [...host.querySelectorAll("button")].find((b) =>
        b.textContent?.startsWith("写邮件"),
      )!;
    await click(writeButton());
    expect(document.querySelectorAll(".compose-dialog")).toHaveLength(1);
    await click(writeButton());
    expect(document.querySelectorAll(".compose-dialog")).toHaveLength(2);
    // 关掉其中一封，另一封还在
    await click(document.querySelector('[aria-label="舍弃空白邮件"]'));
    expect(document.querySelectorAll(".compose-dialog")).toHaveLength(1);
  });
  it.each(["回复", "转发"])(
    "%s retains the selected original HTML and sets the expected quoting default",
    async (action) => {
      const originalCall = api.call;
      vi.spyOn(api, "call").mockImplementation(
        async <T,>(
          command: string,
          args: Record<string, unknown> = {},
        ): Promise<T> => {
          const result = await originalCall<T>(command, args);
          if (command === "mail_detail")
            return {
              ...result,
              html: "<style>td{color:red}</style><table><tr><td>Original report</td></tr></table>",
            };
          return result;
        },
      );
      await click(host.querySelector("button.mail-row-main"));
      await click(
        [...host.querySelectorAll("button")].find(
          (b) =>
            b.getAttribute("aria-label") === action ||
            b.textContent?.trim() === action,
        ) ?? null,
      );
      expect(
        document.querySelector('[aria-label="邮件正文"]')?.textContent,
      ).toBe("");
      const toggle = document.querySelector(
        '[role="switch"]',
      ) as HTMLButtonElement;
      expect(toggle.getAttribute("aria-checked")).toBe(
        String(action === "转发"),
      );
      if (action === "回复") await click(toggle);
      expect(
        document
          .querySelector('iframe[title="引用原文"]')
          ?.getAttribute("srcdoc"),
      ).toContain("Original report");
      expect(
        document
          .querySelector('iframe[title="引用原文"]')
          ?.getAttribute("srcdoc"),
      ).toContain("td{color:red}");
    },
  );
  it("shows inbox and sent turns in order and preserves a quick reply across navigation", async () => {
    const sendSpy = vi.spyOn(api, "call");
    const seed = await snapshot(localQuery);
    const original = seed.messages[0];
    original.messageId = "<root@example.com>";
    original.date = new Date(Date.now() - 180000).toISOString();
    const own = {
      ...original,
      id: "own-turn",
      messageId: "<own@example.com>",
      references: [original.messageId],
      inReplyTo: [original.messageId],
      sender: "Alex <alex@example.com>",
      recipients: "Lin <lin@example.com>",
      subject: "Re: Chat",
      body: "My outgoing reply",
      date: new Date(Date.now() - 120000).toISOString(),
      sourceFolder: "Sent",
      isRead: true,
    };
    const incoming = {
      ...original,
      id: "newest-turn",
      messageId: "<latest@example.com>",
      references: [original.messageId, own.messageId],
      inReplyTo: [own.messageId],
      subject: "Re: Chat",
      body: "Latest response",
      date: new Date(Date.now() - 60000).toISOString(),
    };
    seed.messages.push(own, incoming);
    localStorage.setItem("mail-desktop-demo-v1", JSON.stringify(seed));
    api.restoreDemo();
    await click(nav("全部收件箱"));
    await click(host.querySelector("button.mail-row-main"));
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(
        [...host.querySelectorAll(".conversation-turn")].map((e) =>
          e.getAttribute("data-mail-id"),
        ),
      ).toEqual([original.id, own.id, incoming.id]);
    });
    expect(
      host.querySelector(".conversation-turn.outgoing")?.textContent,
    ).toContain("我");
    expect(
      host.querySelector(".conversation-turn.outgoing")?.textContent,
    ).toContain("My outgoing reply");
    expect(host.querySelector(".quick-reply-heading")?.textContent).toContain(
      "lin@example.com",
    );
    const input = host.querySelector(
      'textarea[aria-label="对话回复正文"]',
    ) as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(input, "Chat reply draft");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(nav("星标邮件"));
    const drafts =
      await api.call<import("./lib/types").Compose[]>("list_drafts");
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      body: "Chat reply draft",
      inReplyTo: incoming.messageId,
      to: expect.stringContaining("lin@example.com"),
      replyAnchorId: incoming.id,
    });
    await click(nav("全部收件箱"));
    await click(host.querySelector("button.mail-row-main"));
    expect(
      (
        host.querySelector(
          'textarea[aria-label="对话回复正文"]',
        ) as HTMLTextAreaElement
      ).value,
    ).toBe("Chat reply draft");
    await click(
      [...host.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("完整编辑"),
      )!,
    );
    expect(document.querySelector('[aria-label="邮件正文"]')?.textContent).toBe(
      "Chat reply draft",
    );
    expect(
      host.querySelector('textarea[aria-label="对话回复正文"]'),
    ).toBeNull();
  });
  it("does not overwrite a restored formatted reply through the plain quick editor", async () => {
    await seedReplyThread();
    const seed = await snapshot(localQuery);
    const mail = seed.messages[0];
    await api.call("save_draft", {
      draft: {
        ...api.newDraft(mail.accountId),
        replyAnchorId: mail.id,
        body: "Rich draft",
        html: "<b>Rich draft</b>",
        format: "rich",
        attachments: ["/tmp/report.pdf"],
      },
    });
    await click(host.querySelector("button.mail-row-main"));
    expect(
      host.querySelector('textarea[aria-label="对话回复正文"]'),
    ).toBeNull();
    expect(host.querySelector(".quick-rich-draft")?.textContent).toContain(
      "保留原格式和附件",
    );
    await click(nav("星标邮件"));
    const drafts =
      await api.call<import("./lib/types").Compose[]>("list_drafts");
    expect(drafts[0].html).toBe("<b>Rich draft</b>");
    expect(drafts[0].attachments).toEqual(["/tmp/report.pdf"]);
  });
  it("persists clearing a saved quick reply instead of reviving deleted text", async () => {
    await seedReplyThread();
    const seed = await snapshot(localQuery),
      mail = seed.messages[0];
    await api.call("save_draft", {
      draft: {
        ...api.newDraft(mail.accountId),
        replyAnchorId: mail.id,
        body: "Previously saved text",
      },
    });
    await click(host.querySelector("button.mail-row-main"));
    const input = host.querySelector(
      'textarea[aria-label="对话回复正文"]',
    ) as HTMLTextAreaElement;
    expect(input.value).toBe("Previously saved text");
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(input, "");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(nav("星标邮件"));
    const drafts =
      await api.call<import("./lib/types").Compose[]>("list_drafts");
    expect(drafts[0].body).toBe("");
  });
  it("keeps the selected body loaded while changing list filters", async () => {
    const calls = vi.spyOn(api, "call");
    await click(host.querySelector("button.mail-row-main"));
    const before = calls.mock.calls.filter(
      ([command]) => command === "mail_detail",
    ).length;
    expect(before).toBeGreaterThan(0);
    await click(filter("未读"));
    await click(filter("全部"));
    expect(
      calls.mock.calls.filter(([command]) => command === "mail_detail"),
    ).toHaveLength(before);
    expect(
      host.querySelector(".message-body")?.textContent?.length,
    ).toBeGreaterThan(10);
  });
  it("reads a standalone mail without chat cards or a quick reply", async () => {
    await click(host.querySelector("button.mail-row-main"));
    expect(host.querySelector(".conversation-turn")).toBeNull();
    expect(host.querySelector(".quick-reply")).toBeNull();
    expect(host.querySelector(".conversation-start")).toBeNull();
    expect(
      host.querySelector(".message-body")?.textContent?.length,
    ).toBeGreaterThan(10);
    expect(host.querySelector(".storage-note")).toBeNull();
  });
  it("expands server folders and filters mail by the selected server folder", async () => {
    await click(
      host.querySelector('button[aria-label="展开 工作邮箱 的服务器文件夹"]'),
    );
    const sent = [...host.querySelectorAll(".remote-folder-list button")].find(
      (b) => b.textContent === "已发送",
    )!;
    await click(sent);
    expect(host.querySelector(".list-heading h1")?.textContent).toBe("已发送");
    expect(host.querySelectorAll(".mail-row-main")).toHaveLength(0);
    const inbox = [...host.querySelectorAll(".remote-folder-list button")].find(
      (b) => b.textContent === "收件箱",
    )!;
    await click(inbox);
    expect(host.querySelector(".list-heading h1")?.textContent).toBe("收件箱");
    expect(host.querySelectorAll(".mail-row-main").length).toBeGreaterThan(0);
  });
  it("opens an isolated directory explanation without automatically retrying its server selection", async () => {
    const seed = await snapshot(localQuery);
    const folder = {
      accountId: seed.accounts[0].id,
      name: "Unsafe",
      displayName: "异常目录",
      delimiter: "/",
      selectable: true,
      roles: [],
      syncError: "服务器响应不可靠",
    };
    await act(async () => root.unmount());
    leaveDemo();
    vi.spyOn(api, "mailPage").mockResolvedValue({
      ...seed,
      messages: [],
      remoteFolders: [folder],
      nextCursor: null,
      revision: 1,
      reset: false,
      bodyCoverage: { known: 0, unknown: 0 },
    });
    const commands = vi
      .spyOn(api, "call")
      .mockImplementation(
        async <T,>(command: string): Promise<T> =>
          (command === "account_folders" ? [folder] : []) as T,
      );
    root = createRoot(host);
    await act(async () => root.render(<App />));
    await click(
      host.querySelector('button[aria-label="展开 工作邮箱 的服务器文件夹"]'),
    );
    await click(
      [...host.querySelectorAll(".remote-folder-list button")].find((button) =>
        button.textContent?.includes("异常目录"),
      ) ?? null,
    );
    expect(host.textContent).toContain("目录来源已隔离");
    expect(
      commands.mock.calls.some(([command]) => command === "sync_remote_folder"),
    ).toBe(false);
  });
  it("blocks native context menus on blank areas and inputs without stopping custom handlers", () => {
    const input = host.querySelector('input[aria-label="搜索邮件"]')!;
    const custom = vi.fn();
    input.addEventListener("contextmenu", custom);
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    expect(input.dispatchEvent(event)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(custom).toHaveBeenCalledOnce();
    expect(
      document.body.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      ),
    ).toBe(false);
  });
  it("keeps manually saved contact names in recipient suggestions", async () => {
    const seed = await snapshot(localQuery);
    const sender = seed.messages.find((m) => m.sender.includes("<"))!.sender;
    const email = sender.match(/<([^>]+)>/)![1];
    await api.call("save_contact", {
      contact: { id: "manual-contact", name: "My saved name", email },
    });
    const suggestions = await api.call<{ name: string; email: string }[]>(
      "contact_suggestions",
    );
    expect(
      suggestions.filter((a) => a.email.toLowerCase() === email.toLowerCase()),
    ).toEqual([{ id: "manual-contact", name: "My saved name", email }]);
  });
  it("shows loading while fetching and ignores a previous mail arriving late", async () => {
    const seed = await snapshot({ ...localQuery, view: "all" });
    const [first, second] = seed.messages;
    const originalCall = api.call;
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    vi.spyOn(api, "call").mockImplementation(
      async <T,>(
        command: string,
        args: Record<string, unknown> = {},
      ): Promise<T> => {
        if (command === "mail_detail") {
          if (args.id === first.id) await firstGate;
          if (args.id === second.id) await secondGate;
        }
        return originalCall<T>(command, args);
      },
    );
    try {
      await click(host.querySelector("button.mail-row-main"));
      expect(host.querySelector(".reader-loading")?.textContent).toContain(
        "正在加载邮件",
      );
      expect(
        host.querySelector('.reader-loading [data-slot="skeleton"]'),
      ).not.toBeNull();
      await click(host.querySelectorAll("button.mail-row-main")[1]);
      await act(async () => {
        releaseSecond();
        await secondGate;
      });
      expect(host.querySelector(".message-heading h1")?.textContent).toBe(
        second.subject,
      );
      expect(host.querySelector(".reader-loading")).toBeNull();
      await act(async () => {
        releaseFirst();
        await firstGate;
      });
      expect(host.querySelector(".message-heading h1")?.textContent).toBe(
        second.subject,
      );
    } finally {
      releaseFirst();
      releaseSecond();
    }
  });
  it("offers retry after a mail load fails and removes the redundant folder badge", async () => {
    const originalCall = api.call;
    let fail = true;
    vi.spyOn(api, "call").mockImplementation(
      async <T,>(
        command: string,
        args: Record<string, unknown> = {},
      ): Promise<T> => {
        if (command === "mail_detail" && fail) throw new Error("模拟读取失败");
        return originalCall<T>(command, args);
      },
    );
    await click(host.querySelector("button.mail-row-main"));
    expect(host.querySelector(".reader-loading")?.textContent).toContain(
      "邮件加载失败",
    );
    expect(host.querySelector(".reader-loading .animate-spin")).toBeNull();
    fail = false;
    await click(host.querySelector(".reader-loading button"));
    expect(host.querySelector(".message-heading")).not.toBeNull();
    expect(
      host.querySelector(".message-metadata [data-slot=badge]"),
    ).toBeNull();
    expect(host.querySelector(".message-metadata time")).not.toBeNull();
    expect(host.querySelector(".message-metadata .saved-chip")).not.toBeNull();
  });
  it("expands and restores the current unread reader without remounting its content", async () => {
    await click(nav("本地存档"));
    await click(filter("未读"));
    await click(host.querySelector("button.mail-row-main"));
    const content = host.querySelector(".reader-scroll")!;
    const subject = host.querySelector(".message-heading h1")?.textContent;
    content.scrollTop = 120;
    await click(host.querySelector('button[aria-label="最大化阅读区域"]'));
    expect(host.querySelector(".app-shell.reader-expanded")).not.toBeNull();
    expect(host.querySelector(".reader-scroll")).toBe(content);
    expect(content.scrollTop).toBe(120);
    await click(host.querySelector('button[aria-label="还原阅读区域"]'));
    expect(host.querySelector(".app-shell.reader-expanded")).toBeNull();
    await click(host.querySelector('button[aria-label="最大化阅读区域"]'));
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(host.querySelector(".app-shell.reader-expanded")).toBeNull();
    expect(host.querySelector(".reader-scroll")).toBe(content);
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      subject,
    );
    expect(host.querySelector(".list-heading h1")?.textContent).toBe(
      "本地存档",
    );
    expect(filter("未读")?.getAttribute("aria-selected") === "true").toBe(true);
  });
  it.each(["全部收件箱", "本地存档", "项目协作", "星标邮件", "工作邮箱"])(
    "keeps an opened message readable in %s after marking it read",
    async (scope) => {
      await click(nav(scope));
      await click(filter("未读"));
      const row = host.querySelector("button.mail-row-main");
      const subject = row?.querySelector(".row-subject")?.textContent;
      expect(subject).toBeTruthy();
      const before = host.querySelectorAll("button.mail-row-main").length;
      await click(row);
      expect(host.querySelector(".message-heading h1")?.textContent).toBe(
        subject,
      );
      expect(
        host.querySelector(".message-body")?.textContent?.length,
      ).toBeGreaterThan(10);
      expect(host.querySelectorAll("button.mail-row-main")).toHaveLength(
        before - 1,
      );
      expect(host.querySelector('button[title="标记未读"]')).not.toBeNull();
      const title = host.querySelector(".list-heading h1")?.textContent;
      await click(filter("全部"));
      // 全部收件箱的「未读」是全局未读视图，切回「全部」后标题回到全部收件箱
      expect(host.querySelector(".list-heading h1")?.textContent).toBe(
        title === "未读邮件" ? "全部收件箱" : title,
      );
      expect(host.querySelector(".message-heading h1")?.textContent).toBe(
        subject,
      );
    },
  );
  it("keeps the final unread message open when the category becomes empty and supports marking unread again", async () => {
    await click(nav("项目协作"));
    await click(filter("未读"));
    let lastSubject = "";
    while (host.querySelector("button.mail-row-main")) {
      const row = host.querySelector("button.mail-row-main")!;
      lastSubject = row.querySelector(".row-subject")!.textContent!;
      await click(row);
    }
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      lastSubject,
    );
    await click(host.querySelector('button[title="标记未读"]'));
    expect(host.querySelectorAll("button.mail-row-main")).toHaveLength(1);
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      lastSubject,
    );
    await click(
      [...host.querySelectorAll("button")].find(
        (b) => b.textContent === "撤销",
      ) ?? null,
    );
    expect(host.querySelectorAll("button.mail-row-main")).toHaveLength(0);
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      lastSubject,
    );
    await click(nav("本地存档"));
    expect(host.querySelector(".message-heading")).toBeNull();
    expect(
      host.querySelectorAll("button.mail-row-main").length,
    ).toBeGreaterThan(1);
  });
  it("refreshes the current category when a read operation finishes after navigation", async () => {
    const seed = await snapshot(localQuery);
    seed.messages[0].sourceFolder = "Archive";
    localStorage.setItem("mail-desktop-demo-v1", JSON.stringify(seed));
    api.restoreDemo();
    await click(nav("全部收件箱"));
    await click(filter("未读"));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const originalCall = api.call;
    vi.spyOn(api, "call").mockImplementation(
      async <T,>(
        command: string,
        args: Record<string, unknown> = {},
      ): Promise<T> => {
        if (command === "update_mail" && args.action === "read") await gate;
        return originalCall<T>(command, args);
      },
    );
    try {
      await click(host.querySelector("button.mail-row-main"));
      await click(nav("本地存档"));
      expect(host.querySelectorAll("button.mail-row-main")).toHaveLength(
        seed.messages.length,
      );
      await act(async () => {
        release();
        await gate;
      });
      expect(host.querySelector(".list-heading h1")?.textContent).toBe(
        "本地存档",
      );
      expect(host.querySelectorAll("button.mail-row-main")).toHaveLength(
        seed.messages.length,
      );
      expect(host.querySelector(".message-heading")).toBeNull();
    } finally {
      release();
    }
  });
  it("returns only unread messages within each demo category", async () => {
    for (const query of [
      { ...localQuery, view: "all" },
      { ...localQuery, view: "starred" },
      { ...localQuery, view: "sent" },
      { ...localQuery, view: "trash" },
      { ...localQuery, folder: "项目协作" },
      { ...localQuery, accountId: "demo-work" },
    ]) {
      const all = await snapshot(query);
      const unread = await snapshot({ ...query, unreadOnly: true });
      expect(unread.messages.map((m) => m.id)).toEqual(
        all.messages.filter((m) => !m.isRead).map((m) => m.id),
      );
      expect(unread.matched).toBe(unread.messages.length);
    }
  });
});
describe("deleting the mail being read", () => {
  async function seedMailbox(count: number) {
    const seed = await snapshot(localQuery);
    const base = seed.messages[0];
    const newest = new Date(base.date).getTime();
    seed.messages = Array.from({ length: count }, (_, index) => ({
      ...base,
      id: `del-${index}`,
      subject: `阅读删除邮件 ${index}`,
      date: new Date(newest - index * 1000).toISOString(),
      messageId: `<del-${index}@example.com>`,
    }));
    localStorage.setItem("mail-desktop-demo-v1", JSON.stringify(seed));
    api.restoreDemo();
    await click(nav("本地存档"));
  }
  function trashInReader() {
    return host.querySelector('.reader-toolbar button[title="移到本地废纸篓"]');
  }
  it("advances the reader to the next mail after trashing the one being read", async () => {
    await seedMailbox(3);
    await click(host.querySelectorAll("button.mail-row-main")[1]);
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      "阅读删除邮件 1",
    );
    await click(trashInReader());
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      "阅读删除邮件 2",
    );
    expect(host.querySelectorAll("button.mail-row-main")).toHaveLength(2);
  });
  it("falls back to the previous mail after trashing the last one being read", async () => {
    await seedMailbox(3);
    await click(host.querySelectorAll("button.mail-row-main")[2]);
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      "阅读删除邮件 2",
    );
    await click(trashInReader());
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      "阅读删除邮件 1",
    );
  });
  it("returns the reader to its empty state after trashing the only mail", async () => {
    await seedMailbox(1);
    await click(host.querySelector("button.mail-row-main"));
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      "阅读删除邮件 0",
    );
    await click(trashInReader());
    expect(host.querySelector(".reader-welcome")).not.toBeNull();
    expect(host.querySelector(".message-heading")).toBeNull();
    expect(host.querySelector(".list-empty")).not.toBeNull();
  });
  it("keeps the reader untouched when trashing a mail that is not being read", async () => {
    await seedMailbox(3);
    await click(host.querySelector("button.mail-row-main"));
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      "阅读删除邮件 0",
    );
    await click(host.querySelectorAll('.row-check [role="checkbox"]')[2]);
    await click(host.querySelector('.batch-toolbar [title="移到本地废纸篓"]'));
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      "阅读删除邮件 0",
    );
    expect(host.querySelectorAll("button.mail-row-main")).toHaveLength(2);
  });
  it("advances the reader after permanently deleting the trash mail being read", async () => {
    await seedMailbox(3);
    for (const index of [2, 1]) {
      await click(host.querySelectorAll('.row-check [role="checkbox"]')[index]);
      await click(
        host.querySelector('.batch-toolbar [title="移到本地废纸篓"]'),
      );
    }
    await click(nav("本地废纸篓"));
    await chooseListMode("逐封邮件");
    expect(host.querySelectorAll("button.mail-row-main")).toHaveLength(2);
    await click(host.querySelector("button.mail-row-main"));
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      "阅读删除邮件 1",
    );
    await click(host.querySelector('.row-check [role="checkbox"]'));
    await click(
      host.querySelector('.batch-toolbar [title="彻底删除（含服务器副本）"]'),
    );
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      "阅读删除邮件 2",
    );
    expect(host.querySelectorAll("button.mail-row-main")).toHaveLength(1);
  });
});

it("opens saving guidance after a new account connects without submitting folder changes", async () => {
  await click(nav("设置与账号"));
  await click(
    [...host.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "添加账号",
    ) || null,
  );
  await click(
    [...document.querySelectorAll("button.provider")].find((b) =>
      b.textContent?.includes("QQ 邮箱"),
    ) || null,
  );
  const input = document.querySelector("#email") as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "fictional-test");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const realCall = api.call;
  let connected: import("./lib/types").Account | undefined;
  const mock = vi
    .spyOn(api, "call")
    .mockImplementation(async (command, args) => {
      if (command === "connect_account") {
        connected = args?.account as import("./lib/types").Account;
        expect(connected.email).toBe("fictional-test@qq.com");
        return "verified fixture" as never;
      }
      if (command === "retention_settings" && args?.id === connected?.id)
        return {
          account: connected,
          defaultSave: true,
          folders: [],
          overrides: [],
          summary: {
            dataDir: "/fixture",
            known: 0,
            saved: 0,
            savedBytes: 0,
            pending: 0,
            failedJobs: 0,
            lastSync: null,
            receiveError: null,
            warning: null,
          },
        } as never;
      return realCall(command, args);
    });
  await act(async () =>
    document
      .querySelector("form.account-form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(document.body.textContent).toContain("邮箱已连接");
  expect(document.body.textContent).toContain("本地保存状态");
  expect(document.body.textContent).toContain("fictional-test@qq.com");
  expect(mock).not.toHaveBeenCalledWith("save_retention", expect.anything());
  await click(
    [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "以后再设置",
    ) || null,
  );
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
describe("inbox scope of the aggregate badges", () => {
  async function seedFolderCounts() {
    const seed = await snapshot(localQuery);
    seed.folderTotals = [
      { accountId: seed.accounts[0].id, folder: "INBOX", count: 5 },
      { accountId: seed.accounts[0].id, folder: "Work", count: 3 },
      { accountId: seed.accounts[0].id, folder: "Sent", count: 9 },
      { accountId: seed.accounts[1].id, folder: "INBOX", count: 2 },
      { accountId: seed.accounts[1].id, folder: "Archive", count: 7 },
    ];
    seed.folderUnread = [
      { accountId: seed.accounts[0].id, folder: "INBOX", count: 1 },
      { accountId: seed.accounts[0].id, folder: "Work", count: 4 },
      { accountId: seed.accounts[1].id, folder: "INBOX", count: 3 },
      { accountId: seed.accounts[1].id, folder: "Archive", count: 8 },
    ];
    seed.remoteFolders = [
      {
        accountId: seed.accounts[0].id,
        name: "INBOX",
        displayName: "收件箱",
        delimiter: "/",
        selectable: true,
      },
      {
        accountId: seed.accounts[0].id,
        name: "Work",
        displayName: "工作",
        delimiter: "/",
        selectable: true,
      },
    ];
    localStorage.setItem("mail-desktop-demo-v1", JSON.stringify(seed));
    api.restoreDemo();
    await click(nav("全部收件箱"));
    return seed;
  }
  function counts(element: Element | null) {
    return [...(element?.querySelectorAll("em") ?? [])].map(
      (e) => e.textContent,
    );
  }
  function scopeCheckbox(label: string) {
    const row = [...host.querySelectorAll("label")].find(
      (l) => l.textContent === label,
    );
    expect(row).toBeTruthy();
    return host.querySelector(`#${row!.getAttribute("for")}`);
  }
  function scopeButton(label: string) {
    return [...host.querySelectorAll("button")].find(
      (b) => b.textContent === label,
    ) as HTMLButtonElement;
  }
  function expandScope() {
    return host.querySelector(
      '[aria-label="折叠收件箱范围"],[aria-label="展开收件箱范围"]',
    ) as HTMLButtonElement;
  }
  it("defaults unconfigured accounts to INBOX when counting badges", async () => {
    await seedFolderCounts();
    expect(counts(nav("全部收件箱"))).toEqual(["7", "4"]);
    expect(counts(host.querySelector(".list-filters"))).toEqual(["7", "4"]);
  });
  it("keeps counting the same scope after switching to the unread tab", async () => {
    await seedFolderCounts();
    await click(
      [...host.querySelectorAll(".list-filters button")].find((b) =>
        b.textContent?.startsWith("未读"),
      ) ?? null,
    );
    expect(counts(host.querySelector(".list-filters"))).toEqual(["7", "4"]);
  });
  it("keeps the demo aggregate views inside INBOX", async () => {
    const seed = await snapshot(localQuery);
    seed.messages[1].sourceFolder = "Archive";
    localStorage.setItem("mail-desktop-demo-v1", JSON.stringify(seed));
    api.restoreDemo();
    const all = await snapshot({ ...localQuery, view: "all" });
    expect(all.messages.map((m) => m.id)).not.toContain(seed.messages[1].id);
    expect(all.messages).toHaveLength(seed.messages.length - 1);
  });
  it("counts the configured folders in the demo aggregate snapshot", async () => {
    const seed = await snapshot(localQuery);
    seed.messages[1].sourceFolder = "Archive";
    seed.accounts[0].inboxFolders = ["Archive"];
    localStorage.setItem("mail-desktop-demo-v1", JSON.stringify(seed));
    api.restoreDemo();
    const all = await snapshot({ ...localQuery, view: "all" });
    expect(all.messages.map((m) => m.id)).toContain(seed.messages[1].id);
    const unread = await snapshot({ ...localQuery, view: "unread" });
    expect(unread.messages.map((m) => m.id)).toEqual(
      all.messages.filter((m) => !m.isRead).map((m) => m.id),
    );
  });
  it("counts the configured folders after saving the demo inbox scope", async () => {
    const seed = await seedFolderCounts();
    const saved = await call<Account>("save_inbox_folders", {
      accountId: seed.accounts[0].id,
      folders: ["Work"],
    });
    expect(saved.inboxFolders).toEqual(["Work"]);
    await click(nav("全部收件箱"));
    expect(counts(nav("全部收件箱"))).toEqual(["5", "7"]);
    const reset = await call<Account>("save_inbox_folders", {
      accountId: seed.accounts[0].id,
      folders: [],
    });
    expect(reset.inboxFolders).toBeNull();
    await click(nav("全部收件箱"));
    expect(counts(nav("全部收件箱"))).toEqual(["7", "4"]);
    await expect(
      call("save_inbox_folders", { accountId: "missing", folders: ["Work"] }),
    ).rejects.toThrow("账号不存在");
  });
  it("recounts the badges after saving the scope on the settings page", async () => {
    await seedFolderCounts();
    await click(nav("设置与账号"));
    expect(host.textContent).toContain("全部收件箱");
    expect(host.textContent).toContain("未配置：只含收件箱");
    await click(expandScope());
    await click(scopeCheckbox("工作"));
    await click(scopeCheckbox("收件箱"));
    await click(scopeButton("保存范围"));
    expect(counts(nav("全部收件箱"))).toEqual(["5", "7"]);
    // 保存成功后卡片自动折叠，恢复默认前需重新展开。
    await click(expandScope());
    await click(scopeButton("恢复默认"));
    expect(counts(nav("全部收件箱"))).toEqual(["7", "4"]);
  });
});

it("shows activity and diagnostics in a card and keeps the about card last", async () => {
  await click(nav("设置与账号"));
  const section = host.querySelector("section.workspace-panel")!;
  const diagnostics = section.querySelector(".diagnostics-card")!;
  expect(diagnostics).not.toBeNull();
  expect(diagnostics.textContent).toContain("活动与诊断");
  // 外层默认折叠：五个小项都不渲染
  expect(diagnostics.textContent).not.toContain("最近活动");
  await click(
    [...diagnostics.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("活动与诊断"),
    )!,
  );
  expect(diagnostics.textContent).toContain("最近活动");
  expect(diagnostics.textContent).toContain("服务器文件夹操作");
  // 除「最近活动」外的四项默认展开，「目录来源检查」的异常提示直接可见
  expect(diagnostics.textContent).toContain("异常目录暂停同步");
  expect(section.querySelector(".storage-card")).not.toBeNull();
  expect(section.querySelector(".storage-tools")).not.toBeNull();
  expect(section.querySelector(".info-strip")).not.toBeNull();
  // 关于与更新仍在 dev-note 之前。
  const about = section.querySelector(".settings-about")!;
  expect(about.textContent).toContain("关于与更新");
  expect(about.nextElementSibling?.className).toContain("dev-note");
});

it("collapses the primary sidebar navigation group with the arrow", async () => {
  const navGroup = () => host.querySelector<HTMLElement>("#primary-nav");
  expect(navGroup()).not.toBeNull();
  expect(navGroup()!.hidden).toBe(false);
  // 默认展开：5 个主导航项都在。
  for (const label of [
    "全部收件箱",
    "星标邮件",
    "已发送",
    "草稿箱",
    "发送记录",
  ]) {
    expect(nav(label)).not.toBeNull();
  }
  const toggle = () => host.querySelector("button.nav-collapse");
  expect(toggle()!.getAttribute("aria-expanded")).toBe("true");
  expect(toggle()!.getAttribute("aria-controls")).toBe("primary-nav");
  await click(toggle());
  expect(navGroup()!.hidden).toBe(true);
  expect(toggle()!.getAttribute("aria-expanded")).toBe("false");
  // 折叠只隐藏不卸载：再点一次恢复展开。
  await click(toggle());
  expect(navGroup()!.hidden).toBe(false);
  expect(toggle()!.getAttribute("aria-expanded")).toBe("true");
  for (const label of [
    "全部收件箱",
    "星标邮件",
    "已发送",
    "草稿箱",
    "发送记录",
  ]) {
    expect(nav(label)).not.toBeNull();
  }
  // 折叠状态持久化：重启后保持收起。
  expect(localStorage.getItem("mail-nav-collapsed")).toBe("false");
});

it("restores the collapsed primary navigation group after a restart", async () => {
  localStorage.setItem("mail-nav-collapsed", "true");
  // beforeEach 已挂载过 App，useState 初始化不会重跑；换新 root 重挂载模拟重启
  await act(async () => root.unmount());
  host.remove();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<App />);
  });
  expect(host.querySelector<HTMLElement>("#primary-nav")!.hidden).toBe(true);
  expect(
    host.querySelector("button.nav-collapse")!.getAttribute("aria-expanded"),
  ).toBe("false");
  expect(nav("全部收件箱")).not.toBeNull();
});

it("reloads the archive tree counts when the list refreshes", async () => {
  let inboxCount = 4;
  const originalCall = api.call;
  vi.spyOn(api, "call").mockImplementation(
    async <T,>(
      command: string,
      args: Record<string, unknown> = {},
    ): Promise<T> => {
      if (command === "local_archive_tree")
        return [
          {
            accountId: "demo-work",
            accountEmail: "demo@example.com",
            folders: [
              { name: "INBOX", displayName: "收件箱", count: inboxCount },
            ],
          },
        ] as T;
      return originalCall<T>(command, args);
    },
  );
  // 侧栏有两棵文件夹树（账号树+存档树），取 DOM 中靠后的存档树那行。
  const inboxRow = () =>
    [...host.querySelectorAll("button.folder-item")]
      .filter((b) => b.textContent?.includes("收件箱") && b.querySelector("em"))
      .pop();
  const groupTrigger = () =>
    [...host.querySelectorAll("button")].find(
      (b) => b.textContent?.includes("demo@example.com") ?? false,
    ) ?? null;
  // 导航触发 refresh：存档树按当前数据加载（默认折叠，先点「本地存档」展开账号组）。
  await click(nav("本地存档"));
  await click(nav("星标邮件"));
  await click(nav("全部收件箱"));
  await click(groupTrigger());
  expect(inboxRow()?.querySelector("em")?.textContent).toBe("4");
  // 服务器删信后同步完成再次 refresh：存档树必须同源刷新，不能留陈旧计数。
  inboxCount = 3;
  await click(nav("星标邮件"));
  await click(nav("全部收件箱"));
  expect(inboxRow()?.querySelector("em")?.textContent).toBe("3");
});
it("hides the unread tab in the sent view and keeps it in the inbox", async () => {
  await click(nav("全部收件箱"));
  expect(filter("全部")).not.toBeNull();
  expect(filter("未读")).not.toBeNull();
  await click(nav("已发送"));
  expect(filter("全部")).not.toBeNull();
  expect(filter("未读")).toBeNull();
});
it("lists an account's local drafts in its drafts folder", async () => {
  const seed = await snapshot({
    view: "all",
    accountId: "",
    search: "",
    folder: "",
    limit: 100,
    unreadOnly: false,
  });
  await call("save_draft", {
    draft: {
      ...newDraft(seed.accounts[0].id),
      subject: "账号本地草稿",
      to: "team@example.com",
      body: "草稿正文",
    },
  });
  await call("save_draft", {
    draft: {
      ...newDraft(seed.accounts[1].id),
      subject: "另一个账号的草稿",
      to: "other@example.com",
      body: "不应出现",
    },
  });
  const accountItem = () =>
    [...host.querySelectorAll("button.nav-item.account-item")].find((b) =>
      b.textContent?.includes("alex@example.com"),
    ) ?? null;
  await click(accountItem());
  await click(
    [...host.querySelectorAll(".remote-folder-list button.folder-item")].find(
      (b) => b.textContent?.includes("草稿"),
    ) ?? null,
  );
  expect(host.querySelector("h1")?.textContent).toContain("草稿箱");
  expect(host.textContent).toContain("账号本地草稿");
  expect(host.textContent).toContain("草稿正文");
  // 只显示该账号的草稿
  expect(host.textContent).not.toContain("另一个账号的草稿");
  // 账号内草稿箱同样带「写邮件」入口
  expect(
    [...host.querySelectorAll("button")].some(
      (b) => b.textContent === "写邮件",
    ),
  ).toBe(true);
});

describe("local folder management", () => {
  it("deletes a local folder from the sidebar after confirming", async () => {
    await click(nav("本地存档"));
    const calls = vi.spyOn(api, "call");
    await click(host.querySelector('[aria-label="删除本地文件夹 项目协作"]'));
    const confirm = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "删除文件夹",
    )!;
    expect(confirm).toBeTruthy();
    await click(confirm);
    expect(calls).toHaveBeenCalledWith("clear_local_folder", {
      name: "项目协作",
    });
  });
  it("offers the account's local drafts inside the local-archive group", async () => {
    const seed = await snapshot(localQuery);
    // 本地存档树按账号 "demo" 聚合，给该账号补一个草稿目录
    seed.remoteFolders = [
      {
        accountId: "demo",
        name: "Drafts",
        displayName: "草稿箱",
        delimiter: "/",
        selectable: true,
        roles: ["drafts"],
      },
    ];
    localStorage.setItem("mail-desktop-demo-v1", JSON.stringify(seed));
    api.restoreDemo();
    await click(nav("本地存档"));
    // 展开本地存档账号组
    await click(
      [...host.querySelectorAll("button.nav-item.folder-item")].find((b) =>
        b.textContent?.includes("demo@example.com"),
      ) ?? null,
    );
    const entry = [
      ...host.querySelectorAll("button.nav-item.folder-item"),
    ].find((b) => b.textContent?.includes("草稿箱"));
    expect(entry).toBeTruthy();
    await click(entry!);
    // 与账号内的草稿视图一致：显示本地草稿面板
    expect(document.body.textContent).toContain("没写完的邮件");
  });
});

describe("mail list context menu", () => {
  it("offers receive actions in the inbox and hides send/trash-only ones", async () => {
    await click(nav("全部收件箱"));
    await openRowMenu();
    const labels = menuLabels();
    expect(labels).toContain("回复");
    expect(labels).toContain("回复全部");
    expect(labels).toContain("转发");
    expect(labels).toContain("星标");
    expect(labels).toContain("已读");
    expect(labels).toContain("移动到文件夹");
    expect(labels).toContain("完整保存到本地");
    expect(labels).toContain("移到本地废纸篓");
    expect(labels).not.toContain("重新编辑");
    expect(labels).not.toContain("彻底删除（含服务器）");
  });
  it("offers re-edit and forward in the sent context", async () => {
    const seed = await snapshot(localQuery);
    const mail = seed.messages[0];
    mail.sourceFolder = "Sent";
    mail.sender = mail.accountEmail;
    localStorage.setItem("mail-desktop-demo-v1", JSON.stringify(seed));
    api.restoreDemo();
    await click(nav("已发送"));
    await openRowMenu();
    const labels = menuLabels();
    expect(labels).toContain("重新编辑");
    expect(labels).toContain("转发");
    expect(labels).not.toContain("回复");
    expect(labels).not.toContain("星标");
  });
  it("limits the trash context menu to restore and permanent delete", async () => {
    const seed = await snapshot(localQuery);
    seed.messages[0].trashed = true;
    localStorage.setItem("mail-desktop-demo-v1", JSON.stringify(seed));
    api.restoreDemo();
    await click(nav("本地废纸篓"));
    await openRowMenu();
    const labels = menuLabels();
    expect(labels).toContain("从废纸篓恢复");
    expect(labels).toContain("彻底删除（含服务器）");
    expect(labels).not.toContain("回复");
    expect(labels).not.toContain("移到本地废纸篓");
  });
  it("moves mail through the account server folders after confirmation", async () => {
    await click(
      host.querySelector('button[aria-label="展开 工作邮箱 的服务器文件夹"]'),
    );
    await click(nav("全部收件箱"));
    await openRowMenu();
    await click(
      [...document.querySelectorAll('[role="menuitem"]')].find(
        (el) => el.textContent === "移动到文件夹",
      )!,
    );
    const target = [...document.querySelectorAll('[role="menuitem"]')].find(
      (el) => el.textContent === "已发送",
    );
    expect(target).toBeTruthy();
    const calls = vi.spyOn(api, "call");
    await click(target!);
    const confirm = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "移动",
    );
    expect(confirm).toBeTruthy();
    await click(confirm!);
    expect(
      calls.mock.calls.some(([command]) => command === "queue_server_move"),
    ).toBe(true);
  });
  it("lists the account server folders in the batch move menu", async () => {
    await click(
      host.querySelector('button[aria-label="展开 工作邮箱 的服务器文件夹"]'),
    );
    await click(nav("全部收件箱"));
    await click(host.querySelector('.row-check [role="checkbox"]'));
    await act(async () => {
      host
        .querySelector('.batch-toolbar [title="移动到文件夹"]')!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
        );
    });
    const labels = [...document.querySelectorAll('[role="menuitem"]')].map(
      (el) => el.textContent || "",
    );
    expect(labels).toContain("已发送");
  });
});

describe("mail action shortcuts", () => {
  async function key(
    target: Element,
    name: string,
    options: KeyboardEventInit = {},
    prevented = false,
  ) {
    const event = new KeyboardEvent("keydown", {
      key: name,
      metaKey: true,
      bubbles: true,
      cancelable: true,
      ...options,
    });
    if (prevented) event.preventDefault();
    await act(async () => target.dispatchEvent(event));
    return event;
  }
  it.each([
    ["r", false, "Re:"],
    ["R", true, "Re:"],
    ["F", true, "Fwd:"],
  ] as const)(
    "opens the current message in compose for %s (shift=%s)",
    async (shortcut, shiftKey, prefix) => {
      await click(nav("全部收件箱"));
      await click(host.querySelector("button.mail-row-main"));
      const event = await key(host.querySelector(".reader")!, shortcut, {
        shiftKey,
      });
      expect(event.defaultPrevented).toBe(true);
      const subject = document.querySelector("#subject") as HTMLInputElement;
      expect(subject.value.startsWith(prefix)).toBe(true);
    },
  );
  it("toggles read and star on the current mail only", async () => {
    await seedReplyThread();
    await click(nav("本地存档"));
    await click(host.querySelector("button.mail-row-main"));
    const before = structuredClone(
      await snapshot({ ...localQuery, listMode: "messages" }),
    );
    const current = before.messages[0];
    await key(host.querySelector(".reader")!, "U", { shiftKey: true });
    await key(host.querySelector(".reader")!, "L", {
      metaKey: false,
      ctrlKey: true,
      shiftKey: true,
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const after = await snapshot({ ...localQuery, listMode: "messages" });
    expect(after.messages.find((m) => m.id === current.id)).toMatchObject({
      isRead: !current.isRead,
      starred: !current.starred,
    });
    for (const mail of before.messages.filter((m) => m.id !== current.id))
      expect(after.messages.find((m) => m.id === mail.id)).toMatchObject({
        isRead: mail.isRead,
        starred: mail.starred,
      });
  });
  it("ignores editor, composition, held keys and already-handled events", async () => {
    await click(host.querySelector("button.mail-row-main"));
    const calls = vi.spyOn(api, "call");
    const reader = host.querySelector(".reader")!;
    const search = host.querySelector(
      'input[placeholder="搜索当前范围的邮件…"]',
    )!;
    expect((await key(search, "r")).defaultPrevented).toBe(false);
    for (const options of [
      { repeat: true },
      { isComposing: true },
      { altKey: true },
    ])
      expect(
        (await key(reader, "L", { shiftKey: true, ...options }))
          .defaultPrevented,
      ).toBe(false);
    await key(reader, "L", { shiftKey: true }, true);
    expect(calls.mock.calls.some(([cmd]) => cmd === "update_mail")).toBe(false);
    await key(reader, "n");
    const subject = document.querySelector("#subject")!;
    await key(subject, "n");
    await key(document.body, "n");
    await key(document.body, "r");
    expect(document.querySelectorAll(".compose-dialog")).toHaveLength(1);
    expect(document.querySelector("#subject")).toBe(subject);
    expect((subject as HTMLInputElement).value).toBe("");
  });
  it("ignores shortcuts during multi-selection and while a menu is open", async () => {
    await click(host.querySelector("button.mail-row-main"));
    const calls = vi.spyOn(api, "call");
    await click(host.querySelector('.row-check [role="checkbox"]'));
    await key(host.querySelector(".reader")!, "L", { shiftKey: true });
    await click(host.querySelector('.row-check [role="checkbox"]'));
    await act(async () => {
      host
        .querySelector('button[aria-label="更多回复操作"]')!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
        );
    });
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    await key(document.body, "L", { shiftKey: true });
    expect(calls.mock.calls.some(([cmd]) => cmd === "update_mail")).toBe(false);
    expect(document.querySelector(".compose-dialog")).toBeNull();
  });
  it("does not duplicate a mutation while an earlier shortcut write is pending", async () => {
    await click(host.querySelector("button.mail-row-main"));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = api.call;
    const calls = vi
      .spyOn(api, "call")
      .mockImplementation(
        async <T,>(command: string, args: Record<string, unknown> = {}) => {
          if (command === "update_mail" && args.action === "star") await gate;
          return original<T>(command, args);
        },
      );
    await key(host.querySelector(".reader")!, "L", { shiftKey: true });
    await key(host.querySelector(".reader")!, "L", { shiftKey: true });
    expect(
      calls.mock.calls.filter(([cmd]) => cmd === "update_mail"),
    ).toHaveLength(1);
    await act(async () => {
      release();
      await gate;
    });
  });
});

describe("bulk clearing", () => {
  it("clears every draft from the draft box after confirmation", async () => {
    await api.call("save_draft", {
      draft: {
        ...newDraft("demo-work"),
        id: "draft-1",
        subject: "草稿一",
        body: "内容",
      },
    });
    await api.call("save_draft", {
      draft: {
        ...newDraft("demo-work"),
        id: "draft-2",
        subject: "草稿二",
        body: "内容",
      },
    });
    await click(nav("草稿箱"));
    expect(host.querySelectorAll(".draft-row")).toHaveLength(2);
    const calls = vi.spyOn(api, "call");
    await click(host.querySelector(".panel-heading-actions button"));
    const confirm = [
      ...document.querySelectorAll('[role="alertdialog"] button'),
    ].find((b) => b.textContent === "清空草稿");
    expect(confirm).toBeTruthy();
    await click(confirm!);
    expect(
      calls.mock.calls.filter(([command]) => command === "clear_drafts"),
    ).toHaveLength(1);
    expect(host.querySelectorAll(".draft-row")).toHaveLength(0);
  });
  it("empties the local trash with permanent deletion after confirmation", async () => {
    const seed = await snapshot(localQuery);
    seed.messages[0].trashed = true;
    seed.messages[1].trashed = true;
    localStorage.setItem("mail-desktop-demo-v1", JSON.stringify(seed));
    api.restoreDemo();
    await click(nav("本地废纸篓"));
    const calls = vi.spyOn(api, "call");
    await click(host.querySelector('[aria-label="清空本地废纸篓"]'));
    const confirm = [
      ...document.querySelectorAll('[role="alertdialog"] button'),
    ].find((b) => b.textContent === "清空废纸篓");
    expect(confirm).toBeTruthy();
    await click(confirm!);
    expect(
      calls.mock.calls.some(
        ([command, args]) =>
          command === "update_mail" &&
          (args as { action?: string }).action === "delete",
      ),
    ).toBe(true);
  });
});
describe("mail list receive actions", () => {
  it("lists every account in the header receive dropdown and defaults to all", async () => {
    await click(nav("全部收件箱"));
    const trigger = host.querySelector(
      '[aria-label="选择收取邮件的账号"]',
    ) as HTMLElement | null;
    expect(trigger).not.toBeNull();
    await act(async () => {
      trigger!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    const labels = [...document.querySelectorAll('[role="menuitem"]')].map(
      (el) => el.textContent?.trim(),
    );
    expect(labels).toContain("全部账号");
    expect(labels.some((label) => label?.includes("工作邮箱"))).toBe(true);
    expect(labels.some((label) => label?.includes("个人邮箱"))).toBe(true);
  });
  it("receives only the selected account from the header dropdown", async () => {
    const seed = await snapshot(localQuery);
    await act(async () => root.unmount());
    leaveDemo();
    vi.spyOn(api, "mailPage").mockResolvedValue({
      ...seed,
      messages: [],
      nextCursor: null,
      revision: 1,
      reset: false,
      bodyCoverage: { known: 0, unknown: 0 },
    });
    const calls = vi
      .spyOn(api, "call")
      .mockImplementation(
        async <T,>(command: string): Promise<T> =>
          (command === "sync_mail" ? 3 : []) as T,
      );
    root = createRoot(host);
    await act(async () => root.render(<App />));
    const trigger = host.querySelector(
      '[aria-label="选择收取邮件的账号"]',
    ) as HTMLElement | null;
    await act(async () => {
      trigger!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    const item = [...document.querySelectorAll('[role="menuitem"]')].find(
      (el) => el.textContent?.includes("工作邮箱"),
    );
    await click(item ?? null);
    expect(calls.mock.calls).toContainEqual(["sync_mail", { id: "demo-work" }]);
  });
});

describe("mail reader windows", () => {
  async function doubleClick(row: Element) {
    await act(async () => {
      row.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
      );
    });
  }
  it("double clicking a mail asks the desktop client for a native reader window", async () => {
    await click(nav("全部收件箱"));
    const rows = [...host.querySelectorAll("button.mail-row-main")];
    expect(rows.length).toBeGreaterThan(1);
    const info = vi.spyOn(toast, "info").mockReturnValue(0);
    await doubleClick(rows[0]);
    // 阅读窗口是真正的系统窗口，jsdom 里没有原生运行时：只提示，不假装开窗
    //（原生窗口的开、关、拖出主窗口只能装机版人工验收）。
    expect(info).toHaveBeenCalledWith("请在桌面客户端中在新窗口打开邮件");
  });
  it("offers 在新窗口打开 in the list context menu", async () => {
    await click(nav("全部收件箱"));
    await openRowMenu();
    expect(menuLabels()).toContain("在新窗口打开");
    const info = vi.spyOn(toast, "info").mockReturnValue(0);
    const item = [...document.querySelectorAll('[role="menuitem"]')].find(
      (el) => el.textContent?.includes("在新窗口打开"),
    );
    await click(item ?? null);
    expect(info).toHaveBeenCalledWith("请在桌面客户端中在新窗口打开邮件");
  });
});
