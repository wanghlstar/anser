// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DiagnosticsDialog } from "./diagnostics-dialog";
import * as api from "@/lib/api";
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
it("runs diagnostics and renders pass/fail items", async () => {
  const call = vi.spyOn(api, "call").mockResolvedValue({
    generatedAt: "2026-10-24T14:00:00Z",
    items: [
      { label: "数据库", status: "pass", detail: "SQLite quick_check 通过" },
      { label: "存档文件", status: "warn", detail: "1 封找不到原件" },
    ],
  } as never);
  await act(async () => {
    root.render(
      <DiagnosticsDialog open account={null} onOpenChange={() => {}} />,
    );
  });
  expect(call).not.toHaveBeenCalledWith("run_diagnostics", {
    accountId: null,
  });
  await act(async () => {
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "开始检查")!
      .click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(call).toHaveBeenCalledWith("run_diagnostics", { accountId: null });
  expect(document.body.textContent).toContain("数据库");
  expect(document.body.textContent).toContain("SQLite quick_check 通过");
  expect(document.body.textContent).toContain("1 封找不到原件");
  expect(document.body.textContent).toContain("注意");
});
