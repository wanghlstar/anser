import type { Account } from "./types";

type Known = {
  imap: string;
  pop: string;
  smtp: string;
  smtpPort: number;
  smtpTls: "tls" | "starttls";
};

const known: Record<string, Known> = {
  "gmail.com": {
    imap: "imap.gmail.com",
    pop: "pop.gmail.com",
    smtp: "smtp.gmail.com",
    smtpPort: 465,
    smtpTls: "tls",
  },
  "googlemail.com": {
    imap: "imap.gmail.com",
    pop: "pop.gmail.com",
    smtp: "smtp.gmail.com",
    smtpPort: 465,
    smtpTls: "tls",
  },
  "outlook.com": {
    imap: "outlook.office365.com",
    pop: "outlook.office365.com",
    smtp: "smtp-mail.outlook.com",
    smtpPort: 587,
    smtpTls: "starttls",
  },
  "hotmail.com": {
    imap: "outlook.office365.com",
    pop: "outlook.office365.com",
    smtp: "smtp-mail.outlook.com",
    smtpPort: 587,
    smtpTls: "starttls",
  },
  "live.com": {
    imap: "outlook.office365.com",
    pop: "outlook.office365.com",
    smtp: "smtp-mail.outlook.com",
    smtpPort: 587,
    smtpTls: "starttls",
  },
  "qq.com": {
    imap: "imap.qq.com",
    pop: "pop.qq.com",
    smtp: "smtp.qq.com",
    smtpPort: 465,
    smtpTls: "tls",
  },
  "foxmail.com": {
    imap: "imap.qq.com",
    pop: "pop.qq.com",
    smtp: "smtp.qq.com",
    smtpPort: 465,
    smtpTls: "tls",
  },
  "163.com": {
    imap: "imap.163.com",
    pop: "pop.163.com",
    smtp: "smtp.163.com",
    smtpPort: 465,
    smtpTls: "tls",
  },
  "126.com": {
    imap: "imap.126.com",
    pop: "pop.126.com",
    smtp: "smtp.126.com",
    smtpPort: 465,
    smtpTls: "tls",
  },
  "yeah.net": {
    imap: "imap.yeah.net",
    pop: "pop.yeah.net",
    smtp: "smtp.yeah.net",
    smtpPort: 465,
    smtpTls: "tls",
  },
};

/// Foxmail 式按邮箱域名猜服务器：常见服务商用固定配置，其他域名按
/// imap./smtp. 约定填写；连接时仍会实际验证，失败可在高级配置里改。
export function suggestServers(
  email: string,
  protocol: "imap" | "pop3",
): Pick<
  Account,
  | "incomingHost"
  | "incomingPort"
  | "incomingTls"
  | "smtpHost"
  | "smtpPort"
  | "smtpTls"
> | null {
  const domain = email.split("@")[1]?.trim().toLowerCase();
  if (!domain || !domain.includes(".")) return null;
  const preset = known[domain];
  return {
    incomingHost:
      (protocol === "imap" ? preset?.imap : preset?.pop) ??
      `${protocol === "imap" ? "imap" : "pop"}.${domain}`,
    incomingPort: protocol === "imap" ? 993 : 995,
    incomingTls: "tls",
    smtpHost: preset?.smtp ?? `smtp.${domain}`,
    smtpPort: preset?.smtpPort ?? 465,
    smtpTls: preset?.smtpTls ?? "tls",
  };
}
