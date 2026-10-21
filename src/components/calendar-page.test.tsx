// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CalendarPage } from "./calendar-page";
import { enterDemo, leaveDemo } from "@/lib/api";

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
