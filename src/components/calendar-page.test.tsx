// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CalendarPage } from "./calendar-page";
import { enterDemo, leaveDemo } from "@/lib/api";
import { addHours, startOfWeek } from "date-fns";

function buttonByText(text: string) {
  return [...document.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === text,
  );
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("calendar page", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    localStorage.clear();
    enterDemo();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    leaveDemo();
  });

  it("renders demo events and opens the editor", async () => {
    await act(async () =>
      root.render(<CalendarPage seed={null} onSeedConsumed={() => {}} />),
    );
    await flush();
    expect(host.textContent).toContain("项目周会");
    expect(host.textContent).toContain("设计评审");

    await act(async () => buttonByText("新建日程")!.click());
    const input = document.querySelector<HTMLInputElement>("#calendar-title");
    expect(input).not.toBeNull();
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setValue.call(input, "联调日程");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => buttonByText("保存")!.click());
    await flush();
    const stored = JSON.parse(
      localStorage.getItem("mail-desktop-demo-v1-calendar") || "[]",
    ) as { title: string }[];
    expect(stored.some((item) => item.title === "联调日程")).toBe(true);
  });

  it("switches to the agenda list and supports the new-event shortcut", async () => {
    await act(async () =>
      root.render(<CalendarPage seed={null} onSeedConsumed={() => {}} />),
    );
    await flush();
    await act(async () => buttonByText("列表")!.click());
    await flush();
    expect(host.querySelector(".calendar-list")).not.toBeNull();
    expect(host.textContent).toContain("专注时间");

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "n" }));
    });
    expect(document.querySelector("#calendar-title")).not.toBeNull();
  });

  it("edits only one occurrence of a repeating event", async () => {
    const base = startOfWeek(new Date(), { weekStartsOn: 1 });
    base.setHours(10, 0, 0, 0);
    const event = {
      id: "repeat-1",
      title: "重复周会",
      start: base.toISOString(),
      end: addHours(base, 1).toISOString(),
      allDay: false,
      location: "",
      notes: "",
      color: "blue",
      reminderMinutes: null,
      repeat: "weekly",
      createdAt: "",
      updatedAt: "",
    };
    localStorage.setItem(
      "mail-desktop-demo-v1-calendar",
      JSON.stringify([event]),
    );
    await act(async () =>
      root.render(<CalendarPage seed={null} onSeedConsumed={() => {}} />),
    );
    await flush();
    const pill = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("重复周会"),
    );
    expect(pill).not.toBeNull();
    await act(async () => pill!.click());
    const input = document.querySelector<HTMLInputElement>("#calendar-title")!;
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setValue.call(input, "只改这一次");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => buttonByText("保存")!.click());
    await flush();
    const stored = JSON.parse(
      localStorage.getItem("mail-desktop-demo-v1-calendar") || "[]",
    ) as { title: string; repeat: string }[];
    expect(
      stored.some(
        (item) => item.title === "只改这一次" && item.repeat === "none",
      ),
    ).toBe(true);
    const exceptions = JSON.parse(
      localStorage.getItem("mail-desktop-demo-v1-calendar-exceptions") || "{}",
    ) as Record<string, string[]>;
    expect(exceptions["repeat-1"]).toContain(event.start);
  });

  it("shows lunar labels and opens a day context menu", async () => {
    await act(async () =>
      root.render(<CalendarPage seed={null} onSeedConsumed={() => {}} />),
    );
    await flush();
    expect(host.querySelectorAll(".calendar-lunar").length).toBeGreaterThan(27);

    const cell = host.querySelectorAll<HTMLElement>(".calendar-month-cell")[15];
    await act(async () =>
      cell.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          clientX: 120,
          clientY: 160,
        }),
      ),
    );
    await flush();
    const item = [...document.querySelectorAll('[role="menuitem"]')].find(
      (node) => node.textContent?.includes("新建全天日程"),
    );
    expect(item).not.toBeUndefined();
    await act(async () => (item as HTMLElement).click());
    await flush();
    expect(document.querySelector("#calendar-title")).not.toBeNull();
    expect(
      document.querySelector('[role="checkbox"]')?.getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("collapses calendar categories by default", async () => {
    await act(async () =>
      root.render(<CalendarPage seed={null} onSeedConsumed={() => {}} />),
    );
    await flush();
    const section = host.querySelector(".calendar-colors")!;
    expect(section.querySelectorAll(".calendar-color-row")).toHaveLength(0);
    await act(async () => buttonByText("日历分类")!.click());
    await flush();
    expect(
      section.querySelectorAll(".calendar-color-row").length,
    ).toBeGreaterThan(0);
  });

  it("collapses the Apple calendar section", async () => {
    await act(async () =>
      root.render(<CalendarPage seed={null} onSeedConsumed={() => {}} />),
    );
    await flush();
    const section = host.querySelector(".calendar-apple")!;
    expect(section.querySelector('[data-state="open"]')).not.toBeNull();
    await act(async () => buttonByText("Apple 日历")!.click());
    await flush();
    expect(section.querySelector('[data-state="closed"]')).not.toBeNull();
  });

  it("adds and syncs the Hong Kong holiday subscription", async () => {
    await act(async () =>
      root.render(<CalendarPage seed={null} onSeedConsumed={() => {}} />),
    );
    await flush();
    const preset = buttonByText("中国香港公众假期");
    expect(preset).not.toBeUndefined();
    await act(async () => preset!.click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(host.textContent).toContain("中国香港公众假期");
    expect(host.textContent).toContain("已同步");
    expect(buttonByText("中国香港公众假期")).toBeUndefined();
    expect(buttonByText("添加中国香港公众假期")).toBeUndefined();
    const subscriptions = JSON.parse(
      localStorage.getItem("mail-desktop-demo-v1-calendar-subscriptions") ||
        "[]",
    ) as { id: string; name: string }[];
    expect(subscriptions[0]?.name).toBe("中国香港公众假期");
    const events = JSON.parse(
      localStorage.getItem(
        "mail-desktop-demo-v1-calendar-subscription-events",
      ) || "[]",
    ) as { subscriptionId: string }[];
    expect(events.length).toBe(6);
    expect(events[0]?.subscriptionId).toBe(subscriptions[0]?.id);

    const remove = host.querySelector<HTMLButtonElement>(
      'button[aria-label="删除中国香港公众假期"]',
    );
    expect(remove).not.toBeNull();
    await act(async () => remove!.click());
    await flush();
    const confirm = buttonByText("删除订阅");
    expect(confirm).not.toBeUndefined();
    await act(async () => confirm!.click());
    await flush();
    expect(
      JSON.parse(
        localStorage.getItem("mail-desktop-demo-v1-calendar-subscriptions") ||
          "[]",
      ),
    ).toEqual([]);
    expect(buttonByText("中国香港公众假期")).not.toBeUndefined();
  });

  it("shows Apple calendar as desktop-only in demo", async () => {
    await act(async () =>
      root.render(<CalendarPage seed={null} onSeedConsumed={() => {}} />),
    );
    await flush();
    expect(host.textContent).toContain("Apple 日历");
    expect(host.textContent).toContain("仅桌面客户端支持读取 Apple 日历。");
  });

  it("adds China holidays and hides lunar-only entries", async () => {
    await act(async () =>
      root.render(<CalendarPage seed={null} onSeedConsumed={() => {}} />),
    );
    await flush();
    const preset = buttonByText("中国大陆节假日");
    expect(preset).not.toBeUndefined();
    await act(async () => preset!.click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(host.textContent).toContain("中国大陆节假日");
    expect(host.textContent).toContain("已同步");
    expect(buttonByText("中国大陆节假日")).toBeUndefined();
    const events = JSON.parse(
      localStorage.getItem(
        "mail-desktop-demo-v1-calendar-subscription-events",
      ) || "[]",
    ) as { title: string; specialDay?: string }[];
    expect(events).toHaveLength(8);
    expect(events.every((item) => Boolean(item.specialDay))).toBe(true);
    expect(events.some((item) => item.title === "小寒")).toBe(false);
  });

  it("lists mainland holidays before Hong Kong", async () => {
    await act(async () =>
      root.render(<CalendarPage seed={null} onSeedConsumed={() => {}} />),
    );
    await flush();
    await act(async () => buttonByText("中国大陆节假日")!.click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    await act(async () => buttonByText("中国香港公众假期")!.click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const text = host.textContent || "";
    expect(text.indexOf("中国大陆节假日")).toBeLessThan(
      text.indexOf("中国香港公众假期"),
    );
  });

  it("edits an existing subscription", async () => {
    await act(async () =>
      root.render(<CalendarPage seed={null} onSeedConsumed={() => {}} />),
    );
    await flush();
    await act(async () => buttonByText("中国香港公众假期")!.click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const edit = host.querySelector<HTMLButtonElement>(
      'button[aria-label="编辑中国香港公众假期"]',
    );
    expect(edit).not.toBeNull();
    await act(async () => edit!.click());
    await flush();
    expect(document.body.textContent).toContain("编辑订阅日历");
    const input =
      document.querySelector<HTMLInputElement>("#subscription-name")!;
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setValue.call(input, "我的假期");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => buttonByText("保存修改")!.click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const subscriptions = JSON.parse(
      localStorage.getItem("mail-desktop-demo-v1-calendar-subscriptions") ||
        "[]",
    ) as { name: string }[];
    expect(subscriptions[0]?.name).toBe("我的假期");
    expect(host.textContent).toContain("我的假期");
  });

  it("shows subscription events as read-only and copies them locally", async () => {
    const start = new Date();
    start.setHours(10, 0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    localStorage.setItem(
      "mail-desktop-demo-v1-calendar-subscriptions",
      JSON.stringify([
        {
          id: "sub-1",
          name: "中国香港公众假期",
          url: "https://www.1823.gov.hk/common/ical/sc.ics",
          color: "orange",
          enabled: true,
          createdAt: "",
          updatedAt: "",
          lastSyncedAt: new Date().toISOString(),
          lastError: "",
        },
      ]),
    );
    localStorage.setItem(
      "mail-desktop-demo-v1-calendar-subscription-events",
      JSON.stringify([
        {
          id: "sub-1:holiday-1",
          title: "订阅假期",
          start: start.toISOString(),
          end: end.toISOString(),
          allDay: false,
          location: "",
          notes: "",
          color: "orange",
          reminderMinutes: null,
          repeat: "none",
          createdAt: "",
          updatedAt: "",
          subscriptionId: "sub-1",
        },
      ]),
    );
    await act(async () =>
      root.render(<CalendarPage seed={null} onSeedConsumed={() => {}} />),
    );
    await flush();
    const pill = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("订阅假期"),
    );
    expect(pill).not.toBeUndefined();
    await act(async () => pill!.click());
    await flush();
    expect(document.querySelector("#calendar-title")).toBeNull();

    await act(async () =>
      pill!.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          clientX: 160,
          clientY: 200,
        }),
      ),
    );
    await flush();
    const labels = [...document.querySelectorAll('[role="menuitem"]')].map(
      (node) => node.textContent,
    );
    expect(labels.some((text) => text?.includes("复制为本地日程"))).toBe(true);
    expect(labels.some((text) => text?.includes("编辑日程"))).toBe(false);
    const copy = [...document.querySelectorAll('[role="menuitem"]')].find(
      (node) => node.textContent?.includes("复制为本地日程"),
    );
    await act(async () => (copy as HTMLElement).click());
    await flush();
    const stored = JSON.parse(
      localStorage.getItem("mail-desktop-demo-v1-calendar") || "[]",
    ) as { title: string; subscriptionId?: string }[];
    expect(
      stored.some(
        (item) => item.title === "订阅假期（副本）" && !item.subscriptionId,
      ),
    ).toBe(true);
  });

  it("switches between month, week and day views", async () => {
    await act(async () =>
      root.render(<CalendarPage seed={null} onSeedConsumed={() => {}} />),
    );
    await flush();
    for (const label of ["周", "日", "月"]) {
      await act(async () => buttonByText(label)!.click());
      await flush();
    }
    expect(host.querySelector(".calendar-month")).not.toBeNull();
  });

  it("offers copy and open app for a code-only meeting event", async () => {
    const onOpenMeetingApp = vi.fn();
    const start = new Date();
    const event = {
      id: "",
      title: "项目沟通会",
      start: start.toISOString(),
      end: new Date(start.getTime() + 60 * 60_000).toISOString(),
      allDay: false,
      location: "",
      notes: "",
      color: "green" as const,
      reminderMinutes: 15,
      repeat: "none" as const,
      createdAt: "",
      updatedAt: "",
      meetingCode: "491-185-654",
      meetingProvider: "wecom" as const,
    };
    await act(async () =>
      root.render(
        <CalendarPage
          seed={event}
          onSeedConsumed={() => {}}
          onOpenMeetingApp={onOpenMeetingApp}
        />,
      ),
    );
    await flush();
    expect(document.body.textContent).toContain("复制会议号");
    expect(document.body.textContent).toContain("打开企业微信");
    await act(async () => buttonByText("打开企业微信")!.click());
    expect(onOpenMeetingApp).toHaveBeenCalledWith("wecom");
  });
});
