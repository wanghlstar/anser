// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StorageTools } from "./storage-tools";
import { enterDemo, leaveDemo, call } from "../lib/api";
import * as api from "../lib/api";
import { toast } from "sonner";
let root: Root, host: HTMLDivElement;
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  enterDemo();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  leaveDemo();
  vi.restoreAllMocks();
});
it("persists independent notification toggles and leaves the sync interval intact", async () => {
  await call("save_preferences", {
    preferences: {
      syncIntervalMinutes: 15,
      newMailNotifications: true,
      sendResultNotifications: true,
    },
  });
  await act(async () => root.render(<StorageTools />));
  await act(async () =>
    host.querySelector<HTMLButtonElement>("#new-mail-notifications")!.click(),
  );
  expect(await call("get_preferences")).toEqual({
    syncIntervalMinutes: 15,
    newMailNotifications: false,
    sendResultNotifications: true,
  });
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>("#send-result-notifications")!
      .click(),
  );
  expect(await call("get_preferences")).toEqual({
    syncIntervalMinutes: 15,
    newMailNotifications: false,
    sendResultNotifications: false,
  });
  await act(async () =>
    host.querySelector<HTMLButtonElement>("#auto-start")!.click(),
  );
  expect(
    (await call<{ autoStart: boolean }>("desktop_settings")).autoStart,
  ).toBe(true);
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () => root.render(<StorageTools />));
  expect(
    host.querySelector("#new-mail-notifications")?.getAttribute("aria-checked"),
  ).toBe("false");
  expect(host.querySelector("#auto-start")?.getAttribute("aria-checked")).toBe(
    "true",
  );
});
it("groups every on/off switch in the notifications and startup card", async () => {
  await act(async () => root.render(<StorageTools />));
  const switches = host.querySelector(".settings-tool-switches")!;
  expect(switches).not.toBeNull();
  expect(switches.querySelectorAll('[role="switch"]')).toHaveLength(4);
  for (const id of [
    "new-mail-notifications",
    "send-result-notifications",
    "dock-visible",
    "auto-start",
  ]) {
    expect(switches.querySelector(`#${id}`)).not.toBeNull();
  }
  // 开关全归「通知与启动」，同一张卡里不再混下拉
  const toggles = [...host.querySelectorAll(".settings-tool")].find(
    (card) => card.querySelector("h3")?.textContent === "通知与启动",
  );
  expect(toggles?.querySelector("#auto-start")).not.toBeNull();
  expect(toggles?.querySelector('[aria-label="后台检查间隔"]')).toBeNull();
  expect(
    [...host.querySelectorAll("button")].some(
      (b) => b.textContent === "测试系统通知",
    ),
  ).toBe(false);
});
it("sends a test notification when the new mail notification switch is turned on", async () => {
  await call("save_preferences", {
    preferences: {
      syncIntervalMinutes: 5,
      newMailNotifications: false,
      sendResultNotifications: true,
    },
  });
  const calls = vi.spyOn(api, "call");
  const success = vi.spyOn(toast, "success").mockReturnValue(0);
  await act(async () => root.render(<StorageTools />));
  await act(async () =>
    host.querySelector<HTMLButtonElement>("#new-mail-notifications")!.click(),
  );
  expect(calls).toHaveBeenCalledWith("test_notification");
  expect(success).toHaveBeenCalledWith("演示模式不发送系统通知");
  expect(await call("get_preferences")).toEqual({
    syncIntervalMinutes: 5,
    newMailNotifications: true,
    sendResultNotifications: true,
  });
});
it("does not send a test notification when the new mail notification switch is turned off", async () => {
  await call("save_preferences", {
    preferences: {
      syncIntervalMinutes: 5,
      newMailNotifications: true,
      sendResultNotifications: true,
    },
  });
  const calls = vi.spyOn(api, "call");
  await act(async () => root.render(<StorageTools />));
  await act(async () =>
    host.querySelector<HTMLButtonElement>("#new-mail-notifications")!.click(),
  );
  expect(
    calls.mock.calls.filter(([command]) => command === "test_notification"),
  ).toHaveLength(0);
  expect(await call("get_preferences")).toEqual({
    syncIntervalMinutes: 5,
    newMailNotifications: false,
    sendResultNotifications: true,
  });
});
it("keeps the notification and background check descriptions on one line", async () => {
  await act(async () => root.render(<StorageTools />));
  const text = host.textContent ?? "";
  expect(text).toContain(
    "新邮件和发送结果使用系统通知；首次导入旧邮件不通知，横幅由 macOS 设置控制。",
  );
  expect(text).toContain("IMAP 优先实时收取；此间隔用于定时补查和 POP3。");
});
it("does not register a development preview as a broken login startup item", async () => {
  const original = api.call;
  vi.spyOn(api, "call").mockImplementation(
    async <T,>(command: string, args: Record<string, unknown> = {}) =>
      command === "desktop_settings"
        ? ({ autoStart: false, autoStartAvailable: false } as T)
        : original<T>(command, args),
  );
  await act(async () => root.render(<StorageTools />));
  expect(host.querySelector<HTMLButtonElement>("#auto-start")?.disabled).toBe(
    true,
  );
  expect(host.textContent).toContain("请在正式应用中开启开机自启");
});
it("keeps the switch card and the dropdown card on top, then two flat cards", async () => {
  await act(async () => root.render(<StorageTools />));
  const titlesOf = (root: Element) =>
    [
      ...root.querySelectorAll(".settings-tool > h3, .settings-tool-title h3"),
    ].map((h3) => h3.textContent);
  expect(titlesOf(host.querySelector(".storage-tools-top")!)).toEqual([
    "通知与启动",
    "间隔与外观",
  ]);
  // 「外观」并入右卡后，下面两张卡整行平铺，不再分两列
  expect(
    [...host.querySelectorAll(".storage-tools > .settings-tool")].map(
      (card) => card.querySelector("h3")?.textContent,
    ),
  ).toEqual(["存档校验", "活动与诊断"]);
  expect(host.querySelector(".storage-tools-bottom")).toBeNull();
  expect(host.querySelector(".storage-tools-col")).toBeNull();
});
it("groups archive integrity under the archive tiering card", async () => {
  await act(async () => root.render(<StorageTools />));
  const tier = [...host.querySelectorAll(".settings-tool")].find(
    (card) => card.querySelector("h3")?.textContent === "存档校验",
  );
  // 校验存档与分层操作同一行；不再有独立的「存档完整性」卡片标题
  const tierText = tier?.textContent ?? "";
  for (const label of ["立即归档", "取回本地", "规范目录", "校验存档"])
    expect(tierText).toContain(label);
  expect(
    [
      ...host.querySelectorAll(".settings-tool > h3, .settings-tool-title h3"),
    ].map((h3) => h3.textContent),
  ).toEqual(["通知与启动", "间隔与外观", "存档校验", "活动与诊断"]);
  expect(host.querySelector("h4")).toBeNull();
});
it("offers the send countdown options in the interval card and saves them", async () => {
  const calls = vi.spyOn(api, "call");
  await act(async () => root.render(<StorageTools />));
  const selector = host.querySelector<HTMLButtonElement>(
    '[aria-label="延时发送时间"]',
  );
  expect(selector?.textContent).toContain("延时 5 秒");
  await act(async () => {
    selector!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
  });
  const options = [...document.querySelectorAll('[role="option"]')].map((e) =>
    e.textContent?.trim(),
  );
  expect(options).toEqual(["立即发送", "延时 3 秒", "延时 5 秒", "延时 10 秒"]);
  await act(async () =>
    (
      [...document.querySelectorAll('[role="option"]')].find(
        (e) => e.textContent?.trim() === "立即发送",
      ) as HTMLElement
    ).click(),
  );
  const card = [...host.querySelectorAll(".settings-tool")].find(
    (c) => c.querySelector("h3")?.textContent === "间隔与外观",
  );
  const save = [...card!.querySelectorAll("button")].find(
    (b) => b.textContent === "保存",
  );
  await act(async () => save!.click());
  expect(calls.mock.calls).toContainEqual([
    "save_preferences",
    {
      preferences: expect.objectContaining({
        syncIntervalMinutes: 5,
        sendCountdownSeconds: 0,
      }),
    },
  ]);
  expect(await call("get_preferences")).toEqual(
    expect.objectContaining({ sendCountdownSeconds: 0 }),
  );
});
it("keeps the scale dropdown with the two interval dropdowns in one card", async () => {
  await act(async () => root.render(<StorageTools />));
  const card = (title: string) =>
    [...host.querySelectorAll(".settings-tool")].find(
      (c) => c.querySelector("h3")?.textContent === title,
    );
  // 「外观」不再单独成卡：侧栏字号并入有下拉的卡
  expect(card("外观")).toBeUndefined();
  const intervalCard = card("间隔与外观");
  for (const label of ["后台检查间隔", "延时发送时间", "侧栏字号"])
    expect(
      intervalCard?.querySelector(`[aria-label="${label}"]`),
    ).not.toBeNull();
  expect(intervalCard?.querySelector("#dock-visible")).toBeNull();
  expect(card("通知与启动")?.querySelector("#dock-visible")).not.toBeNull();
});
it("saves the Dock icon switch immediately without touching the scale selection", async () => {
  await call("save_preferences", {
    preferences: {
      syncIntervalMinutes: 15,
      sidebarScale: 1.15,
    },
  });
  const calls = vi.spyOn(api, "call");
  await act(async () => root.render(<StorageTools />));
  await act(async () =>
    host.querySelector<HTMLButtonElement>("#dock-visible")!.click(),
  );
  expect(calls.mock.calls).toContainEqual([
    "save_preferences",
    {
      preferences: {
        syncIntervalMinutes: 15,
        sidebarScale: 1.15,
        dockVisible: false,
      },
    },
  ]);
  expect(await call("get_preferences")).toEqual({
    syncIntervalMinutes: 15,
    sidebarScale: 1.15,
    dockVisible: false,
  });
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () => root.render(<StorageTools />));
  expect(
    host.querySelector("#dock-visible")?.getAttribute("aria-checked"),
  ).toBe("false");
  expect(
    host.querySelector<HTMLButtonElement>('[aria-label="侧栏字号"]')
      ?.textContent,
  ).toBe("大");
});
it("shows the archived total and the recent tier log under the tiering card", async () => {
  await act(async () => root.render(<StorageTools />));
  expect(host.textContent).toContain("已归档 3 封");
  const trigger = [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("最近归档记录"),
  );
  expect(trigger).not.toBeUndefined();
  // 折叠时只显示触发行，不显示条目
  expect(host.textContent).not.toContain("项目对账邮件");
  await act(async () => trigger!.click());
  expect(host.textContent).toContain("项目对账邮件");
  expect(host.textContent).toContain("alice@example.com");
});
it("reloads the tier log after archiving now", async () => {
  const original = api.call;
  vi.spyOn(api, "call").mockImplementation(
    async <T,>(command: string, args: Record<string, unknown> = {}) =>
      command === "archive_tier_info"
        ? ({
            externalDir: "/Volumes/Archive",
            retentionDays: 30,
            indexEnabled: true,
            pending: 0,
            pendingBytes: 0,
            externalReachable: true,
          } as T)
        : original<T>(command, args),
  );
  const logCalls = vi.spyOn(api, "call");
  const success = vi.spyOn(toast, "success").mockReturnValue(0);
  await act(async () => root.render(<StorageTools />));
  const before = logCalls.mock.calls.filter(
    ([command]) => command === "archive_tier_log",
  ).length;
  expect(before).toBeGreaterThan(0);
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((b) => b.textContent === "立即归档")!
      .click(),
  );
  expect(success).toHaveBeenCalledWith("已归档 0 封");
  expect(
    logCalls.mock.calls.filter(([command]) => command === "archive_tier_log")
      .length,
  ).toBeGreaterThan(before);
});
it("hints that the external drive is unplugged when no archive total exists", async () => {
  const original = api.call;
  vi.spyOn(api, "call").mockImplementation(
    async <T,>(command: string, args: Record<string, unknown> = {}) =>
      command === "archive_tier_log"
        ? ({ total: null, entries: [] } as T)
        : original<T>(command, args),
  );
  await act(async () => root.render(<StorageTools />));
  expect(host.textContent).toContain("外置盘未连接");
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((b) => b.textContent?.includes("最近归档记录"))!
      .click(),
  );
  expect(host.textContent).toContain("暂无归档记录");
});
it("saves the check interval, send countdown and sidebar scale with one button", async () => {
  await call("save_preferences", {
    preferences: { syncIntervalMinutes: 5, sidebarScale: 1 },
  });
  const calls = vi.spyOn(api, "call");
  await act(async () => root.render(<StorageTools />));
  const card = [...host.querySelectorAll(".settings-tool")].find(
    (c) => c.querySelector("h3")?.textContent === "间隔与外观",
  )!;
  const save = [...card.querySelectorAll("button")].find(
    (b) => b.textContent === "保存",
  )!;
  // 三个下拉都没动时不能点
  expect(save.disabled).toBe(true);
  await act(async () =>
    card
      .querySelector<HTMLButtonElement>('[aria-label="侧栏字号"]')!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
  );
  await act(async () =>
    (
      [...document.querySelectorAll('[role="option"]')].find(
        (e) => e.textContent?.trim() === "大",
      ) as HTMLElement
    ).click(),
  );
  await act(async () => save.click());
  expect(calls.mock.calls).toContainEqual([
    "save_preferences",
    {
      preferences: expect.objectContaining({
        syncIntervalMinutes: 5,
        sendCountdownSeconds: 5,
        sidebarScale: 1.15,
      }),
    },
  ]);
});
it("keeps diagnostics collapsed as a whole and only recent activity collapsed inside", async () => {
  await act(async () => root.render(<StorageTools />));
  const card = [...host.querySelectorAll(".settings-tool")].find(
    (c) => c.querySelector("h3")?.textContent === "活动与诊断",
  )!;
  // 整行平铺：直接挂在 storage-tools 下，不再是分列布局
  expect(card.parentElement?.classList.contains("storage-tools")).toBe(true);
  // 外层默认折叠：五个小项都不渲染
  expect(card.querySelector(".diagnostics-body")).toBeNull();
  expect(card.textContent).not.toContain("服务器状态同步");
  await act(async () =>
    (
      [...card.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("活动与诊断"),
      ) as HTMLButtonElement
    ).click(),
  );
  const body = card.querySelector(".diagnostics-body")!;
  // 只取五个诊断行本身；子面板里可能还有自己的折叠块
  const rows = [...body.children].filter((el) =>
    el.matches('[data-slot="collapsible"]'),
  );
  expect(rows).toHaveLength(5);
  // 展开后「最近活动」仍折叠，其余四项默认展开
  expect(
    rows
      .find((r) => r.textContent?.includes("最近活动"))
      ?.getAttribute("data-state"),
  ).toBe("closed");
  for (const label of [
    "服务器状态同步",
    "服务器文件夹操作",
    "完整保存任务",
    "目录来源检查",
  ])
    expect(
      rows
        .find((r) => r.textContent?.includes(label))
        ?.getAttribute("data-state"),
    ).toBe("open");
});
