// 邮件列表右键菜单按当前列表上下文分组显示：
// - received：收件箱 / 未读 / 星标 / 存档 / 垃圾邮件等，可回复
// - sent：已发送视图或服务器已发送目录、以及自己发出的邮件，改为重新编辑
// - trash：本地废纸篓或服务器废纸篓目录，只保留恢复与彻底删除
export type MailMenuKind = "received" | "sent" | "trash";

export function mailMenuKind(input: {
  view: string;
  roles?: string[];
  own: boolean;
}): MailMenuKind {
  const roles = input.roles ?? [];
  if (input.view === "trash" || roles.includes("trash")) return "trash";
  if (input.view === "sent" || roles.includes("sent") || input.own)
    return "sent";
  return "received";
}
