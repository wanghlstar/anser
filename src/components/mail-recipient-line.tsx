import { Fragment, useState, type ReactNode } from "react";
import {
  ChevronDown,
  Copy,
  Mail as MailIcon,
  UserRoundPlus,
} from "lucide-react";
import { formatAddress, parseAddresses } from "@/lib/addresses";
import {
  useContactDirectory,
  type ContactDirectory,
} from "@/lib/contact-names";
import { mailTime } from "@/lib/conversations";
import type { Address, Detail, Mail } from "@/lib/types";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Highlight } from "./highlight";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./ui/context-menu";

const COLLAPSED_AT = 6;

function full(value: string, directory: ContactDirectory) {
  const addresses = parseAddresses(value);
  return addresses.length
    ? addresses
        .map((address) =>
          formatAddress({
            ...address,
            name: directory.displayAddress(address),
          }),
        )
        .join(", ")
    : value;
}

function copy(value: string, message: string) {
  void navigator.clipboard
    .writeText(value)
    .then(() => toast.success(message))
    .catch((error) => toast.error(`复制失败：${error}`));
}

function AddressActions({
  address,
  directory,
  onComposeAddress,
}: {
  address: Address;
  directory: ContactDirectory;
  onComposeAddress?: (address: Address) => void;
}) {
  const edit = directory.editContact;
  const known = directory.emails.has(address.email.toLowerCase());
  const named = formatAddress({
    ...address,
    name: directory.displayAddress(address),
  });
  return (
    <>
      <ContextMenuItem
        disabled={!onComposeAddress}
        onSelect={() => onComposeAddress?.(address)}
      >
        <MailIcon />
        写邮件
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => copy(address.email, "邮箱已复制")}>
        <Copy />
        复制邮箱
      </ContextMenuItem>
      {address.name && (
        <ContextMenuItem onSelect={() => copy(named, "姓名和邮箱已复制")}>
          <Copy />
          复制姓名和邮箱
        </ContextMenuItem>
      )}
      {edit && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => edit(address)}>
            <UserRoundPlus />
            {known ? "编辑联系人" : "添加联系人"}：
            {directory.displayAddress(address)}
          </ContextMenuItem>
        </>
      )}
    </>
  );
}

function AddressTrigger({
  address,
  directory,
  highlight,
  text,
  onComposeAddress,
}: {
  address: Address;
  directory: ContactDirectory;
  highlight?: string;
  text?: string;
  onComposeAddress?: (address: Address) => void;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <span
          className="recipient-address-trigger"
          title="右键复制邮箱或添加联系人"
        >
          <Highlight
            text={text ?? directory.displayAddress(address)}
            query={highlight}
          />
        </span>
      </ContextMenuTrigger>
      <ContextMenuContent
        className="w-64"
        onPointerUpCapture={(event) => {
          if (event.button === 2) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        <AddressActions
          address={address}
          directory={directory}
          onComposeAddress={onComposeAddress}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function RecipientRow({
  label,
  value,
  open,
  controls,
  onToggle,
  highlight,
  onComposeAddress,
}: {
  label: string;
  value: string;
  open: boolean;
  controls: string;
  onToggle: () => void;
  highlight?: string;
  onComposeAddress?: (address: Address) => void;
}) {
  const directory = useContactDirectory();
  const addresses = parseAddresses(value);
  const collapsed = addresses.length > COLLAPSED_AT;
  const visible = collapsed ? addresses.slice(0, COLLAPSED_AT) : addresses;
  const content = (
    <>
      <span className="recipient-row-label">{label}：</span>
      <span className="recipient-row-text">
        {addresses.length ? (
          <>
            {visible.map((address, index) => (
              <Fragment key={`${address.email}-${index}`}>
                {index > 0 && "、"}
                <AddressTrigger
                  address={address}
                  directory={directory}
                  highlight={highlight}
                  onComposeAddress={onComposeAddress}
                />
              </Fragment>
            ))}
            {collapsed && ` +${addresses.length - COLLAPSED_AT}`}
          </>
        ) : (
          <Highlight text={value} query={highlight} />
        )}
      </span>
    </>
  );
  if (collapsed)
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="recipient-row recipient-row-collapsed"
        title={full(value, directory)}
        aria-expanded={open}
        aria-controls={controls}
        onClick={onToggle}
      >
        {content}
      </Button>
    );
  return (
    <div className="recipient-row" title={full(value, directory)}>
      {content}
    </div>
  );
}

function DetailAddresses({
  value,
  directory,
  highlight,
  empty = "（无）",
  onComposeAddress,
}: {
  value: string;
  directory: ContactDirectory;
  highlight?: string;
  empty?: string;
  onComposeAddress?: (address: Address) => void;
}) {
  const addresses = parseAddresses(value);
  if (!addresses.length)
    return <Highlight text={value || empty} query={highlight} />;
  return (
    <>
      {addresses.map((address, index) => (
        <Fragment key={`${address.email}-${index}`}>
          {index > 0 && ", "}
          <AddressTrigger
            address={address}
            directory={directory}
            highlight={highlight}
            text={`${directory.displayAddress(address)} <${address.email}>`}
            onComposeAddress={onComposeAddress}
          />
        </Fragment>
      ))}
    </>
  );
}

export function MailRecipientLine({
  mail,
  detail,
  meta,
  highlight,
  onComposeAddress,
}: {
  mail: Mail;
  detail: Detail | null;
  meta: ReactNode;
  highlight?: string;
  onComposeAddress?: (address: Address) => void;
}) {
  const [open, setOpen] = useState(false);
  const directory = useContactDirectory();
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
                highlight={highlight}
                onComposeAddress={onComposeAddress}
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
            <dd>
              <DetailAddresses
                value={mail.sender}
                directory={directory}
                highlight={highlight}
                onComposeAddress={onComposeAddress}
              />
            </dd>
            <dt>收件人</dt>
            <dd>
              <DetailAddresses
                value={to}
                directory={directory}
                highlight={highlight}
                onComposeAddress={onComposeAddress}
              />
            </dd>
            {cc && (
              <>
                <dt>抄送</dt>
                <dd>
                  <DetailAddresses
                    value={cc}
                    directory={directory}
                    highlight={highlight}
                  />
                </dd>
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
