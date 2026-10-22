use crate::models::{err, Result};
use chrono::{DateTime, Datelike, Days, Local, SecondsFormat, Timelike};
use eventkit::prelude::{
    EKAuthorizationStatus, EKCalendar, EKEntityType, EKEvent, EKEventPredicate, EKEventStore,
};
use serde::Serialize;
use std::collections::HashMap;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppleCalendarInfo {
    pub id: String,
    pub title: String,
    pub source_title: String,
    pub color: String,
    pub read_only: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppleCalendarEvent {
    pub id: String,
    pub calendar_id: String,
    pub calendar_title: String,
    pub title: String,
    pub start: String,
    pub end: String,
    pub all_day: bool,
    pub location: String,
    pub notes: String,
    pub color: String,
}

fn status_name(status: EKAuthorizationStatus) -> &'static str {
    match status {
        EKAuthorizationStatus::NotDetermined => "notDetermined",
        EKAuthorizationStatus::Restricted => "restricted",
        EKAuthorizationStatus::Denied => "denied",
        EKAuthorizationStatus::FullAccess => "fullAccess",
        EKAuthorizationStatus::WriteOnly => "writeOnly",
        _ => "unknown",
    }
}

fn store() -> Result<EKEventStore> {
    EKEventStore::new().map_err(|error| format!("无法连接 macOS 日历：{error}"))
}

fn ensure_read_access(store: &EKEventStore) -> Result<()> {
    match EKEventStore::authorization_status(EKEntityType::Event) {
        EKAuthorizationStatus::FullAccess => Ok(()),
        EKAuthorizationStatus::WriteOnly => {
            Err("需要完整的日历访问权限，才能读取 Apple 日历".into())
        }
        EKAuthorizationStatus::Denied => {
            Err("macOS 日历权限已被拒绝，请在系统设置 > 隐私与安全性 > 日历中允许雁信".into())
        }
        EKAuthorizationStatus::Restricted => Err("macOS 限制了日历访问".into()),
        EKAuthorizationStatus::NotDetermined => Err("尚未授权读取 Apple 日历".into()),
        _ => Err("无法获取 macOS 日历权限状态".into()),
    }
}

fn color_from_hex(value: Option<&str>) -> &'static str {
    let Some(raw) = value else {
        return "gray";
    };
    let hex = raw.trim_start_matches('#');
    if hex.len() < 6 {
        return "gray";
    }
    let parse = |range: std::ops::Range<usize>| u8::from_str_radix(&hex[range], 16).ok();
    let (Some(red), Some(green), Some(blue)) = (parse(0..2), parse(2..4), parse(4..6)) else {
        return "gray";
    };
    let max = red.max(green).max(blue) as f32;
    let min = red.min(green).min(blue) as f32;
    let delta = max - min;
    if delta < 24.0 || max < 40.0 {
        return "gray";
    }
    let hue = if max == red as f32 {
        60.0 * (((green as f32 - blue as f32) / delta) % 6.0)
    } else if max == green as f32 {
        60.0 * ((blue as f32 - red as f32) / delta + 2.0)
    } else {
        60.0 * ((red as f32 - green as f32) / delta + 4.0)
    };
    let hue = if hue < 0.0 { hue + 360.0 } else { hue };
    match hue {
        h if h < 25.0 || h >= 330.0 => "orange",
        h if h < 90.0 => "orange",
        h if h < 165.0 => "green",
        h if h < 250.0 => "blue",
        _ => "purple",
    }
}

fn calendar_info(calendar: &EKCalendar) -> AppleCalendarInfo {
    AppleCalendarInfo {
        id: calendar.identifier.clone(),
        title: calendar.title.clone(),
        source_title: calendar
            .source
            .as_ref()
            .map(|source| source.title.clone())
            .unwrap_or_default(),
        color: color_from_hex(calendar.color.as_deref()).to_string(),
        read_only: true,
    }
}

fn calendars(store: &EKEventStore) -> Result<Vec<EKCalendar>> {
    store
        .calendars_for_entity_type(EKEntityType::Event)
        .map_err(|error| format!("读取 Apple 日历列表失败：{error}"))
}

pub fn status() -> String {
    status_name(EKEventStore::authorization_status(EKEntityType::Event)).to_string()
}

pub fn connect() -> Result<Vec<AppleCalendarInfo>> {
    let store = store()?;
    let granted = store
        .request_full_access_to_events()
        .map_err(|error| format!("请求 macOS 日历权限失败：{error}"))?;
    if !granted {
        return Err("未获得 macOS 日历访问权限".into());
    }
    ensure_read_access(&store)?;
    Ok(calendars(&store)?.iter().map(calendar_info).collect())
}

pub fn list_calendars() -> Result<Vec<AppleCalendarInfo>> {
    let store = store()?;
    ensure_read_access(&store)?;
    Ok(calendars(&store)?.iter().map(calendar_info).collect())
}

fn parse_time(value: &str) -> Result<DateTime<chrono::Utc>> {
    DateTime::parse_from_rfc3339(value)
        .map(|date| date.with_timezone(&chrono::Utc))
        .map_err(|_| "Apple 日历时间范围格式无效".into())
}

fn all_day_dates(event: &EKEvent) -> Option<(String, String)> {
    let start = DateTime::parse_from_rfc3339(&event.start_date)
        .ok()?
        .with_timezone(&Local)
        .date_naive();
    let end = DateTime::parse_from_rfc3339(&event.end_date)
        .ok()?
        .with_timezone(&Local)
        .date_naive();
    let inclusive_end = if end > start {
        end.checked_sub_days(Days::new(1)).unwrap_or(start)
    } else {
        start
    };
    Some((start.to_string(), inclusive_end.to_string()))
}

fn timed_range(event: &EKEvent) -> Option<(String, String)> {
    let start = DateTime::parse_from_rfc3339(&event.start_date).ok()?;
    let end = DateTime::parse_from_rfc3339(&event.end_date)
        .ok()
        .filter(|end| *end > start)
        .unwrap_or_else(|| start + chrono::Duration::hours(1));
    Some((
        start
            .with_timezone(&chrono::Utc)
            .to_rfc3339_opts(SecondsFormat::Secs, true),
        end.with_timezone(&chrono::Utc)
            .to_rfc3339_opts(SecondsFormat::Secs, true),
    ))
}

fn event_id(event: &EKEvent) -> String {
    let occurrence = event
        .occurrence_date
        .as_deref()
        .unwrap_or(event.start_date.as_str());
    let base = event
        .identifier
        .as_deref()
        .or(event.calendar_item_identifier.as_deref())
        .unwrap_or(event.start_date.as_str());
    format!("{base}:{occurrence}")
}

fn convert_event(
    event: &EKEvent,
    calendar: Option<&AppleCalendarInfo>,
) -> Option<AppleCalendarEvent> {
    let (start, end) = if event.all_day {
        all_day_dates(event)?
    } else {
        timed_range(event)?
    };
    let calendar_id = event
        .calendar_identifier
        .clone()
        .or_else(|| calendar.map(|item| item.id.clone()))
        .unwrap_or_default();
    let calendar_title = calendar
        .map(|item| item.title.clone())
        .or_else(|| event.calendar.as_ref().map(|item| item.title.clone()))
        .unwrap_or_default();
    let color = calendar
        .map(|item| item.color.clone())
        .unwrap_or_else(|| "gray".to_string());
    Some(AppleCalendarEvent {
        id: event_id(event),
        calendar_id,
        calendar_title,
        title: event.title.clone(),
        start,
        end,
        all_day: event.all_day,
        location: event.location.clone().unwrap_or_default(),
        notes: event.notes.clone().unwrap_or_default(),
        color,
    })
}

pub fn events(from: &str, to: &str, calendar_ids: Vec<String>) -> Result<Vec<AppleCalendarEvent>> {
    let start = parse_time(from)?;
    let end = parse_time(to)?;
    if end <= start {
        return Err("Apple 日历时间范围无效".into());
    }
    let store = store()?;
    ensure_read_access(&store)?;
    let calendars = calendars(&store)?;
    let infos: Vec<AppleCalendarInfo> = calendars.iter().map(calendar_info).collect();
    let by_id: HashMap<String, &AppleCalendarInfo> =
        infos.iter().map(|item| (item.id.clone(), item)).collect();
    let selected: Vec<String> = if calendar_ids.is_empty() {
        infos.iter().map(|item| item.id.clone()).collect()
    } else {
        calendar_ids
            .into_iter()
            .filter(|id| by_id.contains_key(id))
            .collect()
    };
    if selected.is_empty() {
        return Ok(Vec::new());
    }
    let predicate = EKEventPredicate::new(
        start.to_rfc3339_opts(SecondsFormat::Millis, true),
        end.to_rfc3339_opts(SecondsFormat::Millis, true),
    )
    .with_calendar_identifiers(selected);
    let events = store
        .events_matching(&predicate)
        .map_err(|error| format!("读取 Apple 日历事件失败：{error}"))?;
    let mut result: Vec<AppleCalendarEvent> = events
        .iter()
        .filter_map(|event| {
            let calendar_id = event.calendar_identifier.as_deref();
            let calendar = calendar_id.and_then(|id| by_id.get(id).copied());
            convert_event(event, calendar)
        })
        .take(5000)
        .collect();
    result.sort_by(|left, right| left.start.cmp(&right.start));
    result.dedup_by(|left, right| left.id == right.id);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::color_from_hex;

    #[test]
    fn maps_apple_calendar_colors_to_local_palette() {
        assert_eq!(color_from_hex(Some("#FF3B30FF")), "orange");
        assert_eq!(color_from_hex(Some("#34C759FF")), "green");
        assert_eq!(color_from_hex(Some("#007AFFFF")), "blue");
        assert_eq!(color_from_hex(Some("#AF52DEFF")), "purple");
        assert_eq!(color_from_hex(Some("#8E8E93FF")), "gray");
    }
}
