// @vitest-environment jsdom
import { expect, it } from "vitest";
import { applySearchHighlight } from "./mail-content";

it("marks search hits inside mail HTML without changing the rest of the document", () => {
  const doc = document.implementation.createHTMLDocument("邮件");
  doc.body.innerHTML = "<p>周末讨论的想法</p><style>.x{color:red}</style>";
  applySearchHighlight(doc, "想法");
  const marks = doc.querySelectorAll("mark.search-hit");
  expect(marks).toHaveLength(1);
  expect(marks[0].textContent).toBe("想法");
  expect(doc.querySelector("style")?.textContent).toContain(".x");
});
it("removes old marks before applying a new term", () => {
  const doc = document.implementation.createHTMLDocument("邮件");
  doc.body.innerHTML = "<p>alpha beta</p>";
  applySearchHighlight(doc, "alpha");
  applySearchHighlight(doc, "beta");
  expect(doc.querySelectorAll("mark")).toHaveLength(1);
  expect(doc.querySelector("mark")?.textContent).toBe("beta");
});
