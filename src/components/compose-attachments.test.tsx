// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ComposeAttachments, ForwardAttachments } from "./compose-attachments";
import type { ForwardFile } from "../lib/types";
import { call } from "../lib/api";
vi.mock("../lib/api", () => ({ native: true, call: vi.fn() }));
let root: Root, host: HTMLDivElement;
const paths = [
  "/Users/me/Desktop/合同.pdf",
  "/Users/me/Desktop/报表.pdf",
  "/Users/me/Desktop/图.png",
];
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.clearAllMocks();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const items = () => [
  ...host.querySelectorAll<HTMLElement>(".compose-attachment"),
];
const find = (name: string) =>
  items().find((item) => item.textContent?.includes(name))!;

it("selects on click, opens on double click and spacebar", async () => {
  vi.mocked(call).mockResolvedValue(undefined);
  await act(async () =>
    root.render(<ComposeAttachments paths={paths} onRemove={() => {}} />),
  );
  const first = find("合同.pdf");
  // 单击只选中，不再顺手打开
  await act(async () => first.click());
  expect(first.dataset.selected).toBe("true");
  expect(call).not.toHaveBeenCalled();
  // 空格打开选中项
  first.focus();
  await act(async () =>
    first.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true }),
    ),
  );
  expect(call).toHaveBeenCalledWith("open_attachment_path", {
    path: paths[0],
  });
});

it("extends the selection with meta and shift like Foxmail", async () => {
  vi.mocked(call).mockResolvedValue(undefined);
  await act(async () =>
    root.render(<ComposeAttachments paths={paths} onRemove={() => {}} />),
  );
  await act(async () => find("合同.pdf").click());
  await act(async () =>
    find("报表.pdf").dispatchEvent(
      new MouseEvent("click", { metaKey: true, bubbles: true }),
    ),
  );
  expect(items().map((item) => item.dataset.selected)).toEqual([
    "true",
    "true",
    "false",
  ]);
  // ⇧ 点击连续范围
  await act(async () =>
    find("合同.pdf").dispatchEvent(
      new MouseEvent("click", { shiftKey: true, bubbles: true }),
    ),
  );
  await act(async () =>
    find("图.png").dispatchEvent(
      new MouseEvent("click", { shiftKey: true, bubbles: true }),
    ),
  );
  expect(items().map((item) => item.dataset.selected)).toEqual([
    "true",
    "true",
    "true",
  ]);
});

it("copies the selected attachments to the clipboard", async () => {
  vi.mocked(call).mockResolvedValue(undefined);
  await act(async () =>
    root.render(<ComposeAttachments paths={paths} onRemove={() => {}} />),
  );
  await act(async () => find("合同.pdf").click());
  await act(async () =>
    find("图.png").dispatchEvent(
      new MouseEvent("click", { metaKey: true, bubbles: true }),
    ),
  );
  await act(async () =>
    host.querySelector(".compose-attachments")!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "c",
        metaKey: true,
        bubbles: true,
      }),
    ),
  );
  expect(call).toHaveBeenCalledWith("copy_attachment_paths", {
    paths: [paths[0], paths[2]],
  });
});

it("only removes the clicked attachment", async () => {
  const onRemove = vi.fn();
  await act(async () =>
    root.render(<ComposeAttachments paths={paths} onRemove={onRemove} />),
  );
  await act(async () => find("报表.pdf").querySelector("button")!.click());
  expect(onRemove).toHaveBeenCalledExactlyOnceWith(1);
});

it("opens and removes forwarded attachments like normal attachments", async () => {
  const files: ForwardFile[] = [
    {
      id: "forward-1",
      name: "SmsForwarder.json",
      mime: "application/json",
      size: 7638,
      included: true,
    },
    {
      id: "forward-2",
      name: "雁信规则.json",
      mime: "application/json",
      size: 5770,
      included: true,
    },
  ];
  const onOpen = vi.fn();
  const onRemove = vi.fn();
  await act(async () =>
    root.render(
      <ForwardAttachments files={files} onOpen={onOpen} onRemove={onRemove} />,
    ),
  );
  const first = find("SmsForwarder.json");
  await act(async () =>
    first.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
  );
  expect(onOpen).toHaveBeenCalledExactlyOnceWith(files[0]);
  await act(async () => find("雁信规则.json").querySelector("button")!.click());
  expect(onRemove).toHaveBeenCalledExactlyOnceWith(files[1]);
});
