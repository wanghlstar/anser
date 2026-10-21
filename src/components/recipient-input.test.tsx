// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RecipientInput } from "./recipient-input";

let root: Root, host: HTMLDivElement;
const suggestions = [
  { name: "Alice", email: "alice@example.com" },
  { name: "Alex", email: "alex@example.com" },
];
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
  HTMLElement.prototype.scrollIntoView = vi.fn();
  function Harness() {
    const [value, setValue] = useState("first@example.com, al");
    return (
      <RecipientInput
        id="recipient-test"
        value={value}
        onChange={setValue}
        suggestions={suggestions}
      />
    );
  }
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
  await act(async () =>
    (host.querySelector("input") as HTMLInputElement).focus(),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("keeps input focus and completes the active suggestion by keyboard without replacing prior recipients", async () => {
  const input = host.querySelector("input")!;
  expect(document.querySelector('[data-slot="command"]')).toBeTruthy();
  expect(
    document.getElementById(input.getAttribute("aria-controls")!),
  ).toBeTruthy();
  expect(
    document.getElementById(input.getAttribute("aria-activedescendant")!)
      ?.textContent,
  ).toContain("Alice");
  expect(document.activeElement).toBe(input);
  await act(async () =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    ),
  );
  expect(
    document.getElementById(input.getAttribute("aria-activedescendant")!)
      ?.textContent,
  ).toContain("Alex");
  await act(async () =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
  expect(host.textContent).toContain("first@example.com");
  expect(host.textContent).toContain("Alex");
  expect(input.value).toBe("");
  expect(input.getAttribute("aria-expanded")).toBe("false");
});
it("completes a pointer selection and closes the shadcn suggestion popup", async () => {
  const option = [...document.querySelectorAll("[cmdk-item]")].find((e) =>
    e.textContent?.includes("Alice"),
  )!;
  await act(async () => (option as HTMLElement).click());
  expect(host.textContent).toContain("first@example.com");
  expect(host.textContent).toContain("Alice");
  expect(host.querySelector("input")!.value).toBe("");
  expect(host.querySelector("input")!.getAttribute("aria-expanded")).toBe(
    "false",
  );
});

it("fills the row before folding excess recipients and expands all of them", async () => {
  const rect = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(
    function (this: Element) {
      return this.classList.contains("recipient-input") ? 400 : 0;
    },
  );
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      const element = this as HTMLElement;
      const width = element.classList.contains("recipient-more")
        ? 35
        : element.classList.contains("recipient-chip")
          ? 90
          : null;
      return width === null ? rect.call(element) : new DOMRect(0, 0, width, 20);
    },
  );
  function Many() {
    const [value, setValue] = useState(
      "a@example.com, b@example.com, c@example.com, d@example.com, ",
    );
    return (
      <RecipientInput
        id="many-recipients"
        value={value}
        onChange={setValue}
        suggestions={suggestions}
      />
    );
  }
  await act(async () => root.unmount());
  host.remove();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Many />));
  expect(
    host.querySelectorAll(".recipient-chips .recipient-chip"),
  ).toHaveLength(3);
  expect(host.textContent).toContain("+2");
  const more = host.querySelector('[aria-label="展开另外 2 个收件人"]');
  expect(more).toBeTruthy();
  await act(async () => (more as HTMLElement).click());
  expect(host.textContent).not.toContain("+2");
  expect(host.textContent).toContain("c@example.com");
  expect(host.textContent).toContain("d@example.com");
  const remove = host.querySelector('[aria-label="移除收件人 b@example.com"]');
  await act(async () => (remove as HTMLElement).click());
  expect(host.textContent).not.toContain("b@example.com");
});
