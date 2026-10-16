import { describe, it, expect } from "vitest";
import { mailMenuKind } from "./mail-menu";

describe("mail menu kind", () => {
  it("treats the trash view or a trash server folder as trash", () => {
    expect(mailMenuKind({ view: "trash", own: false })).toBe("trash");
    expect(mailMenuKind({ view: "remote", roles: ["trash"], own: false })).toBe(
      "trash",
    );
  });
  it("treats the sent view, a sent folder, or own mail as sent", () => {
    expect(mailMenuKind({ view: "sent", own: false })).toBe("sent");
    expect(mailMenuKind({ view: "remote", roles: ["sent"], own: false })).toBe(
      "sent",
    );
    expect(mailMenuKind({ view: "local", own: true })).toBe("sent");
  });
  it("falls back to received for inbox-like contexts", () => {
    expect(mailMenuKind({ view: "all", own: false })).toBe("received");
    expect(mailMenuKind({ view: "starred", own: false })).toBe("received");
    expect(mailMenuKind({ view: "remote", roles: ["inbox"], own: false })).toBe(
      "received",
    );
    expect(mailMenuKind({ view: "local", own: false })).toBe("received");
  });
});
