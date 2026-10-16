import type { Mail, Rule } from "./types";
export function ruleMatches(rule: Rule, mail: Mail): boolean {
  if (
    !rule.enabled ||
    !rule.conditions.length ||
    (rule.accountId && rule.accountId !== mail.accountId)
  )
    return false;
  const results = rule.conditions.map((c) => {
    if (
      c.field === "body" &&
      (mail.savedLocally === false ||
        mail.parseWarnings?.some(
          (w) =>
            w.startsWith("text/plain 正文片段无法解码：") ||
            w.startsWith("text/html 正文片段无法解码："),
        ))
    )
      return false;
    if (c.field === "attachment")
      return mail.hasAttachments === (c.value !== "false");
    const values: Record<string, string> = {
      sender: mail.sender,
      recipients: mail.recipients,
      subject: mail.subject,
      body: mail.body,
      date: mail.date,
    };
    if (!(c.field in values)) return false;
    const text = values[c.field].toLowerCase(),
      value = c.value.toLowerCase();
    switch (c.operator) {
      case "contains":
        return text.includes(value);
      case "notContains":
        return !text.includes(value);
      case "equals":
        return text === value;
      case "before":
        return text.slice(0, 10) < value;
      case "after":
        return text.slice(0, 10) > value;
      default:
        return false;
    }
  });
  return rule.mode === "any" ? results.some(Boolean) : results.every(Boolean);
}

/** 规则动作可用分隔符写多个（与后端 models::Rule::effective_actions 一致）。 */
export function ruleActions(rule: Rule): string[] {
  return rule.action
    .split(/[+,,;；]/)
    .map((a) => a.trim())
    .filter(Boolean);
}

/** read/unread 互相矛盾，重复动作也没有意义：各自只保留最后一次。 */
export function ruleActionsDeduped(rule: Rule): string[] {
  const out: string[] = [];
  for (const action of ruleActions(rule)) {
    const flag =
      action === "read" || action === "unread"
        ? out.findIndex((a) => a === "read" || a === "unread")
        : -1;
    if (flag >= 0) out[flag] = action;
    else if (!out.includes(action)) out.push(action);
  }
  return out;
}

/** 服务器 COPY/MOVE 走独立任务，不能和别的动作叠加。 */
export function isRemoteRule(rule: Rule): boolean {
  return ruleActions(rule).some(
    (a) => a === "serverCopy" || a === "serverMove",
  );
}

/** 移动类动作：用户层的「移动到文件夹」在存储层落地为 serverMove / folder。 */
export const MOVE_ACTIONS = ["serverMove", "folder", "serverCopy"];

/** 规则是否包含「移动到文件夹」（含兼容旧值 folder / serverMove / serverCopy）。 */
export function isMoveAction(rule: Rule): boolean {
  return ruleActions(rule).some((a) => MOVE_ACTIONS.includes(a));
}

/**
 * 用户层合并动作「移动到文件夹」的勾选：
 * - `move` 可搭配本机标记（已读/未读/星标），与「移到废纸篓」互斥；
 * - 落地值由账号能力决定：IMAP 账号 → `serverMove`（真正的服务器移动），
 *   POP3 / 本地 → `folder`（退化为纯本地归类）；
 * - read/unread 互斥，动作去重。
 */
export function toggleMergedAction(
  rule: Rule,
  target: string,
  on: boolean,
  serverMove: boolean,
): string {
  const current = ruleActionsDeduped(rule);
  const isMove = (a: string) => MOVE_ACTIONS.includes(a);
  if (target === "move") {
    if (!on) return current.filter((a) => !isMove(a)).join("+");
    // 开启移动：去互斥的废纸篓，保留已读/星标，落地 serverMove/folder
    const rest = current.filter((a) => !isMove(a) && a !== "trash");
    return [serverMove ? "serverMove" : "folder", ...rest].join("+");
  }
  if (!on) return current.filter((a) => a !== target).join("+");
  let rest = current.filter((a) => a !== target);
  // 废纸篓与移动互斥
  if (target === "trash") rest = rest.filter((a) => !isMove(a));
  // 已读/未读互斥
  if (target === "read" || target === "unread")
    rest = rest.filter((a) => a !== (target === "read" ? "unread" : "read"));
  return [...rest, target].join("+");
}

/** 一个账号分组：账号信息 + 该账号的规则（保持全局执行顺序）。 */
export type RuleGroup = {
  key: string;
  label: string;
  rules: { rule: Rule; order: number }[];
};

/**
 * 把规则按账号分组，供折叠展示。每个分组内的规则仍带**全局顺序号**，
 * 因为规则是有序执行的（命中 stop 就不看后面的），折叠也不能丢这个语义。
 * 全局规则（accountId 为空）单独成组，排在最前。
 */
export function groupRulesByAccount(
  rules: Rule[],
  accounts: { id: string; email: string }[],
): RuleGroup[] {
  const names = new Map(accounts.map((a) => [a.id, a.email]));
  const groups = new Map<string, RuleGroup>();
  for (const [order, rule] of rules.entries()) {
    const key = rule.accountId || "__global__";
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        label: rule.accountId
          ? (names.get(rule.accountId) ?? rule.accountId)
          : "全部账号",
        rules: [],
      };
      groups.set(key, group);
    }
    group.rules.push({ rule, order });
  }
  // 全局组固定在最前，其余按首次出现顺序（即执行顺序）
  return [...groups.values()].sort((a, b) =>
    a.key === "__global__" ? -1 : b.key === "__global__" ? 1 : 0,
  );
}
