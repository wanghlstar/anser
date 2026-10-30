// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { ContactHistoryDialog } from "./contact-history-dialog";

let root: Root, host: HTMLDivElement;
const close = vi.fn(),
  imported = vi.fn();
const candidates = [
  {
    name: "Alice",
    email: "alice@example.com",
    count: 3,
    lastSeen: "2026-10-01T10:00:00+08:00",
  },
  {
    name: "Bob",
    email: "bob@example.com",
    count: 1,
    lastSeen: "2026-10-02T10:00:00+08:00",
  },
];
function button(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === label,
  )!;
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  close.mockClear();
  imported.mockClear();
  vi.spyOn(api, "call").mockImplementation((command: string) => {
    if (command === "contact_history")
      return Promise.resolve(candidates) as never;
    if (command === "contact_blacklist") return Promise.resolve([]) as never;
    if (command === "set_contact_ignored") return Promise.resolve() as never;
    if (command === "import_contacts")
      return Promise.resolve({ imported: 1, skipped: 0 }) as never;
    return Promise.reject(new Error(`unexpected ${command}`)) as never;
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
it("preselects repeated correspondents and imports the checked candidates", async () => {
  await act(async () =>
    root.render(
      <ContactHistoryDialog
        open
        contacts={[]}
        onClose={close}
        onImported={imported}
      />,
    ),
  );
  await act(async () => await new Promise((resolve) => setTimeout(resolve, 0)));
  expect(document.body.textContent).toContain("Alice");
  expect(document.body.textContent).toContain("Bob");
  await act(async () => button("导入 1 位联系人").click());
  const call = api.call as unknown as ReturnType<typeof vi.fn>;
  expect(call).toHaveBeenCalledWith("import_contacts", {
    candidates: [candidates[0]],
  });
  expect(imported).toHaveBeenCalled();
  expect(close).toHaveBeenCalled();
});

it("blocks an unwanted sender and keeps it out of the candidate list", async () => {
  await act(async () =>
    root.render(
      <ContactHistoryDialog
        open
        contacts={[]}
        onClose={close}
        onImported={imported}
      />,
    ),
  );
  await act(async () => await new Promise((resolve) => setTimeout(resolve, 0)));
  const block = document.querySelector<HTMLButtonElement>(
    'button[aria-label="屏蔽 alice@example.com"]',
  )!;
  await act(async () => block.click());
  const call = api.call as unknown as ReturnType<typeof vi.fn>;
  expect(call).toHaveBeenCalledWith("set_contact_ignored", {
    email: "alice@example.com",
    ignored: true,
  });
  expect(document.body.textContent).not.toContain("alice@example.com");
  expect(document.body.textContent).toContain("已屏蔽 1");
});

it("edits the candidate name without saving a contact immediately", async () => {
  await act(async () =>
    root.render(
      <ContactHistoryDialog
        open
        contacts={[]}
        onClose={close}
        onImported={imported}
      />,
    ),
  );
  await act(async () => await new Promise((resolve) => setTimeout(resolve, 0)));
  const edit = document.querySelector<HTMLButtonElement>(
    'button[aria-label="编辑 alice@example.com 的姓名"]',
  )!;
  await act(async () => edit.click());
  const input = document.querySelector<HTMLInputElement>(
    "#contact-history-name",
  )!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, "Alice 同事");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => button("保存姓名").click());
  expect(document.body.textContent).toContain("Alice 同事");
  expect(
    api.call as unknown as ReturnType<typeof vi.fn>,
  ).not.toHaveBeenCalledWith("save_contact", expect.anything());
});
