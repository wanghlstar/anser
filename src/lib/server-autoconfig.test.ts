import { describe, expect, it } from "vitest";
import { suggestServers } from "./server-autoconfig";
describe("server autoconfig", () => {
  it("uses known provider settings", () => {
    expect(suggestServers("me@qq.com", "imap")).toMatchObject({
      incomingHost: "imap.qq.com",
      incomingPort: 993,
      smtpHost: "smtp.qq.com",
      smtpPort: 465,
    });
    expect(suggestServers("me@outlook.com", "imap")).toMatchObject({
      smtpHost: "smtp-mail.outlook.com",
      smtpPort: 587,
      smtpTls: "starttls",
    });
  });
  it("guesses corporate domains from the mail host convention", () => {
    expect(suggestServers("me@example.com.cn", "imap")).toEqual({
      incomingHost: "imap.example.com.cn",
      incomingPort: 993,
      incomingTls: "tls",
      smtpHost: "smtp.example.com.cn",
      smtpPort: 465,
      smtpTls: "tls",
    });
    expect(suggestServers("me@example.com", "pop3")).toMatchObject({
      incomingHost: "pop.example.com",
      incomingPort: 995,
    });
  });
});
