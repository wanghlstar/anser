// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MailContent } from "./mail-content";
import { MAIL_IMAGE_TIMEOUT_MS } from "../lib/mail-images";

const platform = vi.hoisted(() => ({ native: false }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => platform.native }));

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  platform.native = false;
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function load() {
  await act(async () =>
    root.render(
      <MailContent
        html={
          '<p>Body</p><img src="https://example.com/slow.png"><img src="data:image/png;base64,aGVsbG8=">'
        }
        onOpenLink={() => {}}
      />,
    ),
  );
  const frame = host.querySelector("iframe")!;
  const doc = new DOMParser().parseFromString(frame.srcdoc, "text/html");
  Object.defineProperty(frame, "contentDocument", {
    value: doc,
    configurable: true,
  });
  vi.spyOn(doc, "createRange").mockReturnValue({
    selectNodeContents() {},
    getBoundingClientRect: () => new DOMRect(0, 0, 400, 100),
  } as unknown as Range);
  let complete = false;
  Object.defineProperties(doc.images[0], {
    complete: { get: () => complete },
    naturalWidth: { get: () => (complete ? 100 : 0) },
  });
  Object.defineProperties(doc.images[1], {
    complete: { value: true },
    naturalWidth: { value: 100 },
  });
  await act(async () => frame.dispatchEvent(new Event("load")));
  return {
    doc,
    finish: () => {
      complete = true;
    },
  };
}

it("shows a retry notice after the deadline and clears it on a late success", async () => {
  const { finish } = await load();
  expect(host.querySelector('[aria-label="正在加载图片"]')).not.toBeNull();
  await act(async () => vi.advanceTimersByTime(MAIL_IMAGE_TIMEOUT_MS));
  expect(host.querySelector('[aria-label="正在加载图片"]')).toBeNull();
  expect(host.textContent).toContain("有 1 张正文图片未加载（1 张超时）");
  const retry = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "重新加载图片",
  )!;
  expect(retry).toBeTruthy();
  await act(async () => retry.click());
  expect(host.querySelector('[aria-label="正在加载图片"]')).not.toBeNull();
  finish();
  await act(async () => vi.advanceTimersByTime(1000));
  expect(host.querySelector('[aria-label="正在加载图片"]')).toBeNull();
  expect(host.textContent).not.toContain("张正文图片未加载");
});
