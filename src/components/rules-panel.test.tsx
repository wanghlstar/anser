// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { RulesPanel } from "./rules-panel";
import { SidebarProvider } from "./ui/sidebar";
import * as api from "@/lib/api";
import { makeDemo } from "@/lib/demo";
import type { FolderSettings, Rule } from "@/lib/types";
import type { RuleExecution } from "./rule-executions";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
let root: Root, host: HTMLDivElement, hits: RuleExecution[];
const data = makeDemo();
const account = data.accounts[1];
const folders = ["INBOX", "Archive", "&UXZO1mWHTvZZOQ-", "Isolated"].map(
  (name, i) => ({
    accountId: account.id,
    name,
    displayName: ["收件箱", "归档", "其他文件夹", "异常目录"][i],
    delimiter: "/",
    selectable: true,
    roles: [],
    syncError: name === "Isolated" ? "目录已隔离" : undefined,
  }),
);
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
async function render(rules: Rule[] = []) {
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
  await expandRecords();
}
// 命中记录默认折叠，测试需先展开
async function expandRecords() {
  await act(async () => {
    host
      .querySelectorAll("button")
      .forEach((b) => b.textContent?.includes("命中记录") && b.click());
  });
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
  await pickAction("move");
  // IMAP 账号：移动到文件夹落地为服务器移动，只有目标、没有来源
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
      }),
    ],
  });
});
it("stacks a local mark with the merged move and keeps its target", async () => {
  await render();
  await click("新建规则");
  await select("规则适用账号", account.email);
  await pickAction("move");
  await act(async () => {});
  await select("规则目标文件夹", "归档");
  // 勾选其它动作与移动叠加，目标保留
  await pickAction("read");
  expect(document.querySelector("#rule-target")).toBeTruthy();
  await click("预览匹配，不执行动作");
  expect(api.call).toHaveBeenLastCalledWith("preview_rule", {
    rule: expect.objectContaining({
      sourceFolder: "",
      destination: "Archive",
      action: "serverMove+read",
    }),
  });
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
  await pickAction("move");
  // Gmail / 无服务器目录：退化为本地归类，不再显示服务器目标
  expect(document.querySelector("#rule-target")).toBeNull();
  expect(document.querySelector('[aria-label="本地文件夹名称"]')).toBeTruthy();
});
