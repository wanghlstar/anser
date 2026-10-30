// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArchiveHealthStatus, useArchiveHealth } from "./archive-health";
import * as api from "@/lib/api";
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
function Harness() {
  const { checking, health, check, progress, cancel } = useArchiveHealth();
  return (
    <>
      <button onClick={() => void check()}>快速校验</button>
      <button onClick={() => void check(true)}>深度校验</button>
      <ArchiveHealthStatus
        checking={checking}
        health={health}
        progress={progress}
        onCancel={cancel}
      />
    </>
  );
}
const health = {
  checked: 12,
  healthy: 11,
  checkedAt: "2026-10-24T10:00:00Z",
  problems: [{ mailId: "m1", subject: "Fixture", error: "missing file" }],
};
describe("archive health check", () => {
  it("checks archives and shows problems inside the complete-save card", async () => {
    const calls = vi
      .spyOn(api, "call")
      .mockResolvedValue(structuredClone(health) as never);
    await act(async () => root.render(<Harness />));
    expect(host.textContent).toContain("尚未校验");
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("快速校验"))!
        .click(),
    );
    expect(calls).toHaveBeenCalledWith("archive_health", { deep: false });
    expect(host.textContent).toContain("校验 11 / 12 封通过");
    expect(host.textContent).toContain("missing file");
    calls.mockClear();
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("深度校验"))!
        .click(),
    );
    expect(calls).toHaveBeenCalledWith("archive_health", { deep: true });
    expect(localStorage.getItem("yanxin.archiveHealth")).not.toBeNull();
  });
  it("shows progress and cancels a running check", async () => {
    let rejectCheck: (error: unknown) => void = () => {};
    const calls = vi.spyOn(api, "call").mockImplementation((command) => {
      if (command === "archive_health")
        return new Promise((_, reject) => {
          rejectCheck = reject;
        }) as never;
      if (command === "archive_health_progress")
        return Promise.resolve({
          done: 5,
          total: 12,
          deep: false,
          running: true,
        }) as never;
      if (command === "archive_health_cancel")
        return Promise.resolve() as never;
      return Promise.resolve(undefined) as never;
    });
    await act(async () => root.render(<Harness />));
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("快速校验"))!
        .click(),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    expect(host.textContent).toContain("已检查 5 / 12 封");
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("取消"))!
        .click(),
    );
    expect(calls).toHaveBeenCalledWith("archive_health_cancel");
    await act(async () => {
      rejectCheck("已取消存档校验");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.textContent).not.toContain("已检查 5 / 12 封");
  });

  it("restores the last result after remounting", async () => {
    localStorage.setItem("yanxin.archiveHealth", JSON.stringify(health));
    await act(async () => root.render(<Harness />));
    expect(host.textContent).toContain("校验 11 / 12 封通过");
    expect(host.textContent).toContain("最近校验：");
  });
});
