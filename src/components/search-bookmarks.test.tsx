// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SearchBookmarks } from "./search-bookmarks";
import type { Query } from "@/lib/types";

let root: Root, host: HTMLDivElement;
const apply = vi.fn();
const query: Query = {
  view: "all",
  accountId: "",
  search: "invoice",
  folder: "",
  limit: 200,
  unreadOnly: false,
};
function trigger() {
  return document.querySelector<HTMLButtonElement>(
    'button[title="保存的搜索"]',
  )!;
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
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
  apply.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
it("saves and reapplies the current search", async () => {
  await act(async () =>
    root.render(<SearchBookmarks query={query} onApply={apply} />),
  );
  await act(async () => {
    trigger().dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
    );
    trigger().click();
  });
  const save = [...document.querySelectorAll('[role="menuitem"]')].find(
    (node) => node.textContent?.includes("保存当前搜索"),
  );
  await act(async () => (save as HTMLElement).click());
  const saved = JSON.parse(localStorage.getItem("mail-saved-searches") || "[]");
  expect(saved).toHaveLength(1);
  expect(saved[0].query.search).toBe("invoice");
  await act(async () => {
    trigger().dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
    );
    trigger().click();
  });
  const item = [...document.querySelectorAll('[role="menuitem"]')].find(
    (node) => node.textContent?.includes("invoice"),
  );
  await act(async () => (item as HTMLElement).click());
  expect(apply).toHaveBeenCalledWith(
    expect.objectContaining({ search: "invoice" }),
  );
});
