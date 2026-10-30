// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MailRecipientLine } from "./mail-recipient-line";
import { ContactDirectoryProvider } from "@/lib/contact-names";
import type { Contact, Mail } from "@/lib/types";

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

it("uses a saved contact name and opens it from the recipient menu", async () => {
  await act(async () => root.unmount());
  root = createRoot(host);
  const edit = vi.fn();
  const contacts: Contact[] = [
    { id: "contact-zhang", name: "张总", email: "zhang@example.com" },
  ];
  await act(async () =>
    root.render(
      <ContactDirectoryProvider contacts={contacts} onEditContact={edit}>
        <MailRecipientLine
          mail={{
            ...mail,
            recipients: '"张三" <zhang@example.com>',
            cc: "",
          }}
          detail={null}
          meta={<time dateTime={mail.date}>10:00</time>}
        />
      </ContactDirectoryProvider>,
    ),
  );
  expect(host.textContent).toContain("张总");
  expect(host.textContent).not.toContain("张三");
  const row = host.querySelector(".recipient-address-trigger")!;
  await act(async () => {
    row.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 20,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const item = [...document.querySelectorAll('[role="menuitem"]')].find(
    (node) => node.textContent?.includes("编辑联系人：张总"),
  );
  expect(item).not.toBeUndefined();
  expect(
    [...document.querySelectorAll('[role="menuitem"]')].some((node) =>
      node.textContent?.includes("复制邮箱"),
    ),
  ).toBe(true);
  expect(
    [...document.querySelectorAll('[role="menuitem"]')].some((node) =>
      node.textContent?.includes("复制姓名和邮箱"),
    ),
  ).toBe(true);
  await act(async () => (item as HTMLElement).click());
  expect(edit).toHaveBeenCalledWith(
    expect.objectContaining({ email: "zhang@example.com", name: "张三" }),
  );
});

it("composes a new mail from the recipient menu", async () => {
  await act(async () => root.unmount());
  root = createRoot(host);
  const compose = vi.fn();
  await act(async () =>
    root.render(
      <MailRecipientLine
        mail={{ ...mail, recipients: '"张三" <zhang@example.com>', cc: "" }}
        detail={null}
        meta={<time dateTime={mail.date}>10:00</time>}
        onComposeAddress={compose}
      />,
    ),
  );
  const row = host.querySelector(".recipient-address-trigger")!;
  await act(async () => {
    row.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 20,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const item = [...document.querySelectorAll('[role="menuitem"]')].find(
    (node) => node.textContent?.trim() === "写邮件",
  );
  expect(item).not.toBeUndefined();
  await act(async () => (item as HTMLElement).click());
  expect(compose).toHaveBeenCalledWith(
    expect.objectContaining({ email: "zhang@example.com" }),
  );
});
