import { expect, it } from "vitest";
import {
  displaySenderName,
  formatRecipients,
  contactDisplayName,
} from "./contact-names";
import type { Address } from "./types";

const names = new Map([["alice@example.com", "老板"]]);
const alice: Address = { name: "Alice Header", email: "ALICE@example.com" };

it("prefers a saved contact name over the mail header name", () => {
  expect(displaySenderName('"Alice Header" <alice@example.com>', names)).toBe(
    "老板",
  );
  expect(contactDisplayName(alice, names)).toBe("老板");
});

it("falls back to the header name when no contact is saved", () => {
  expect(displaySenderName('"Bob Header" <bob@example.com>', names)).toBe(
    "Bob Header",
  );
  expect(
    contactDisplayName({ name: "", email: "bob@example.com" }, names),
  ).toBe("bob@example.com");
});

it("formats recipient lists with saved contact names", () => {
  expect(
    formatRecipients(
      '"Alice Header" <alice@example.com>, "Bob" <bob@example.com>',
      names,
    ),
  ).toBe('"老板" <alice@example.com>, "Bob" <bob@example.com>');
});
