// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { RulesPanel } from "./rules-panel";
import { SidebarProvider } from "./ui/sidebar";
import * as api from "@/lib/api";
import { makeDemo } from "@/lib/demo";
import type { FolderRole, FolderSettings, Rule } from "@/lib/types";
import type { RuleExecution } from "./rule-executions";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
let root: Root, host: HTMLDivElement, hits: RuleExecution[];
const data = makeDemo();
const account = data.accounts[1];
const folders = [
  "INBOX",
  "Archive",
  "&UXZO1mWHTvZZOQ-",
  "Isolated",
  "Trash",
].map((name, i) => ({
  accountId: account.id,
  name,
  displayName: ["收件箱", "归档", "其他文件夹", "异常目录", "已删除"][i],
  delimiter: "/",
  selectable: true,
  roles: (name === "Trash" ? ["trash"] : []) as FolderRole[],
  syncError: name === "Isolated" ? "目录已隔离" : undefined,
}));
const settings: FolderSettings = { folders, mappings: [] };
const showTasks = vi.fn();
async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label,
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
/// 动作勾选项：Checkbox 是 role=checkbox 的按钮，文字在包裹它的 Label 里。
async function pickAction(action: string) {
  const checkbox = document.querySelector<HTMLButtonElement>(
    `#action-${action}`,
  );
  expect(checkbox, `找不到动作勾选项 ${action}`).toBeTruthy();
  await act(async () => checkbox!.click());
}
async function select(label: string, option: string) {
  await act(async () =>
    document
      .querySelector(`[aria-label="${label}"]`)!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
  );
  const item = [...document.querySelectorAll('[role="option"]')].find(
    (e) => e.textContent === option,
  );
  expect(item).toBeTruthy();
  await act(async () => (item as HTMLElement).click());
}
async function render(rules: Rule[] = [], expand = true) {
  await act(async () =>
    root.render(
      <SidebarProvider>
        <RulesPanel
          data={{ ...data, rules }}
          onChange={vi.fn()}
          onShowTasks={showTasks}
        />
      </SidebarProvider>,
    ),
  );
  if (expand) await expandRecords();
}
// 执行记录默认折叠，测试需先展开
async function expandRecords() {
  const trigger = host.querySelector(
    '[aria-label="展开或收起服务器规则执行记录"]',
  ) as HTMLButtonElement | null;
  if (trigger && trigger.getAttribute("aria-expanded") === "false")
    await act(async () => trigger.click());
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
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
  hits = [];
  showTasks.mockClear();
  vi.spyOn(api, "call").mockImplementation(async <T,>(command: string) => {
    if (command === "folder_settings") return settings as T;
    if (command === "rule_executions") return hits as T;
    if (command === "preview_rule") return ["example subject"] as T;
    return undefined as T;
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("merges the folder action into one move with a server target list", async () => {
  await render();
  await click("新建规则");
  await select("规则适用账号", account.email);
  // IMAP 账号：默认「移动到文件夹」落地为服务器移动，只有目标、没有来源
  expect(document.querySelector("#rule-source")).toBeNull();
  await act(async () => {});
  expect(document.querySelector("#rule-target")).toBeTruthy();
  await act(async () =>
    document
      .querySelector("#rule-target")!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
  );
  const options = [...document.querySelectorAll('[role="option"]')].map(
    (e) => e.textContent,
  );
  expect(options).not.toContain("异常目录");
  expect(options).toContain("其他文件夹");
  const target = [...document.querySelectorAll('[role="option"]')].find(
    (e) => e.textContent === "其他文件夹",
  )!;
  await act(async () => (target as HTMLElement).click());
  await click("预览匹配，不执行动作");
  expect(api.call).toHaveBeenCalledWith("preview_rule", {
    rule: expect.objectContaining({
      action: "serverMove",
      accountId: account.id,
      sourceFolder: "",
      destination: "&UXZO1mWHTvZZOQ-",
      actions: [
        {
          action: "serverMove",
          destination: "&UXZO1mWHTvZZOQ-",
          sourceFolder: "",
        },
      ],
    }),
  });
  expect(api.call).not.toHaveBeenCalledWith("run_rules");
  expect(document.body.textContent).toContain("example subject");
  await act(async () =>
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(api.call).toHaveBeenCalledWith("save_rules", {
    rules: [
      expect.objectContaining({
        sourceFolder: "",
        destination: "&UXZO1mWHTvZZOQ-",
        action: "serverMove",
        actions: [
          {
            action: "serverMove",
            destination: "&UXZO1mWHTvZZOQ-",
            sourceFolder: "",
          },
        ],
      }),
    ],
  });
});
it("uses the whole account group header to expand and collapse", async () => {
  const groupRule: Rule = {
    id: "group-rule",
    name: "发票归类",
    accountId: "",
    enabled: true,
    mode: "all",
    conditions: [{ field: "subject", operator: "contains", value: "发票" }],
    action: "read",
    destination: "",
    stop: false,
  };
  await render([groupRule]);
  const trigger = document.querySelector(
    '[aria-label="展开或收起全部账号"]',
  ) as HTMLButtonElement;
  expect(trigger).not.toBeNull();
  // 分组默认隐藏，和改造前一致。
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(document.querySelector(".rule-group-card")?.textContent).toContain(
    "1 条",
  );
  // 点标题整块展开。
  await act(async () =>
    (trigger.querySelector("span span:first-child") as HTMLElement).click(),
  );
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  // 点说明文字也能收起，不要求点箭头。
  await act(async () =>
    (trigger.querySelector("span span:last-child") as HTMLElement).click(),
  );
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

it("offers choice, number and calendar condition values", async () => {
  await render();
  await click("新建规则");
  // 优先级：比较方式固定为等于，值改为下拉选择
  await select("条件字段", "优先级");
  expect(document.querySelector('[aria-label="条件值"]')).not.toBeNull();
  await select("条件值", "高");
  // 邮件大小/已接收天数：数字输入
  await select("条件字段", "邮件大小（KB）");
  expect(
    document
      .querySelector<HTMLInputElement>('[aria-label="条件值"]')
      ?.getAttribute("type"),
  ).toBe("number");
  // 日期：必须走 shadcn Calendar + Popover，不用原生 date 输入
  await select("条件字段", "邮件日期");
  expect(document.querySelector('[aria-label="条件日期"]')).not.toBeNull();
  expect(document.querySelector('input[type="date"]')).toBeNull();
  // 文字条件提供「以此开头 / 以此结尾」
  await select("条件字段", "主题");
  await select("条件比较", "以此开头");
  expect(
    document.querySelector('[aria-label="条件比较"]')?.textContent,
  ).toContain("以此开头");
});

it("shows how many previews wait for the full message", async () => {
  vi.mocked(api.call).mockImplementation(async <T,>(command: string) => {
    if (command === "folder_settings") return settings as T;
    if (command === "rule_executions") return hits as T;
    if (command === "preview_rule") return ["等待项（等待完整邮件核对）"] as T;
    return undefined as T;
  });
  await render();
  await click("新建规则");
  await click("预览匹配，不执行动作");
  expect(document.body.textContent).toContain(
    "本次预览 0 项匹配，另有 1 项等待完整邮件核对后确认",
  );
});

it("stacks a local mark with the merged move and keeps its target", async () => {
  await render();
  await click("新建规则");
  await select("规则适用账号", account.email);
  await act(async () => {});
  await select("规则目标文件夹", "归档");
  // 添加第二个有序动作，移动目标保留
  await click("添加动作");
  expect(document.querySelector("#rule-target")).toBeTruthy();
  await click("预览匹配，不执行动作");
  expect(api.call).toHaveBeenLastCalledWith("preview_rule", {
    rule: expect.objectContaining({
      sourceFolder: "",
      destination: "Archive",
      action: "serverMove",
      actions: [
        { action: "serverMove", destination: "Archive", sourceFolder: "" },
        { action: "read", destination: "", sourceFolder: "" },
      ],
    }),
  });
});
it("keeps server execution records collapsed until the card header is clicked", async () => {
  hits = [
    {
      id: "one",
      ruleName: "发票归类",
      accountEmail: account.email,
      subject: "发票",
      action: "serverMove",
      source: "收件箱",
      target: "归档",
      status: "completed",
      error: "",
      operationId: "task",
      updatedAt: "",
    },
  ];
  await render([], false);
  const trigger = document.querySelector(
    '[aria-label="展开或收起服务器规则执行记录"]',
  ) as HTMLButtonElement;
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(
    document.querySelector('[aria-label="服务器规则命中记录"]'),
  ).toBeNull();
  // 旧的「命中记录（N / N）」独立行已移除。
  expect(document.body.textContent).not.toContain("命中记录（");
  await act(async () => trigger.click());
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(
    document.querySelector('[aria-label="服务器规则命中记录"]'),
  ).not.toBeNull();
});

it("shows task uncertainty without offering replay and retries only a failed enqueue", async () => {
  hits = ["uncertain", "blocked", "completed"].map((status) => ({
    id: status,
    ruleName: "发票归类",
    accountEmail: account.email,
    subject: status,
    action: "serverMove",
    source: "收件箱",
    target: "归档",
    status,
    error: status === "uncertain" ? "连接中断，结果未确认" : "",
    operationId: status === "blocked" ? null : "task",
    updatedAt: "",
  }));
  await render();
  expect(document.body.textContent).toContain("结果未确认");
  expect(document.body.textContent).toContain("连接中断，结果未确认");
  await click("查看服务器任务");
  expect(showTasks).toHaveBeenCalledOnce();
  await click("重新检查并入队");
  expect(api.call).toHaveBeenCalledWith("retry_rule_execution", {
    id: "blocked",
  });
  expect(api.call).not.toHaveBeenCalledWith(
    "directory_operation_action",
    expect.anything(),
  );
});
it("degrades the merged move to a local folder for a non-IMAP account", async () => {
  await render();
  await click("新建规则");
  await select("规则适用账号", data.accounts[0].email);
  // Gmail / 无服务器目录：保留本地归类，不再显示服务器目标
  expect(document.querySelector("#rule-target")).toBeNull();
  expect(document.querySelector('[aria-label="本地文件夹名称"]')).toBeTruthy();
});

it("pins a rule trash target and confirms permanent delete", async () => {
  await render();
  await click("新建规则");
  await select("规则适用账号", account.email);
  await select("规则执行动作", "移到已删除");
  expect(document.querySelector("#rule-target")).not.toBeNull();
  await select("规则目标文件夹", "已删除");
  await act(async () =>
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(api.call).toHaveBeenCalledWith("save_rules", {
    rules: [
      expect.objectContaining({
        action: "trash",
        destination: "Trash",
        actions: [{ action: "trash", destination: "Trash", sourceFolder: "" }],
      }),
    ],
  });
});

it("requires a confirmation before saving a permanent delete rule", async () => {
  await render();
  await click("新建规则");
  await select("规则执行动作", "彻底删除（含服务器副本）");
  expect(
    [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "添加动作",
    )?.disabled,
  ).toBe(true);
  await act(async () =>
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(api.call).not.toHaveBeenCalledWith("save_rules", expect.anything());
  expect(document.body.textContent).toContain("保存含「彻底删除」的规则？");
  await click("确认保存");
  expect(api.call).toHaveBeenCalledWith("save_rules", {
    rules: [
      expect.objectContaining({
        action: "delete",
        actions: [{ action: "delete", destination: "", sourceFolder: "" }],
      }),
    ],
  });
});
