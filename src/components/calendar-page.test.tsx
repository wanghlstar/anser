// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
});
