// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { MailRecipientLine } from "./mail-recipient-line";
import type { Mail } from "@/lib/types";

let root: Root, host: HTMLDivElement;
const mail: Mail = {
  id: "recipient-line",
  accountId: "account",
  accountEmail: "me@example.com",
  sender: '"Sender" <sender@example.com>',
  recipients:
    '"张三" <zhang@example.com>, "李四" <li@example.com>, "王五" <wang@example.com>, "赵六" <zhao@example.com>, "钱七" <qian@example.com>, "孙八" <sun@example.com>, "周九" <zhou@example.com>',
  cc: '"吴十" <wu@example.com>, "郑一" <zheng@example.com>, "王二" <wang2@example.com>, "冯三" <feng@example.com>, "陈四" <chen@example.com>, "褚五" <chu@example.com>, "卫六" <wei@example.com>',
  subject: "Recipients",
  preview: "",
  body: "",
  date: "2026-10-21T08:00:00Z",
  isRead: true,
  starred: false,
  localFolder: "收件箱",
  trashed: false,
  hasAttachments: false,
  hash: "hash",
  size: 1,
  savedAt: "2026-10-21T08:00:00Z",
  sourceFolder: "INBOX",
  messageId: "<recipient-line@example.com>",
};
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <MailRecipientLine
        mail={mail}
        detail={null}
        meta={<time dateTime={mail.date}>10:00</time>}
      />,
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("puts recipients and cc on separate lines and collapses each after six", async () => {
  expect(host.querySelectorAll(".recipient-row")).toHaveLength(2);
  expect(host.textContent).toContain(
    "收件人：张三、李四、王五、赵六、钱七、孙八 +1",
  );
  expect(host.textContent).toContain(
    "抄送：吴十、郑一、王二、冯三、陈四、褚五 +1",
  );
  expect(host.textContent).not.toContain("sender@example.com");
  expect(host.querySelectorAll(".recipient-row-collapsed")).toHaveLength(2);
});
it("opens the full headers by clicking anywhere on a collapsed row", async () => {
  const row = host.querySelector(".recipient-row-collapsed")!;
  expect(row.getAttribute("aria-expanded")).toBe("false");
  await act(async () => (row as HTMLElement).click());
  expect(row.getAttribute("aria-expanded")).toBe("true");
  expect(host.textContent).toContain("sender@example.com");
  expect(host.textContent).toContain("zhou@example.com");
  expect(host.textContent).toContain("wei@example.com");
  expect(host.textContent).toContain("<recipient-line@example.com>");
  const toggle = host.querySelector(".recipient-details-toggle")!;
  await act(async () => (toggle as HTMLElement).click());
  expect(host.querySelector(".recipient-details")).toBeNull();
});
