import { describe, it, expect } from "vitest";
import {
  ruleMatches,
  ruleActions,
  ruleActionSteps,
  ruleActionsDeduped,
  isRemoteRule,
  isMoveAction,
  toggleMergedAction,
  groupRulesByAccount,
} from "./rule-match";
import type { Mail, Rule } from "./types";
const mail = {
  accountId: "work",
  subject: "项目 INVOICE",
  sender: "alice@example.com",
  recipients: "me@example.com",
  hasAttachments: true,
  date: "2026-09-30T01:00:00Z",
} as Mail;
const rule: Rule = {
  id: "1",
  name: "发票",
  accountId: "work",
  enabled: true,
  mode: "all",
  conditions: [
    { field: "subject", operator: "contains", value: "invoice" },
    { field: "attachment", operator: "equals", value: "true" },
  ],
  action: "folder",
  destination: "财务",
  stop: true,
};
describe("rule preview semantics", () => {
  it("requires all conditions and respects account scope", () => {
    expect(ruleMatches(rule, mail)).toBe(true);
    expect(ruleMatches(rule, { ...mail, accountId: "personal" })).toBe(false);
    expect(ruleMatches(rule, { ...mail, hasAttachments: false })).toBe(false);
  });
  it("matches any condition only for enabled nonempty rules", () => {
    expect(
      ruleMatches({ ...rule, mode: "any" }, { ...mail, hasAttachments: false }),
    ).toBe(true);
    expect(ruleMatches({ ...rule, enabled: false }, mail)).toBe(false);
    expect(ruleMatches({ ...rule, conditions: [] }, mail)).toBe(false);
  });
  it("compares dates by calendar day", () => {
    expect(
      ruleMatches(
        {
          ...rule,
          conditions: [
            { field: "date", operator: "after", value: "2026-09-29" },
          ],
        },
        mail,
      ),
    ).toBe(true);
    expect(
      ruleMatches(
        {
          ...rule,
          conditions: [
            { field: "date", operator: "before", value: "2026-09-30" },
          ],
        },
        mail,
      ),
    ).toBe(false);
  });
});
it("supports the extended text, cc, priority, size and age conditions", () => {
  const extended = {
    ...mail,
    cc: "Copy Team <copy@example.com>",
    priority: "high",
    size: 2048,
    isRead: false,
    starred: true,
    headerMetadataKnown: true,
  };
  const matches = (field: string, operator: string, value: string) =>
    ruleMatches(
      { ...rule, conditions: [{ field, operator, value }] },
      extended,
    );
  expect(matches("subject", "startsWith", "项目")).toBe(true);
  expect(matches("subject", "endsWith", "invoice")).toBe(true);
  expect(matches("cc", "contains", "copy@example.com")).toBe(true);
  expect(matches("recipientsOrCc", "contains", "copy@example.com")).toBe(true);
  expect(matches("priority", "equals", "high")).toBe(true);
  expect(matches("sizeKb", "lessThan", "3")).toBe(true);
  expect(matches("sizeKb", "greaterThan", "3")).toBe(false);
  expect(matches("ageDays", "greaterThan", "7")).toBe(true);
  expect(matches("read", "equals", "false")).toBe(true);
  expect(matches("starred", "equals", "true")).toBe(true);
  // 旧记录未知头信息时，抄送/优先级条件不把缺失当成空值。
  expect(
    ruleMatches(
      {
        ...rule,
        conditions: [{ field: "cc", operator: "contains", value: "copy" }],
      },
      { ...extended, headerMetadataKnown: false },
    ),
  ).toBe(false);
});

it("does not treat an online or undecodable body as an empty matching body", () => {
  const negative = {
    ...rule,
    conditions: [{ field: "body", operator: "notContains", value: "missing" }],
  };
  const online = { ...mail, body: "", savedLocally: false };
  expect(ruleMatches(negative, online)).toBe(false);
  expect(ruleMatches(negative, { ...online, savedLocally: true })).toBe(true);
  expect(
    ruleMatches(negative, {
      ...online,
      savedLocally: true,
      parseWarnings: ["text/plain 正文片段无法解码：fixture"],
    }),
  ).toBe(false);
  expect(
    ruleMatches(
      {
        ...negative,
        mode: "any",
        conditions: [
          ...negative.conditions,
          { field: "subject", operator: "contains", value: "invoice" },
        ],
      },
      online,
    ),
  ).toBe(true);
});

describe("rule grouping by account", () => {
  const rule = (id: string, accountId: string): Rule =>
    ({
      id,
      name: id,
      accountId,
      enabled: true,
      mode: "all",
      conditions: [],
      action: "folder",
      destination: "",
      stop: true,
    }) as Rule;
  const accounts = [
    { id: "a", email: "a@example.com" },
    { id: "b", email: "b@example.com" },
  ];
  it("keeps the global group first and preserves execution order", () => {
    const groups = groupRulesByAccount(
      [rule("r1", "a"), rule("r2", ""), rule("r3", "b"), rule("r4", "a")],
      accounts,
    );
    expect(groups.map((g) => g.label)).toEqual([
      "全部账号",
      "a@example.com",
      "b@example.com",
    ]);
    // 每个分组内带全局顺序号，折叠也不丢执行优先级
    expect(groups[1].rules.map((r) => [r.rule.name, r.order])).toEqual([
      ["r1", 0],
      ["r4", 3],
    ]);
  });
  it("falls back to the account id when the email is unknown", () => {
    const groups = groupRulesByAccount([rule("r1", "ghost")], accounts);
    expect(groups[0].label).toBe("ghost");
  });
  it("returns nothing for an empty rule set", () => {
    expect(groupRulesByAccount([], accounts)).toEqual([]);
  });
});

describe("merged move action", () => {
  const asRule = (action: string): Rule =>
    ({
      id: "r",
      name: "r",
      accountId: "a",
      enabled: true,
      mode: "all",
      conditions: [],
      action,
      destination: "",
      stop: true,
    }) as Rule;
  it("recognizes legacy and merged move values", () => {
    expect(isMoveAction(asRule("folder"))).toBe(true);
    expect(isMoveAction(asRule("serverMove"))).toBe(true);
    expect(isMoveAction(asRule("serverCopy"))).toBe(true);
    expect(isMoveAction(asRule("folder+read"))).toBe(true);
    expect(isMoveAction(asRule("read"))).toBe(false);
    expect(isRemoteRule(asRule("folder"))).toBe(false);
    expect(isRemoteRule(asRule("serverMove"))).toBe(true);
  });
  it("expands a legacy combined action string into editable steps", () => {
    expect(ruleActionSteps(asRule("serverMove+read"))).toEqual([
      { action: "serverMove", destination: "", sourceFolder: "" },
      { action: "read", destination: "", sourceFolder: "" },
    ]);
    expect(
      ruleActionSteps({ ...asRule("folder+read"), destination: "财务" }),
    ).toEqual([
      { action: "folder", destination: "财务", sourceFolder: "" },
      { action: "read", destination: "", sourceFolder: "" },
    ]);
  });
  it("lands the move on serverMove for IMAP and folder otherwise", () => {
    expect(toggleMergedAction(asRule(""), "move", true, true)).toBe(
      "serverMove",
    );
    expect(toggleMergedAction(asRule(""), "move", true, false)).toBe("folder");
  });
  it("stacks local marks with the move and excludes trashing", () => {
    // 移动可搭配已读/星标
    expect(toggleMergedAction(asRule("read+star"), "move", true, true)).toBe(
      "serverMove+read+star",
    );
    expect(
      toggleMergedAction(asRule("serverMove+read"), "star", true, true),
    ).toBe("serverMove+read+star");
    expect(toggleMergedAction(asRule("folder"), "read", true, false)).toBe(
      "folder+read",
    );
    // 取消移动只去掉移动本身，保留标记
    expect(
      toggleMergedAction(asRule("folder+read"), "move", false, false),
    ).toBe("read");
    // 移动与废纸篓互斥
    expect(toggleMergedAction(asRule("trash"), "move", true, true)).toBe(
      "serverMove",
    );
    expect(toggleMergedAction(asRule("serverMove"), "trash", true, true)).toBe(
      "trash",
    );
  });
  it("keeps stacking non-move actions", () => {
    expect(toggleMergedAction(asRule("read"), "star", true, true)).toBe(
      "read+star",
    );
    expect(toggleMergedAction(asRule("read"), "unread", true, true)).toBe(
      "unread",
    );
  });
});
