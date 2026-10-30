// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ArchiveIo } from "./archive-io";

const { callMock } = vi.hoisted(() => ({ callMock: vi.fn() }));
vi.mock("@/lib/api", () => ({
  call: callMock,
  native: true,
  isDemo: () => false,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => ["/tmp/mail.eml"]),
}));

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  callMock.mockImplementation(async (command: string) => {
    if (command === "snapshot")
      return {
        accounts: [
          {
            id: "account",
            name: "工作邮箱",
            email: "me@example.com",
            readOnly: false,
          },
        ],
        messages: [],
      };
    if (command === "archive_groups") return [];
    if (command === "archive_tier_info")
      return {
        externalDir: "/Volumes/Archive",
        importLocation: "external",
        retentionDays: 30,
        indexEnabled: true,
        pending: 0,
        pendingBytes: 0,
        externalReachable: true,
      };
    if (command === "eml_import_jobs") return [];
    return [];
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  callMock.mockReset();
});
it("shows the import destination and external availability", async () => {
  await act(async () => root.render(<ArchiveIo />));
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("导入邮件"))!
      .click(),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  const text = document.body.textContent ?? "";
  expect(text).toContain("本次保存到：");
  expect(text).toContain("外置存档");
  expect(text).toContain("/Volumes/Archive · 可用");
});

it("creates an archive group from the entered name", async () => {
  const { open } = await import("@tauri-apps/plugin-dialog");
  vi.mocked(open).mockResolvedValueOnce("/tmp/Foxmail2026");
  const calls: [string, unknown][] = [];
  callMock.mockImplementation(async (command: string, args: unknown) => {
    calls.push([command, args]);
    if (command === "snapshot")
      return {
        accounts: [
          {
            id: "account",
            name: "工作邮箱",
            email: "me@example.com",
            readOnly: false,
          },
        ],
        messages: [],
      };
    if (command === "archive_groups") return [];
    if (command === "archive_tier_info")
      return {
        externalDir: null,
        importLocation: "internal",
        retentionDays: 30,
        indexEnabled: true,
        pending: 0,
        pendingBytes: 0,
        externalReachable: false,
      };
    if (command === "eml_import_jobs") return [];
    if (command === "create_archive_group")
      return { id: "archive:new", name: (args as { name: string }).name };
    if (command === "prepare_eml_import_tree")
      return {
        id: "job",
        total: 1,
        processed: 0,
        added: 0,
        upgraded: 0,
        duplicate: 0,
        failed: 0,
        status: "queued",
      };
    if (command === "eml_import_job")
      return {
        id: "job",
        total: 1,
        processed: 0,
        added: 0,
        upgraded: 0,
        duplicate: 0,
        failed: 0,
        status: "queued",
      };
    return null;
  });
  await act(async () => root.render(<ArchiveIo />));
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("导入文件夹"))!
      .click(),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(document.body.textContent).toContain("本地归档 · 新建组");
  expect(document.body.textContent).toContain("自定义名称组");
  const input = document.body.querySelector(
    "#import-group-name",
  ) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    setter.call(input, "Foxmail2026");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    [...document.body.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "导入")!
      .click(),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(
    calls.some(
      ([command, args]) =>
        command === "create_archive_group" &&
        (args as { name: string }).name === "Foxmail2026",
    ),
  ).toBe(true);
  expect(
    calls.some(
      ([command, args]) =>
        command === "prepare_eml_import_tree" &&
        (args as { accountId: string; folder: string }).accountId ===
          "archive:new" &&
        (args as { folder: string }).folder === "",
    ),
  ).toBe(true);
});
