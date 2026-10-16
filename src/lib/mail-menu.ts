// 邮件列表右键菜单按当前列表上下文分组显示：
// - received：收件箱 / 未读 / 星标 / 存档 / 垃圾邮件等，可回复
// - sent：已发送视图或服务器已发送目录，改为重新编辑
// - trash：本地废纸篓或服务器废纸篓目录，只保留恢复与彻底删除
// 只按视图/目录判断：自己发到收件箱（自寄）的邮件仍按收件处理，可回复。
export type MailMenuKind = "received" | "sent" | "trash";

export function mailMenuKind(input: {
  view: string;
  roles?: string[];
}): MailMenuKind {
  const roles = input.roles ?? [];
  if (input.view === "trash" || roles.includes("trash")) return "trash";
  if (input.view === "sent" || roles.includes("sent")) return "sent";
  return "received";
}
