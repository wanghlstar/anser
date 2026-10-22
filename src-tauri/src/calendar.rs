use crate::{
    models::{err, Result},
    store::Store,
};
use chrono::{DateTime, Datelike, Days, Duration, Local, Months, NaiveDate, TimeZone, Utc};
use rusqlite::{params, Row};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const COLORS: [&str; 5] = ["blue", "green", "orange", "purple", "gray"];
const REPEATS: [&str; 5] = ["none", "daily", "weekly", "monthly", "yearly"];
const MAX_REMINDER_MINUTES: i64 = 7 * 24 * 60;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    #[serde(default)]
    pub id: String,
    pub title: String,
    /// 定时事件为 RFC3339 UTC；全天事件为 YYYY-MM-DD。
    pub start: String,
    /// 定时事件为 RFC3339 UTC；全天事件为包含当天的 YYYY-MM-DD。
    pub end: String,
    #[serde(default)]
    pub all_day: bool,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default = "default_color")]
    pub color: String,
    #[serde(default)]
    pub reminder_minutes: Option<i64>,
    #[serde(default = "default_repeat")]
    pub repeat: String,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
    /// 非空表示来自订阅日历，只读。
    #[serde(default)]
    pub subscription_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarSubscription {
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub url: String,
    #[serde(default = "default_color")]
    pub color: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub last_synced_at: String,
    #[serde(default)]
    pub last_error: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarOccurrence {
    /// 系列 id + 本次开始时间，供前端列表 key 使用；不参与写操作。
    pub key: String,
    pub event: CalendarEvent,
    pub start: String,
    pub end: String,
    pub all_day: bool,
}

fn default_color() -> String {
    "blue".into()
}
fn default_repeat() -> String {
    "none".into()
}
fn default_true() -> bool {
    true
}

fn parse_timed(value: &str) -> Result<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .map(|date| date.with_timezone(&Utc))
        .map_err(|_| "事件时间格式无效".into())
}

fn parse_date(value: &str) -> Result<NaiveDate> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| "事件日期格式无效".into())
}

fn format_utc(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn month_index(date: NaiveDate) -> i32 {
    date.year() * 12 + date.month0() as i32
}

fn initial_index(base: NaiveDate, range_start: NaiveDate, repeat: &str) -> u32 {
    let days = (range_start - base).num_days().max(0);
    let index = match repeat {
        "daily" => days,
        "weekly" => days / 7,
        "monthly" => (month_index(range_start) - month_index(base)) as i64,
        "yearly" => (range_start.year() - base.year()) as i64,
        _ => 0,
    };
    (index - 2).max(0) as u32
}

struct Range {
    from: DateTime<Utc>,
    to: DateTime<Utc>,
    from_date: NaiveDate,
    to_date: NaiveDate,
}

impl Range {
    fn parse(from: &str, to: &str) -> Result<Self> {
        let from = parse_timed(from)?;
        let to = parse_timed(to)?;
        if to <= from {
            return Err("日历查询范围无效".into());
        }
        Ok(Self {
            from,
            to,
            from_date: from.with_timezone(&Local).date_naive(),
            to_date: (to - Duration::seconds(1))
                .with_timezone(&Local)
                .date_naive(),
        })
    }
}

impl CalendarEvent {
    fn validate(&self) -> Result<()> {
        if self.title.trim().is_empty() {
            return Err("请填写日程标题".into());
        }
        if !COLORS.contains(&self.color.as_str()) {
            return Err("日程颜色无效".into());
        }
        if !REPEATS.contains(&self.repeat.as_str()) {
            return Err("重复规则无效".into());
        }
        if let Some(minutes) = self.reminder_minutes {
            if !(0..=MAX_REMINDER_MINUTES).contains(&minutes) {
                return Err("提醒时间需在 7 天以内".into());
            }
        }
        if self.all_day {
            let start = parse_date(&self.start)?;
            let end = parse_date(&self.end)?;
            if end < start {
                return Err("结束日期不能早于开始日期".into());
            }
        } else {
            let start = parse_timed(&self.start)?;
            let end = parse_timed(&self.end)?;
            if end <= start {
                return Err("结束时间需晚于开始时间".into());
            }
        }
        Ok(())
    }

    fn normalized(mut self, id: String, created_at: String, updated_at: String) -> Self {
        self.id = id;
        self.title = self.title.trim().to_string();
        self.location = self.location.trim().to_string();
        self.created_at = created_at;
        self.updated_at = updated_at;
        if self.all_day {
            self.start = self.start.trim().to_string();
            self.end = self.end.trim().to_string();
        } else {
            if let Ok(start) = parse_timed(&self.start) {
                self.start = format_utc(start);
            }
            if let Ok(end) = parse_timed(&self.end) {
                self.end = format_utc(end);
            }
        }
        self
    }

    fn is_repeating(&self) -> bool {
        self.repeat != "none"
    }

    fn timed_occurrence(&self, index: u32) -> Option<(DateTime<Local>, DateTime<Local>)> {
        let start = parse_timed(&self.start).ok()?.with_timezone(&Local);
        let end = parse_timed(&self.end).ok()?.with_timezone(&Local);
        let length = end - start;
        let start = match self.repeat.as_str() {
            "daily" => start.checked_add_days(Days::new(index as u64)),
            "weekly" => start.checked_add_days(Days::new(index as u64 * 7)),
            "monthly" => start.checked_add_months(Months::new(index)),
            "yearly" => start.checked_add_months(Months::new(index * 12)),
            _ if index == 0 => Some(start),
            _ => None,
        }?;
        Some((start, start.checked_add_signed(length)?))
    }

    fn date_occurrence(&self, index: u32) -> Option<(NaiveDate, NaiveDate)> {
        let start = parse_date(&self.start).ok()?;
        let end = parse_date(&self.end).ok()?;
        let length = end - start;
        let start = match self.repeat.as_str() {
            "daily" => start.checked_add_signed(Duration::days(index as i64)),
            "weekly" => start.checked_add_signed(Duration::days(index as i64 * 7)),
            "monthly" => start.checked_add_months(Months::new(index)),
            "yearly" => start.checked_add_months(Months::new(index * 12)),
            _ if index == 0 => Some(start),
            _ => None,
        }?;
        Some((start, start.checked_add_signed(length)?))
    }

    fn occurrence(&self, start: String, end: String) -> CalendarOccurrence {
        CalendarOccurrence {
            key: format!("{}@{start}", self.id),
            event: self.clone(),
            start,
            end,
            all_day: self.all_day,
        }
    }

    fn occurrences_in(&self, range: &Range) -> Vec<CalendarOccurrence> {
        if self.all_day {
            return self.all_day_occurrences(range);
        }
        let mut out = Vec::new();
        let mut index = if self.is_repeating() {
            let base = parse_timed(&self.start)
                .map(|timed| timed.with_timezone(&Local).date_naive())
                .unwrap_or(range.from_date);
            initial_index(base, range.from_date, &self.repeat)
        } else {
            0
        };
        let mut stale = 0;
        loop {
            let Some((start, end)) = self.timed_occurrence(index) else {
                break;
            };
            if start.with_timezone(&Utc) >= range.to {
                break;
            }
            if end.with_timezone(&Utc) > range.from {
                out.push(self.occurrence(
                    format_utc(start.with_timezone(&Utc)),
                    format_utc(end.with_timezone(&Utc)),
                ));
            }
            if !self.is_repeating() {
                break;
            }
            stale += 1;
            if start.with_timezone(&Utc) < range.from {
                if stale > 6000 {
                    break;
                }
                index += 1;
                continue;
            }
            index += 1;
        }
        out
    }

    fn all_day_occurrences(&self, range: &Range) -> Vec<CalendarOccurrence> {
        let mut out = Vec::new();
        let Ok(base_start) = parse_date(&self.start) else {
            return out;
        };
        let mut index = if self.is_repeating() {
            initial_index(base_start, range.from_date, &self.repeat)
        } else {
            0
        };
        let mut stale = 0;
        loop {
            let Some((start, end)) = self.date_occurrence(index) else {
                break;
            };
            if start > range.to_date {
                break;
            }
            if end >= range.from_date {
                out.push(self.occurrence(
                    start.format("%Y-%m-%d").to_string(),
                    end.format("%Y-%m-%d").to_string(),
                ));
            }
            if !self.is_repeating() {
                break;
            }
            stale += 1;
            if end < range.from_date {
                if stale > 6000 {
                    break;
                }
                index += 1;
                continue;
            }
            index += 1;
        }
        out
    }
}

fn reminder_at(
    event: &CalendarEvent,
    occurrence_start: &str,
    minutes: i64,
) -> Option<DateTime<Utc>> {
    if event.all_day {
        let date = parse_date(occurrence_start).ok()?;
        let local = date
            .and_hms_opt(9, 0, 0)
            .and_then(|time| Local.from_local_datetime(&time).earliest())?;
        Some(local.with_timezone(&Utc) - Duration::minutes(minutes))
    } else {
        Some(parse_timed(occurrence_start).ok()? - Duration::minutes(minutes))
    }
}

fn read_event(row: &Row<'_>) -> rusqlite::Result<CalendarEvent> {
    Ok(CalendarEvent {
        id: row.get(0)?,
        title: row.get(1)?,
        start: row.get(2)?,
        end: row.get(3)?,
        all_day: row.get::<_, i64>(4)? != 0,
        location: row.get(5)?,
        notes: row.get(6)?,
        color: row.get(7)?,
        reminder_minutes: row.get(8)?,
        repeat: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        subscription_id: String::new(),
    })
}

fn read_subscription_event(row: &Row<'_>) -> rusqlite::Result<CalendarEvent> {
    let mut event = read_event(row)?;
    event.subscription_id = row.get(12)?;
    Ok(event)
}

fn read_subscription(row: &Row<'_>) -> rusqlite::Result<CalendarSubscription> {
    Ok(CalendarSubscription {
        id: row.get(0)?,
        name: row.get(1)?,
        url: row.get(2)?,
        color: row.get(3)?,
        enabled: row.get::<_, i64>(4)? != 0,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
        last_synced_at: row.get(7)?,
        last_error: row.get(8)?,
    })
}

const EVENT_COLUMNS: &str =
    "id,title,start,end,all_day,location,notes,color,reminder_minutes,repeat,created_at,updated_at";
const SUBSCRIPTION_EVENT_COLUMNS: &str = "e.id,e.title,e.start,e.end,e.all_day,e.location,e.notes,e.color,e.reminder_minutes,e.repeat,e.created_at,e.updated_at,e.subscription_id";
const SUBSCRIPTION_COLUMNS: &str =
    "id,name,url,color,enabled,created_at,updated_at,last_synced_at,last_error";

fn read_exclusions(db: &rusqlite::Connection) -> Result<HashSet<(String, String)>> {
    let mut query = db
        .prepare("SELECT event_id,occurrence_start FROM calendar_exceptions")
        .map_err(err)?;
    let rows = query
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(err)?;
    rows.map(|row| row.map_err(err)).collect()
}

impl Store {
    pub fn calendar_events(&self, from: &str, to: &str) -> Result<Vec<CalendarOccurrence>> {
        let range = Range::parse(from, to)?;
        let db = self.db()?;
        let mut query = db
            .prepare(&format!("SELECT {EVENT_COLUMNS} FROM calendar_events"))
            .map_err(err)?;
        let rows = query.query_map([], read_event).map_err(err)?;
        let mut events = Vec::new();
        for row in rows {
            events.push(row.map_err(err)?);
        }
        let mut query = db
            .prepare(&format!(
                "SELECT {SUBSCRIPTION_EVENT_COLUMNS} FROM calendar_subscription_events e JOIN calendar_subscriptions s ON s.id=e.subscription_id WHERE s.enabled=1"
            ))
            .map_err(err)?;
        let rows = query.query_map([], read_subscription_event).map_err(err)?;
        for row in rows {
            events.push(row.map_err(err)?);
        }
        let excluded = read_exclusions(&db)?;
        let mut out: Vec<CalendarOccurrence> = events
            .iter()
            .flat_map(|event| event.occurrences_in(&range))
            .filter(|occurrence| {
                !excluded.contains(&(occurrence.event.id.clone(), occurrence.start.clone()))
            })
            .collect();
        out.sort_by(|a, b| {
            a.start
                .cmp(&b.start)
                .then_with(|| a.event.title.cmp(&b.event.title))
        });
        Ok(out)
    }

    /// 导出用：返回全部基础事件，不展开重复实例。
    pub fn all_calendar_events(&self) -> Result<Vec<CalendarEvent>> {
        let db = self.db()?;
        let mut query = db
            .prepare(&format!(
                "SELECT {EVENT_COLUMNS} FROM calendar_events ORDER BY start,title"
            ))
            .map_err(err)?;
        let rows = query.query_map([], read_event).map_err(err)?;
        let mut events = Vec::new();
        for row in rows {
            events.push(row.map_err(err)?);
        }
        Ok(events)
    }

    pub fn calendar_subscriptions(&self) -> Result<Vec<CalendarSubscription>> {
        let db = self.db()?;
        let mut query = db
            .prepare(&format!(
                "SELECT {SUBSCRIPTION_COLUMNS} FROM calendar_subscriptions ORDER BY created_at,name"
            ))
            .map_err(err)?;
        let rows = query.query_map([], read_subscription).map_err(err)?;
        rows.map(|row| row.map_err(err)).collect()
    }

    pub fn save_calendar_subscription(
        &self,
        subscription: &CalendarSubscription,
    ) -> Result<CalendarSubscription> {
        let name = subscription.name.trim();
        let url = subscription.url.trim();
        if name.is_empty() {
            return Err("请填写订阅名称".into());
        }
        if !(url.starts_with("https://")
            || url.starts_with("http://")
            || url.starts_with("webcal://"))
        {
            return Err("订阅地址需以 http(s):// 或 webcal:// 开头".into());
        }
        if !COLORS.contains(&subscription.color.as_str()) {
            return Err("订阅颜色无效".into());
        }
        let db = self.db()?;
        let existing: Option<(String, String, String)> = db
            .query_row(
                "SELECT created_at,last_synced_at,last_error FROM calendar_subscriptions WHERE id=?1",
                [&subscription.id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .ok();
        let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        let id = if subscription.id.trim().is_empty() {
            uuid::Uuid::new_v4().to_string()
        } else {
            subscription.id.trim().to_string()
        };
        let (created_at, last_synced_at, last_error) =
            existing.unwrap_or_else(|| (now.clone(), String::new(), String::new()));
        let saved = CalendarSubscription {
            id,
            name: name.to_string(),
            url: url.to_string(),
            color: subscription.color.clone(),
            enabled: subscription.enabled,
            created_at,
            updated_at: now,
            last_synced_at,
            last_error,
        };
        db.execute(
            "INSERT INTO calendar_subscriptions(id,name,url,color,enabled,created_at,updated_at,last_synced_at,last_error) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9) ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url,color=excluded.color,enabled=excluded.enabled,updated_at=excluded.updated_at",
            params![
                saved.id,
                saved.name,
                saved.url,
                saved.color,
                if saved.enabled { 1 } else { 0 },
                saved.created_at,
                saved.updated_at,
                saved.last_synced_at,
                saved.last_error,
            ],
        )
        .map_err(err)?;
        Ok(saved)
    }

    pub fn set_calendar_subscription_enabled(&self, id: &str, enabled: bool) -> Result<()> {
        let db = self.db()?;
        let changed = db
            .execute(
                "UPDATE calendar_subscriptions SET enabled=?2,updated_at=?3 WHERE id=?1",
                params![
                    id,
                    if enabled { 1 } else { 0 },
                    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
                ],
            )
            .map_err(err)?;
        if changed == 0 {
            return Err("订阅日历不存在".into());
        }
        Ok(())
    }

    pub fn delete_calendar_subscription(&self, id: &str) -> Result<()> {
        let db = self.db()?;
        let mut tx = db.unchecked_transaction().map_err(err)?;
        tx.execute(
            "DELETE FROM calendar_subscription_events WHERE subscription_id=?1",
            [id],
        )
        .map_err(err)?;
        tx.execute("DELETE FROM calendar_subscriptions WHERE id=?1", [id])
            .map_err(err)?;
        tx.commit().map_err(err)?;
        Ok(())
    }

    /// 用最新解析结果整体替换订阅事件，避免残留已下线的假期。
    pub fn replace_calendar_subscription_events(
        &self,
        subscription_id: &str,
        events: &[CalendarEvent],
    ) -> Result<usize> {
        let db = self.db()?;
        let exists: bool = db
            .query_row(
                "SELECT 1 FROM calendar_subscriptions WHERE id=?1",
                [subscription_id],
                |_| Ok(true),
            )
            .unwrap_or(false);
        if !exists {
            return Err("订阅日历不存在".into());
        }
        let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        let mut tx = db.unchecked_transaction().map_err(err)?;
        tx.execute(
            "DELETE FROM calendar_subscription_events WHERE subscription_id=?1",
            [subscription_id],
        )
        .map_err(err)?;
        let mut count = 0;
        for event in events {
            event.validate()?;
            let raw_id = if event.id.trim().is_empty() {
                uuid::Uuid::new_v4().to_string()
            } else {
                event.id.trim().to_string()
            };
            let mut saved = event.clone().normalized(
                format!("{subscription_id}:{raw_id}"),
                now.clone(),
                now.clone(),
            );
            saved.subscription_id = subscription_id.to_string();
            tx.execute(
                "INSERT INTO calendar_subscription_events(subscription_id,id,title,start,end,all_day,location,notes,color,reminder_minutes,repeat,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13) ON CONFLICT(subscription_id,id) DO UPDATE SET title=excluded.title,start=excluded.start,end=excluded.end,all_day=excluded.all_day,location=excluded.location,notes=excluded.notes,color=excluded.color,reminder_minutes=excluded.reminder_minutes,repeat=excluded.repeat,updated_at=excluded.updated_at",
                params![
                    saved.subscription_id,
                    saved.id,
                    saved.title,
                    saved.start,
                    saved.end,
                    if saved.all_day { 1 } else { 0 },
                    saved.location,
                    saved.notes,
                    saved.color,
                    saved.reminder_minutes,
                    saved.repeat,
                    saved.created_at,
                    saved.updated_at,
                ],
            )
            .map_err(err)?;
            count += 1;
        }
        tx.execute(
            "UPDATE calendar_subscriptions SET last_synced_at=?2,last_error='',updated_at=?2 WHERE id=?1",
            params![subscription_id, now],
        )
        .map_err(err)?;
        tx.commit().map_err(err)?;
        Ok(count)
    }

    pub fn mark_calendar_subscription_error(&self, id: &str, message: &str) -> Result<()> {
        let db = self.db()?;
        db.execute(
            "UPDATE calendar_subscriptions SET last_error=?2,updated_at=?3 WHERE id=?1",
            params![
                id,
                message,
                Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
            ],
        )
        .map_err(err)?;
        Ok(())
    }

    pub fn save_calendar_event(&self, event: &CalendarEvent) -> Result<CalendarEvent> {
        if !event.subscription_id.is_empty() {
            return Err("订阅日历为只读".into());
        }
        event.validate()?;
        let db = self.db()?;
        let existing_created: Option<String> = db
            .query_row(
                "SELECT created_at FROM calendar_events WHERE id=?1",
                [&event.id],
                |row| row.get(0),
            )
            .ok();
        let id = if event.id.trim().is_empty() {
            uuid::Uuid::new_v4().to_string()
        } else {
            event.id.trim().to_string()
        };
        let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        let saved =
            event
                .clone()
                .normalized(id, existing_created.unwrap_or_else(|| now.clone()), now);
        db.execute(
            "INSERT INTO calendar_events(id,title,start,end,all_day,location,notes,color,reminder_minutes,repeat,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12) ON CONFLICT(id) DO UPDATE SET title=excluded.title,start=excluded.start,end=excluded.end,all_day=excluded.all_day,location=excluded.location,notes=excluded.notes,color=excluded.color,reminder_minutes=excluded.reminder_minutes,repeat=excluded.repeat,updated_at=excluded.updated_at",
            params![
                saved.id,
                saved.title,
                saved.start,
                saved.end,
                if saved.all_day { 1 } else { 0 },
                saved.location,
                saved.notes,
                saved.color,
                saved.reminder_minutes,
                saved.repeat,
                saved.created_at,
                saved.updated_at,
            ],
        )
        .map_err(err)?;
        Ok(saved)
    }

    /// 跳过重复系列中的某一次，不影响其他实例。
    pub fn skip_calendar_occurrence(&self, event_id: &str, occurrence_start: &str) -> Result<()> {
        if event_id.trim().is_empty() || occurrence_start.trim().is_empty() {
            return Err("日程实例无效".into());
        }
        let db = self.db()?;
        db.execute(
            "INSERT OR IGNORE INTO calendar_exceptions(event_id,occurrence_start,created_at) VALUES(?1,?2,?3)",
            params![
                event_id,
                occurrence_start,
                Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
            ],
        )
        .map_err(err)?;
        Ok(())
    }

    pub fn delete_calendar_event(&self, id: &str) -> Result<()> {
        let db = self.db()?;
        db.execute("DELETE FROM calendar_events WHERE id=?1", [id])
            .map_err(err)?;
        db.execute("DELETE FROM calendar_reminder_log WHERE event_id=?1", [id])
            .map_err(err)?;
        db.execute("DELETE FROM calendar_exceptions WHERE event_id=?1", [id])
            .map_err(err)?;
        Ok(())
    }

    /// 返回本轮应当弹出的提醒，并把它们记入日志以防重复。
    pub fn due_calendar_reminders(
        &self,
        now: DateTime<Utc>,
        grace_minutes: i64,
    ) -> Result<Vec<CalendarOccurrence>> {
        let grace_start = now - Duration::minutes(grace_minutes.max(0));
        let range = Range::parse(
            &format_utc(grace_start),
            &format_utc(now + Duration::minutes(MAX_REMINDER_MINUTES)),
        )?;
        let db = self.db()?;
        let mut query = db
            .prepare(&format!(
                "SELECT {EVENT_COLUMNS} FROM calendar_events WHERE reminder_minutes IS NOT NULL"
            ))
            .map_err(err)?;
        let rows = query.query_map([], read_event).map_err(err)?;
        let excluded = read_exclusions(&db)?;
        let mut due = Vec::new();
        for row in rows {
            let event = row.map_err(err)?;
            let Some(minutes) = event.reminder_minutes else {
                continue;
            };
            for occurrence in event
                .occurrences_in(&range)
                .into_iter()
                .filter(|occurrence| {
                    !excluded.contains(&(occurrence.event.id.clone(), occurrence.start.clone()))
                })
            {
                let Some(remind_at) = reminder_at(&event, &occurrence.start, minutes) else {
                    continue;
                };
                if remind_at < grace_start || remind_at > now {
                    continue;
                }
                let inserted = db
                    .execute(
                        "INSERT OR IGNORE INTO calendar_reminder_log(event_id,occurrence_start,fired_at) VALUES(?1,?2,?3)",
                        params![event.id, occurrence.start, format_utc(now)],
                    )
                    .map_err(err)?;
                if inserted > 0 {
                    due.push(occurrence);
                }
            }
        }
        let _ = db.execute(
            "DELETE FROM calendar_reminder_log WHERE fired_at < ?1",
            [format_utc(now - Duration::days(180))],
        );
        Ok(due)
    }
}

/// 通知正文用的本地时间描述。
pub fn occurrence_label(occurrence: &CalendarOccurrence) -> String {
    if occurrence.all_day {
        return "全天".into();
    }
    parse_timed(&occurrence.start)
        .map(|start| {
            start
                .with_timezone(&Local)
                .format("%m月%d日 %H:%M")
                .to_string()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, Store) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().into()).unwrap();
        (dir, store)
    }

    fn event(start: &str, end: &str) -> CalendarEvent {
        CalendarEvent {
            id: "event-1".into(),
            title: "周会".into(),
            start: start.into(),
            end: end.into(),
            all_day: false,
            location: "会议室".into(),
            notes: String::new(),
            color: "blue".into(),
            reminder_minutes: None,
            repeat: "none".into(),
            created_at: String::new(),
            updated_at: String::new(),
            subscription_id: String::new(),
        }
    }

    #[test]
    fn saves_and_lists_events_in_range() {
        let (_dir, store) = store();
        let saved = store
            .save_calendar_event(&event("2026-10-21T01:00:00Z", "2026-10-21T02:00:00Z"))
            .unwrap();
        assert_eq!(saved.title, "周会");
        assert!(!saved.id.is_empty());
        let list = store
            .calendar_events("2026-10-21T00:00:00Z", "2026-10-22T00:00:00Z")
            .unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].event.id, saved.id);
        assert_eq!(list[0].key, format!("{}@2026-10-21T01:00:00Z", saved.id));
        assert!(store
            .calendar_events("2026-10-22T00:00:00Z", "2026-10-23T00:00:00Z")
            .unwrap()
            .is_empty());
    }

    #[test]
    fn rejects_invalid_events() {
        let (_dir, store) = store();
        let mut invalid = event("2026-10-21T02:00:00Z", "2026-10-21T01:00:00Z");
        assert!(store.save_calendar_event(&invalid).is_err());
        invalid = event("2026-10-21T01:00:00Z", "2026-10-21T02:00:00Z");
        invalid.title = "  ".into();
        assert!(store.save_calendar_event(&invalid).is_err());
        invalid.title = "行程".into();
        invalid.repeat = "hourly".into();
        assert!(store.save_calendar_event(&invalid).is_err());
    }

    #[test]
    fn all_day_events_keep_local_dates() {
        let (_dir, store) = store();
        let mut all_day = event("2026-10-21", "2026-10-23");
        all_day.all_day = true;
        store.save_calendar_event(&all_day).unwrap();
        let list = store
            .calendar_events("2026-10-22T00:00:00Z", "2026-10-23T00:00:00Z")
            .unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].start, "2026-10-21");
        assert!(list[0].all_day);
    }

    #[test]
    fn expands_weekly_and_monthly_repeats() {
        let (_dir, store) = store();
        let mut weekly = event("2026-10-05T01:00:00Z", "2026-10-05T02:00:00Z");
        weekly.repeat = "weekly".into();
        store.save_calendar_event(&weekly).unwrap();
        let list = store
            .calendar_events("2026-10-19T00:00:00Z", "2026-10-26T00:00:00Z")
            .unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].start, "2026-10-19T01:00:00Z");

        let mut monthly = event("2026-01-31T01:00:00Z", "2026-01-31T02:00:00Z");
        monthly.id = "monthly".into();
        monthly.repeat = "monthly".into();
        store.save_calendar_event(&monthly).unwrap();
        let list = store
            .calendar_events("2026-02-01T00:00:00Z", "2026-03-01T00:00:00Z")
            .unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].start, "2026-02-28T01:00:00Z");
    }

    #[test]
    fn reminders_fire_once() {
        let (_dir, store) = store();
        let mut event = event("2026-10-21T02:00:00Z", "2026-10-21T03:00:00Z");
        event.reminder_minutes = Some(15);
        store.save_calendar_event(&event).unwrap();
        let due = store
            .due_calendar_reminders(
                DateTime::parse_from_rfc3339("2026-10-21T01:45:30Z")
                    .unwrap()
                    .with_timezone(&Utc),
                60,
            )
            .unwrap();
        assert_eq!(due.len(), 1);
        let again = store
            .due_calendar_reminders(
                DateTime::parse_from_rfc3339("2026-10-21T01:46:00Z")
                    .unwrap()
                    .with_timezone(&Utc),
                60,
            )
            .unwrap();
        assert!(again.is_empty());
    }

    #[test]
    fn all_day_reminders_use_nine_am_local() {
        let (_dir, store) = store();
        let mut all_day = event("2026-10-21", "2026-10-21");
        all_day.all_day = true;
        all_day.reminder_minutes = Some(0);
        store.save_calendar_event(&all_day).unwrap();
        let nine = Local
            .with_ymd_and_hms(2026, 10, 21, 9, 0, 30)
            .single()
            .unwrap()
            .with_timezone(&Utc);
        let due = store.due_calendar_reminders(nine, 60).unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].start, "2026-10-21");
    }

    #[test]
    fn skips_one_occurrence_of_a_repeating_event() {
        let (_dir, store) = store();
        let mut weekly = event("2026-10-05T01:00:00Z", "2026-10-05T02:00:00Z");
        weekly.repeat = "weekly".into();
        weekly.reminder_minutes = Some(0);
        store.save_calendar_event(&weekly).unwrap();
        store
            .skip_calendar_occurrence(&weekly.id, "2026-10-12T01:00:00Z")
            .unwrap();
        let list = store
            .calendar_events("2026-10-11T00:00:00Z", "2026-10-14T00:00:00Z")
            .unwrap();
        assert!(list.is_empty());
        let due = store
            .due_calendar_reminders(
                DateTime::parse_from_rfc3339("2026-10-12T01:00:30Z")
                    .unwrap()
                    .with_timezone(&Utc),
                60,
            )
            .unwrap();
        assert!(due.is_empty());
        let next = store
            .calendar_events("2026-10-18T00:00:00Z", "2026-10-21T00:00:00Z")
            .unwrap();
        assert_eq!(next.len(), 1);
    }

    #[test]
    fn lists_base_events_for_export() {
        let (_dir, store) = store();
        let mut weekly = event("2026-10-05T01:00:00Z", "2026-10-05T02:00:00Z");
        weekly.repeat = "weekly".into();
        store.save_calendar_event(&weekly).unwrap();
        let mut second = event("2026-10-06T01:00:00Z", "2026-10-06T02:00:00Z");
        second.id = "event-2".into();
        store.save_calendar_event(&second).unwrap();
        let all = store.all_calendar_events().unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all.iter().filter(|item| item.repeat == "weekly").count(), 1);
    }

    #[test]
    fn subscription_events_are_read_only_and_follow_enabled() {
        let (_dir, store) = store();
        let subscription = store
            .save_calendar_subscription(&CalendarSubscription {
                id: String::new(),
                name: "香港公众假期".into(),
                url: "https://www.1823.gov.hk/common/ical/sc.ics".into(),
                color: "orange".into(),
                enabled: true,
                created_at: String::new(),
                updated_at: String::new(),
                last_synced_at: String::new(),
                last_error: String::new(),
            })
            .unwrap();
        let mut holiday = event("2026-07-01", "2026-07-01");
        holiday.id = "20260701@1823.gov.hk".into();
        holiday.title = "香港特別行政區成立紀念日".into();
        holiday.all_day = true;
        holiday.color = "orange".into();
        assert_eq!(
            store
                .replace_calendar_subscription_events(&subscription.id, &[holiday])
                .unwrap(),
            1
        );
        let list = store
            .calendar_events("2026-07-01T00:00:00Z", "2026-07-02T00:00:00Z")
            .unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].event.subscription_id, subscription.id);
        assert!(store.save_calendar_event(&list[0].event).is_err());

        store
            .set_calendar_subscription_enabled(&subscription.id, false)
            .unwrap();
        assert!(store
            .calendar_events("2026-07-01T00:00:00Z", "2026-07-02T00:00:00Z")
            .unwrap()
            .is_empty());

        store
            .delete_calendar_subscription(&subscription.id)
            .unwrap();
        assert!(store.calendar_subscriptions().unwrap().is_empty());
        assert!(store
            .replace_calendar_subscription_events(&subscription.id, &[])
            .is_err());
    }

    #[test]
    fn rejects_invalid_subscription_url() {
        let (_dir, store) = store();
        let result = store.save_calendar_subscription(&CalendarSubscription {
            id: String::new(),
            name: "本地文件".into(),
            url: "file:///tmp/calendar.ics".into(),
            color: "blue".into(),
            enabled: true,
            created_at: String::new(),
            updated_at: String::new(),
            last_synced_at: String::new(),
            last_error: String::new(),
        });
        assert!(result.is_err());
    }

    #[test]
    fn missed_reminders_do_not_fire_after_grace() {
        let (_dir, store) = store();
        let mut event = event("2026-10-21T02:00:00Z", "2026-10-21T03:00:00Z");
        event.reminder_minutes = Some(0);
        store.save_calendar_event(&event).unwrap();
        let due = store
            .due_calendar_reminders(
                DateTime::parse_from_rfc3339("2026-10-21T03:30:00Z")
                    .unwrap()
                    .with_timezone(&Utc),
                60,
            )
            .unwrap();
        assert!(due.is_empty());
    }
}
