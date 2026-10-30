// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SegmentDialog } from "./segment-dialog";
import * as api from "@/lib/api";
import { makeAccount } from "@/lib/providers";

let root: Root, host: HTMLDivElement;
const close = vi.fn(),
  done = vi.fn();
function button(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === label,
  )!;
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
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
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  close.mockClear();
  done.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
it("creates a same-address segment with the chosen start date", async () => {
  const account = makeAccount("qq");
  const call = vi.spyOn(api, "call").mockResolvedValue(account as never);
  await act(async () =>
    root.render(
      <SegmentDialog
        account={account}
        open
        onOpenChange={close}
        onDone={done}
      />,
    ),
  );
  const input = document.querySelector<HTMLInputElement>("#segment-name")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, "新分段");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => button("新建分段").click());
  expect(call).toHaveBeenCalledWith(
    "create_segment",
    expect.objectContaining({
      sourceId: account.id,
      name: "新分段",
      sourceName: account.name,
      syncSince: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      freezeSource: true,
    }),
  );
  expect(done).toHaveBeenCalled();
});
