//! Shared local-date interpretation for non-finance records.
use chrono::{DateTime, NaiveDate, Utc};
pub fn local_date_of(value: &str) -> Result<String, String> {
    let stamp = if let Ok(parsed) = DateTime::parse_from_rfc3339(value) {
        parsed.to_rfc3339()
    } else if let Ok(day) = NaiveDate::parse_from_str(value, "%Y-%m-%d") {
        DateTime::<Utc>::from_naive_utc_and_offset(
            day.and_hms_opt(0, 0, 0).ok_or("invalid date")?, Utc
        ).to_rfc3339()
    } else {
        return Err(format!("时间格式无法解析: {value}"));
    };
    stamp.get(0..10).map(str::to_owned).ok_or_else(|| format!("无法推导自然日: {value}"))
}
