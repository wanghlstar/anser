use crate::models::*;
pub fn validate(rule: &Rule) -> Result<()> {
    if rule.name.trim().is_empty() || rule.conditions.is_empty() {
        return Err("规则需要名称和至少一个条件".into());
    }
    let actions = rule.effective_actions_deduped();
    const KNOWN: [&str; 7] = [
        "folder",
        "read",
        "unread",
        "star",
        "trash",
        "serverCopy",
        "serverMove",
    ];
    if !["all", "any"].contains(&rule.mode.as_str()) || actions.is_empty() {
        return Err("无效的规则配置".into());
    }
    if !actions.iter().all(|a| KNOWN.contains(&a.as_str())) {
        return Err("无效的规则配置".into());
    }
    // 服务器 COPY/MOVE 走独立任务（有确认/重试状态机）：只能有一个，
    // 且只允许搭配本机标记（已读/未读/星标），不能与归类、删除或另一个服务器动作叠加。
    let remote_actions: Vec<&String> = actions
        .iter()
        .filter(|a| matches!(a.as_str(), "serverCopy" | "serverMove"))
        .collect();
    if remote_actions.len() > 1 {
        return Err("服务器复制/移动不能同时使用两个服务器动作".into());
    }
    if let Some(server) = remote_actions.first() {
        if actions
            .iter()
            .any(|a| a != *server && !matches!(a.as_str(), "read" | "unread" | "star"))
        {
            return Err("服务器复制/移动只能搭配标记已读/未读或星标".into());
        }
    }
    if actions.iter().any(|a| a == "folder") && rule.destination.trim().is_empty() {
        return Err("请输入本地目标文件夹".into());
    }
    // 来源目录可以留空：留空时按邮件当前所在的活跃服务器目录动态解析
    // （合并动作「移动到文件夹」的默认行为，等价于 Foxmail 的移动）。
    if remote(rule)
        && (rule.account_id.is_empty()
            || rule.destination.is_empty()
            || (!rule.source_folder.is_empty()
                && rule.source_folder.eq_ignore_ascii_case(&rule.destination))
            || [&rule.source_folder, &rule.destination]
                .iter()
                .any(|s| s.bytes().any(|b| b < 32 || b == 127)))
    {
        return Err("服务器规则需要指定账号和不同的目标目录".into());
    }
    for c in &rule.conditions {
        if remote(rule) && c.field == "body" {
            return Err("服务器动作暂不支持正文条件，请先使用主题、发件人等条件".into());
        }
        if ![
            "sender",
            "recipients",
            "subject",
            "body",
            "attachment",
            "date",
        ]
        .contains(&c.field.as_str())
            || !["contains", "equals", "notContains", "before", "after"]
                .contains(&c.operator.as_str())
        {
            return Err("不支持的条件".into());
        }
        if c.field == "date" && chrono::NaiveDate::parse_from_str(&c.value, "%Y-%m-%d").is_err() {
            return Err("日期条件格式为 YYYY-MM-DD".into());
        }
        if c.field != "attachment" && c.value.trim().is_empty() {
            return Err("请填写条件值，避免意外匹配全部邮件".into());
        }
    }
    Ok(())
}
pub fn matches(rule: &Rule, mail: &Mail) -> bool {
    let decoded = !mail.parse_warnings.iter().any(|warning| {
        warning.starts_with("text/plain 正文片段无法解码：")
            || warning.starts_with("text/html 正文片段无法解码：")
    });
    matches_with_body(rule, mail, mail.saved_locally && decoded)
}
pub fn matches_with_body(rule: &Rule, mail: &Mail, body_available: bool) -> bool {
    if !rule.enabled
        || (!rule.account_id.is_empty() && rule.account_id != mail.account_id)
        || rule.conditions.is_empty()
    {
        return false;
    }
    let test = |c: &Condition| {
        if c.field == "body" && !body_available {
            return false;
        }
        let text = match c.field.as_str() {
            "sender" => &mail.sender,
            "recipients" => &mail.recipients,
            "subject" => &mail.subject,
            "body" => &mail.body,
            "date" => &mail.date,
            "attachment" => return mail.has_attachments == (c.value != "false"),
            _ => return false,
        };
        let a = text.to_lowercase();
        let b = c.value.to_lowercase();
        match c.operator.as_str() {
            "contains" => a.contains(&b),
            "notContains" => !a.contains(&b),
            "equals" => a == b,
            "before" => a.get(..10).unwrap_or(&a) < b.as_str(),
            "after" => a.get(..10).unwrap_or(&a) > b.as_str(),
            _ => false,
        }
    };
    if rule.mode == "any" {
        rule.conditions.iter().any(test)
    } else {
        rule.conditions.iter().all(test)
    }
}

#[cfg(test)]
mod body_tests {
    use super::*;
    #[test]
    fn online_empty_body_never_matches_negative_conditions_and_known_any_header_still_matches() {
        let account = crate::tests::account();
        let mut mail = crate::archive::parse(&crate::tests::raw(), &account, "INBOX")
            .unwrap()
            .0;
        mail.saved_locally = false;
        mail.body.clear();
        let mut rule = Rule {
            id: "body".into(),
            name: "body".into(),
            account_id: account.id,
            enabled: true,
            mode: "all".into(),
            conditions: vec![Condition {
                field: "body".into(),
                operator: "notContains".into(),
                value: "missing".into(),
            }],
            action: "trash".into(),
            destination: String::new(),
            source_folder: String::new(),
            stop: true,
        };
        assert!(!matches(&rule, &mail));
        mail.saved_locally = true;
        assert!(matches(&rule, &mail));
        mail.parse_warnings
            .push("text/plain 正文片段无法解码：fixture".into());
        assert!(!matches(&rule, &mail));
        mail.parse_warnings.clear();
        mail.saved_locally = false;
        rule.mode = "any".into();
        rule.conditions.push(Condition {
            field: "subject".into(),
            operator: "contains".into(),
            value: "invoice".into(),
        });
        assert!(matches(&rule, &mail));
    }
}

pub fn remote(rule: &Rule) -> bool {
    rule.effective_actions()
        .iter()
        .any(|a| matches!(a.as_str(), "serverCopy" | "serverMove"))
}
