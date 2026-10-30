// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { Highlight } from "./highlight";

let root: Root, host: HTMLDivElement;
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("marks every case-insensitive occurrence with a yellow search hit", async () => {
  await act(async () =>
    root.render(<Highlight text="Invoice invoice" query="INVOICE" />),
  );
  const marks = host.querySelectorAll("mark.search-hit");
  expect(marks).toHaveLength(2);
  expect([...marks].map((mark) => mark.textContent)).toEqual([
    "Invoice",
    "invoice",
  ]);
});
it("renders plain text when the search is empty", async () => {
  await act(async () => root.render(<Highlight text="正文" query=" " />));
  expect(host.querySelector("mark")).toBeNull();
  expect(host.textContent).toBe("正文");
});
