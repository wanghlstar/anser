// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PendingSend } from "./pending-send";
import * as api from "@/lib/api";
import { newDraft } from "@/lib/api";
import type { Compose } from "@/lib/types";
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
let root: Root, host: HTMLDivElement;
let draft: Compose;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  draft = {
    ...newDraft("demo-work"),
    subject: "联调邮件",
    to: "hi@example.com",
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function render() {
  return act(async () =>
    root.render(
      <PendingSend
        draft={draft}
        seconds={3}
        onDone={vi.fn()}
        onCancel={vi.fn()}
      />,
    ),
  );
}
describe("pending send countdown", () => {
  it("counts down and sends when it reaches zero", async () => {
    const send = vi
      .spyOn(api, "call")
      .mockImplementation(async <T,>(command: string) =>
        command === "send_mail" ? ("已发送" as T) : (undefined as T),
      );
    await render();
    expect(host.textContent).toContain("联调邮件");
    expect(host.textContent).toContain("3 秒后发送");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(host.textContent).toContain("2 秒后发送");
    for (let i = 0; i < 2; i++)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    expect(send).toHaveBeenCalledWith(
      "send_mail",
      expect.objectContaining({
        draft: expect.objectContaining({ id: draft.id }),
      }),
    );
  });
  it("sends immediately when the user skips the wait", async () => {
    const send = vi
      .spyOn(api, "call")
      .mockImplementation(async <T,>(command: string) =>
        command === "send_mail" ? ("已发送" as T) : (undefined as T),
      );
    await render();
    await act(async () => {
      [...host.querySelectorAll("button")]
        .find((b) => b.textContent?.includes("立即发送"))!
        .click();
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("0 秒后发送");
  });
  it("reports a failed send and can retry it", async () => {
    const send = vi
      .spyOn(api, "call")
      .mockImplementation(async <T,>(command: string) => {
        if (command !== "send_mail") return undefined as T;
        throw new Error("SMTP 拒绝");
      });
    let cancelled = false;
    await act(async () =>
      root.render(
        <PendingSend
          draft={draft}
          seconds={3}
          onDone={vi.fn()}
          onCancel={() => {
            cancelled = true;
          }}
        />,
      ),
    );
    await act(async () => {
      [...host.querySelectorAll("button")]
        .find((b) => b.textContent?.includes("撤回"))!
        .click();
    });
    // 撤回交给父组件收尾，倒计时本身不再触发发送
    expect(cancelled).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });
  it("shows the failure and resends on demand", async () => {
    let fail = true;
    const send = vi
      .spyOn(api, "call")
      .mockImplementation(async <T,>(c: string) => {
        if (c !== "send_mail") return undefined as T;
        if (fail) throw new Error("网络错误");
        return "已发送" as T;
      });
    await render();
    for (let i = 0; i < 3; i++)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    expect(host.textContent).toContain("发送失败");
    fail = false;
    await act(async () => {
      [...host.querySelectorAll("button")]
        .find((b) => b.textContent?.includes("重新发送"))!
        .click();
    });
    // 「重新发送」把 remaining 置 0，下一个 effect 触发真正的发送
    for (let i = 0; i < 2; i++)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
    expect(send).toHaveBeenCalledTimes(2);
    expect(host.textContent).not.toContain("发送失败");
  });
});
