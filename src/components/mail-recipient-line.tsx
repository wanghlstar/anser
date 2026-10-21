import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { formatAddress, parseAddresses } from "@/lib/addresses";
import { mailTime } from "@/lib/conversations";
import type { Detail, Mail } from "@/lib/types";
import { Button } from "./ui/button";

const COLLAPSED_AT = 6;

function compact(value: string) {
  const addresses = parseAddresses(value);
  if (!addresses.length) return { text: value, collapsed: false };
  const collapsed = addresses.length > COLLAPSED_AT;
  return {
    text:
      addresses
        .slice(0, COLLAPSED_AT)
        .map((address) => address.name || address.email)
        .join("、") + (collapsed ? ` +${addresses.length - COLLAPSED_AT}` : ""),
    collapsed,
  };
}
function full(value: string) {
  const addresses = parseAddresses(value);
  return addresses.length ? addresses.map(formatAddress).join(", ") : value;
}

function RecipientRow({
  label,
  value,
  open,
  controls,
  onToggle,
}: {
  label: string;
  value: string;
  open: boolean;
  controls: string;
  onToggle: () => void;
}) {
  const view = compact(value);
  const content = (
    <>
      <span className="recipient-row-label">{label}：</span>
      <span className="recipient-row-text">{view.text}</span>
    </>
  );
  if (!view.collapsed)
    return (
      <div className="recipient-row" title={full(value)}>
        {content}
      </div>
    );
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="recipient-row recipient-row-collapsed"
      title={full(value)}
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
    >
      {content}
    </Button>
  );
}

export function MailRecipientLine({
  mail,
  detail,
  meta,
}: {
  mail: Mail;
  detail: Detail | null;
  meta: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const to = mail.recipients.trim();
  const cc =
    mail.cc?.trim() ||
    (detail?.cc || []).map(formatAddress).filter(Boolean).join(", ");
  const detailsId = `mail-recipients-${mail.id}`;
  const rows = [
    { key: "to", label: "收件人", value: to },
    ...(cc ? [{ key: "cc", label: "抄送", value: cc }] : []),
  ].filter((row) => row.value);
  return (
    <>
      <div className="recipient-line">
        <div className="recipient-summary">
          {rows.map((row, index) => (
            <div className="recipient-row-line" key={row.key}>
              <RecipientRow
                label={row.label}
                value={row.value}
                open={open}
                controls={detailsId}
                onToggle={() => setOpen((value) => !value)}
              />
              {index === rows.length - 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="recipient-details-toggle"
                  aria-expanded={open}
                  aria-controls={detailsId}
                  onClick={() => setOpen((value) => !value)}
                >
                  详细信息
                  <ChevronDown size={12} />
                </Button>
              )}
            </div>
          ))}
        </div>
        {meta}
      </div>
      {open && (
        <div
          className="recipient-details"
          id={detailsId}
          aria-label="邮件收发信息"
        >
          <dl>
            <dt>发件人</dt>
            <dd>{mail.sender}</dd>
            <dt>收件人</dt>
            <dd>{full(to) || "（无）"}</dd>
            {cc && (
              <>
                <dt>抄送</dt>
                <dd>{full(cc)}</dd>
              </>
            )}
            <dt>日期</dt>
            <dd>{mailTime(mail.date)}</dd>
            <dt>账号</dt>
            <dd>{mail.accountEmail}</dd>
            <dt>本地目录</dt>
            <dd>{mail.localFolder || mail.sourceFolder || "（无）"}</dd>
            {mail.messageId && (
              <>
                <dt>Message-ID</dt>
                <dd className="recipient-details-mono">{mail.messageId}</dd>
              </>
            )}
          </dl>
        </div>
      )}
    </>
  );
}
