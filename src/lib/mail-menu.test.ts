import { describe, it, expect } from "vitest";
import { mailMenuKind } from "./mail-menu";

describe("mail menu kind", () => {
  it("treats the trash view or a trash server folder as trash", () => {
    expect(mailMenuKind({ view: "trash" })).toBe("trash");
    expect(mailMenuKind({ view: "remote", roles: ["trash"] })).toBe("trash");
  });
  it("treats the sent view or a sent folder as sent", () => {
    expect(mailMenuKind({ view: "sent" })).toBe("sent");
    expect(mailMenuKind({ view: "remote", roles: ["sent"] })).toBe("sent");
  });
  it("falls back to received for inbox-like contexts, including self-sent mail", () => {
    expect(mailMenuKind({ view: "all" })).toBe("received");
    expect(mailMenuKind({ view: "starred" })).toBe("received");
    expect(mailMenuKind({ view: "remote", roles: ["inbox"] })).toBe("received");
    expect(mailMenuKind({ view: "local" })).toBe("received");
  });
});
