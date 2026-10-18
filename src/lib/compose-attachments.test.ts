import { expect, it } from "vitest";
import { attachmentSubject } from "./compose-attachments";

it("names an empty subject after the first attachment without its extension", () => {
  expect(attachmentSubject("", ["/Users/me/合同.pdf"])).toBe("合同");
  expect(attachmentSubject("   ", ["/Users/me/报表.xlsx"])).toBe("报表");
  expect(attachmentSubject("", ["/Users/me/备份.tar.gz"])).toBe("备份.tar");
});

it("keeps names that have no extension or only a leading dot", () => {
  expect(attachmentSubject("", ["/Users/me/README"])).toBe("README");
  expect(attachmentSubject("", ["/Users/me/.gitignore"])).toBe(".gitignore");
});

it("keeps a subject the user already wrote", () => {
  expect(attachmentSubject("月报", ["/Users/me/合同.pdf"])).toBe("月报");
});

it("leaves the subject alone when there is nothing attached", () => {
  expect(attachmentSubject("", [])).toBe("");
});
