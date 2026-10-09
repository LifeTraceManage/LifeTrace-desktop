use chrono::{DateTime, Utc};
use lifetrace_contracts::registry::{describe, EntityOwnership, SyncMode};
use serde_json::{json, Map, Value};

fn stamp(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .and_then(|raw| DateTime::parse_from_rfc3339(raw).ok())
        .map(|value| value.with_timezone(&Utc).to_rfc3339())
        .unwrap_or_else(|| Utc::now().to_rfc3339())
}

fn text(value: Option<&Value>, fallback: &str) -> String {
    value.and_then(Value::as_str).unwrap_or(fallback).to_owned()
}

fn optional_string(value: Option<&Value>) -> Value {
    value
        .and_then(Value::as_str)
        .map(|v| json!(v))
        .unwrap_or(Value::Null)
}

fn common_meta(
    object: &Map<String, Value>,
    profile_id: &str,
    server_version: Option<&str>,
) -> Value {
    json!({
        "id": text(object.get("id"), ""),
        "userId": profile_id,
        "createdAt": stamp(object.get("createdAt")),
        "updatedAt": stamp(object.get("updatedAt")),
        "deletedAt": object.get("deletedAt").cloned().unwrap_or(Value::Null),
        "localVersion": object.get("version").and_then(Value::as_u64).unwrap_or(1),
        "serverVersion": server_version,
        "modifiedByDevice": object.get("modifiedByDevice").cloned().unwrap_or(Value::Null),
    })
}

pub fn is_syncable(entity_type: &str) -> bool {
    if entity_type.starts_with("finance.") { return false; }
    describe(entity_type).is_some_and(|descriptor| {
        descriptor.ownership == EntityOwnership::UserOwned
            && matches!(
                descriptor.sync_mode,
                SyncMode::Bidirectional | SyncMode::ClientToServer
            )
    })
}

/// Convert the legacy/UI DTO to the published EPIC-02 entity contract. This
/// boundary also prevents credential/settings JSON from entering the outbox.
pub fn legacy_to_wire(
    entity_type: &str,
    value: &Value,
    profile_id: &str,
    server_version: Option<&str>,
) -> Result<Value, String> {
    if !is_syncable(entity_type) {
        return Err(format!("entity type is not client-syncable: {entity_type}"));
    }
    let object = value
        .as_object()
        .ok_or_else(|| "sync payload must be an object".to_owned())?;
    let meta = common_meta(object, profile_id, server_version);
    let payload = match entity_type {
        "asset.asset" => json!({
            "id": text(object.get("id"), ""),
            "name": text(object.get("name"), ""),
            "brand": text(object.get("brand"), ""),
            "model": text(object.get("model"), ""),
            "category": text(object.get("category"), "other"),
            "status": text(object.get("status"), "active"),
            "purchasePrice": object.get("purchasePrice").and_then(Value::as_f64).unwrap_or(0.0),
            "currentValue": object.get("currentValue").and_then(Value::as_f64).unwrap_or(0.0),
            "purchaseDate": stamp(object.get("purchaseDate")),
            "warrantyUntil": object.get("warrantyUntil").cloned().unwrap_or(Value::Null),
            "spec": text(object.get("spec"), ""),
            "serialNumber": text(object.get("serialNumber"), ""),
            "location": text(object.get("location"), ""),
            "targetDailyCost": object.get("targetDailyCost").and_then(Value::as_f64).unwrap_or(0.0),
            "purchaseChannel": text(object.get("purchaseChannel"), ""),
            "maintenanceCost": object.get("maintenanceCost").and_then(Value::as_f64).unwrap_or(0.0),
            "recoveredAmount": object.get("recoveredAmount").and_then(Value::as_f64).unwrap_or(0.0),
            "createdAt": stamp(object.get("createdAt")),
            "updatedAt": stamp(object.get("updatedAt")),
            "isDeleted": object.get("isDeleted").and_then(Value::as_bool).unwrap_or(false),
            "serverVersion": object.get("serverVersion").cloned()
                .unwrap_or_else(|| json!(server_version.unwrap_or("0")))
        }),
        "asset.event" => json!({
            "id": text(object.get("id"), ""),
            "assetId": text(object.get("assetId"), ""),
            "type": text(object.get("type"), "note"),
            "date": stamp(object.get("date")),
            "title": text(object.get("title"), ""),
            "detail": text(object.get("detail"), ""),
            "amount": object.get("amount").cloned().unwrap_or(Value::Null),
            "createdAt": stamp(object.get("createdAt")),
            "updatedAt": stamp(object.get("updatedAt")),
            "isDeleted": object.get("isDeleted").and_then(Value::as_bool).unwrap_or(false),
            "serverVersion": object.get("serverVersion").cloned()
                .unwrap_or_else(|| json!(server_version.unwrap_or("0")))
        }),
        "habit.activity" => json!({
            "meta": meta,
            "name": text(object.get("name"), "习惯"),
            "activityType": text(object.get("activityType").or_else(|| object.get("type")), "boolean"),
            "unit": text(object.get("unit"), ""),
            "minimumTarget": object.get("minimumTarget").cloned().unwrap_or(Value::Null),
            "normalTarget": object.get("normalTarget").cloned().unwrap_or(Value::Null),
            "targetPeriod": text(object.get("targetPeriod"), "daily"),
            "targetDays": object.get("targetDays").cloned().unwrap_or_else(|| json!([])),
            "icon": object.get("icon").cloned().unwrap_or(Value::Null),
            "color": object.get("color").cloned().unwrap_or(Value::Null),
            "scheduleType": object.get("scheduleType").cloned().unwrap_or(Value::Null),
            "startDate": object.get("startDate").cloned().unwrap_or(Value::Null),
            "checkinMethod": object.get("checkinMethod").cloned().unwrap_or(Value::Null),
            "syncSource": object.get("syncSource").and_then(Value::as_str).filter(|value| *value == "fitness").map(|value| json!(value)).unwrap_or(Value::Null),
            "description": object.get("description").cloned().unwrap_or(Value::Null),
            "isArchived": object.get("isArchived").and_then(Value::as_bool).unwrap_or(false)
        }),
        "habit.log" => {
            let created = stamp(object.get("createdAt").or_else(|| object.get("updatedAt")));
            json!({
                "meta": meta,
                "activityId": object.get("activityId").cloned().unwrap_or(Value::Null),
                "logDate": object.get("logDate").cloned().unwrap_or_else(|| json!(created.get(0..10).unwrap_or("1970-01-01"))),
                "value": object.get("value").cloned().unwrap_or(Value::Null),
                "status": object.get("status").cloned().unwrap_or(Value::Null),
                "note": object.get("note").cloned().unwrap_or(Value::Null),
                "metadata": object.get("metadata").cloned().unwrap_or(Value::Null)
            })
        }
        "review.daily" => json!({
            "meta": meta,
            "reviewDate": text(object.get("reviewDate"), Utc::now().date_naive().to_string().as_str()),
            "energy": object.get("energy").cloned().unwrap_or(Value::Null),
            "mood": object.get("mood").cloned().unwrap_or(Value::Null),
            "completionScore": object.get("completionScore").cloned().unwrap_or(Value::Null),
            "bestThing": object.get("bestThing").cloned().unwrap_or(Value::Null),
            "problem": object.get("problem").cloned().unwrap_or(Value::Null),
            "tomorrowPriority": object.get("tomorrowPriority").cloned().unwrap_or(Value::Null),
            "note": object.get("note").cloned().unwrap_or(Value::Null)
        }),
        "note.folder" => json!({
            "meta": meta, "name": text(object.get("name"), "文件夹"),
            "icon": text(object.get("icon"), ""), "color": text(object.get("color"), "#64748b"),
            "parentFolderId": object.get("parentFolderId").cloned().unwrap_or(Value::Null),
            "sortOrder": object.get("sortOrder").and_then(Value::as_i64).unwrap_or(0)
        }),
        "note.tag" => json!({
            "meta": meta, "name": text(object.get("name"), "标签"),
            "color": text(object.get("color"), "#64748b")
        }),
        "note.note" => json!({
            "meta": meta,
            "title": object.get("title").cloned().unwrap_or(Value::Null),
            "noteType": text(object.get("noteType"), "normal"),
            "folderId": object.get("folderId").cloned().unwrap_or(Value::Null),
            "contentJson": object.get("contentJson").cloned().unwrap_or_else(|| json!({"type":"doc","content":[]})),
            "contentHtml": text(object.get("contentHtml"), ""),
            "contentText": text(object.get("contentText"), ""),
            "contentMarkdown": text(object.get("contentMarkdown"), ""),
            "summary": text(object.get("summary"), ""),
            "isPinned": object.get("isPinned").and_then(Value::as_bool).unwrap_or(false),
            "isFavorite": object.get("isFavorite").and_then(Value::as_bool).unwrap_or(false),
            "isArchived": object.get("isArchived").and_then(Value::as_bool).unwrap_or(false),
            "aiSummary": object.get("aiSummary").cloned().unwrap_or(Value::Null),
            "aiTags": object.get("aiTags").cloned().unwrap_or(Value::Null),
            "embeddingStatus": object.get("embeddingStatus").cloned().unwrap_or(Value::Null),
            "lastAiProcessedAt": object.get("lastAiProcessedAt").cloned().unwrap_or(Value::Null)
        }),
        "execution.important_date" => json!({
            "id": text(object.get("id"), ""),
            "userId": profile_id,
            "title": text(object.get("title"), ""),
            "date": text(object.get("date"), Utc::now().date_naive().to_string().as_str()),
            "repeat": text(object.get("repeat"), "once"),
            "kind": text(object.get("kind"), "other"),
            "calendar": text(object.get("calendar"), "solar"),
            "lunarYear": object.get("lunarYear").cloned().unwrap_or(Value::Null),
            "lunarMonth": object.get("lunarMonth").cloned().unwrap_or(Value::Null),
            "lunarDay": object.get("lunarDay").cloned().unwrap_or(Value::Null),
            "lunarLeapMonth": object.get("lunarLeapMonth").and_then(Value::as_bool).unwrap_or(false),
            "enabled": object.get("enabled").and_then(Value::as_bool).unwrap_or(true)
        }),
        "execution.focus_session" => json!({
            "id": text(object.get("id"), ""),
            "userId": profile_id,
            "taskId": object.get("taskId").cloned().unwrap_or(Value::Null),
            "mode": text(object.get("mode"), "short"),
            "startedAt": stamp(object.get("startedAt")),
            "endedAt": stamp(object.get("endedAt")),
            "focusSeconds": object.get("focusSeconds").and_then(Value::as_u64).unwrap_or(0),
            "completed": object.get("completed").and_then(Value::as_bool).unwrap_or(false)
        }),
        "workout.workout" => json!({
            "meta": meta,
            "source": text(object.get("source"), "manual"),
            "sourceId": object.get("sourceId").cloned().unwrap_or(Value::Null),
            "name": text(object.get("name"), "训练记录"),
            "occurredAt": stamp(object.get("occurredAt")),
            "localDate": object.get("localDate").cloned().unwrap_or_else(|| json!(stamp(object.get("occurredAt")).get(0..10).unwrap_or("1970-01-01"))),
            "durationSeconds": object.get("durationSeconds").and_then(Value::as_i64).unwrap_or(0),
            "exerciseCount": object.get("exerciseCount").and_then(Value::as_i64).unwrap_or(0),
            "setCount": object.get("setCount").and_then(Value::as_i64).unwrap_or(0),
            "plannedSetCount": object.get("plannedSetCount").cloned().unwrap_or(Value::Null),
            "volumeKg": object.get("volumeKg").cloned().unwrap_or(Value::Null),
            "caloriesKcal": object.get("caloriesKcal").cloned().unwrap_or(Value::Null),
            "status": object.get("status").cloned().unwrap_or(Value::Null)
        }),
        "workout.import" => json!({
            "meta": meta, "source": text(object.get("source"), "xunji"),
            "shareUrl": object.get("shareUrl").cloned().unwrap_or(Value::Null),
            "status": text(object.get("status"), "pending"),
            "parser": object.get("parser").cloned().unwrap_or(Value::Null),
            "parserVersion": object.get("parserVersion").cloned().unwrap_or(Value::Null),
            "error": object.get("error").cloned().unwrap_or(Value::Null),
            "workoutId": object.get("workoutId").or_else(|| object.get("workoutRecordId")).cloned().unwrap_or(Value::Null)
        }),
        "workout.training_note" => json!({
            "meta": meta, "title": text(object.get("title"), ""),
            "content": text(object.get("content"), ""),
            "workoutId": object.get("workoutId").or_else(|| object.get("workoutRecordId")).cloned().unwrap_or(Value::Null),
            "source": text(object.get("source"), "manual"),
            "noteDate": text(object.get("noteDate"), Utc::now().date_naive().to_string().as_str())
        }),
        // English and relation entities already use names close to the public
        // contract. Preserve fields while replacing ownership metadata.
        _ => {
            let mut copy = object.clone();
            copy.remove("id");
            copy.remove("userId");
            copy.remove("createdAt");
            copy.remove("updatedAt");
            copy.remove("deletedAt");
            copy.remove("version");
            copy.remove("modifiedByDevice");
            copy.insert("meta".to_owned(), meta);
            Value::Object(copy)
        }
    };
    Ok(payload)
}

/// Convert a wire contract payload back to the legacy repository DTO.
pub fn wire_to_legacy(payload: &Value) -> Result<Value, String> {
    let object = payload
        .as_object()
        .ok_or_else(|| "wire payload must be an object".to_owned())?;
    let mut legacy = object.clone();
    let meta = legacy
        .remove("meta")
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    for (wire, local) in [
        ("id", "id"),
        ("userId", "userId"),
        ("createdAt", "createdAt"),
        ("updatedAt", "updatedAt"),
        ("deletedAt", "deletedAt"),
        ("localVersion", "version"),
        ("modifiedByDevice", "modifiedByDevice"),
    ] {
        if let Some(value) = meta.get(wire) {
            legacy.insert(local.to_owned(), value.clone());
        }
    }
    for (wire, local) in [
        ("activityType", "type"),
    ] {
        if let Some(value) = legacy.remove(wire) {
            legacy.insert(local.to_owned(), value);
        }
    }
    Ok(Value::Object(legacy))
}

#[cfg(test)]
mod tests {
    use super::*;
    use lifetrace_contracts::domain::payload::EntityPayload;
    use lifetrace_contracts::EntityType;

    #[test]
    fn asset_payloads_do_not_receive_entity_meta() {
        let asset = json!({
            "id":"asset-1","name":"Phone","brand":"LifeTrace","model":"V1",
            "category":"phone","status":"active","purchasePrice":1000.0,"currentValue":800.0,
            "purchaseDate":"2026-01-01T00:00:00Z","warrantyUntil":null,"spec":"",
            "serialNumber":"","location":"","targetDailyCost":5.0,"purchaseChannel":"store",
            "maintenanceCost":0.0,"recoveredAmount":0.0,
            "createdAt":"2026-09-24T00:00:00Z","updatedAt":"2026-09-24T00:00:00Z",
            "isDeleted":false,"serverVersion":"0"
        });
        let wire = legacy_to_wire(EntityType::ASSET_ASSET, &asset, "profile-1", Some("0")).unwrap();
        assert!(wire.get("meta").is_none());
        assert!(wire.get("userId").is_none());
        assert!(EntityPayload::try_from((
            &EntityType::new(EntityType::ASSET_ASSET),
            wire.clone().into(),
        )).is_ok(), "{wire}");
    }

    #[test]
    fn execution_cloud_extension_payloads_match_strict_contracts() {
        let important = json!({
            "id":"date-1","userId":"profile-1","title":"Birthday","date":"2026-10-15",
            "repeat":"yearly","kind":"birthday","calendar":"solar",
            "lunarYear":null,"lunarMonth":null,"lunarDay":null,
            "lunarLeapMonth":false,"enabled":true,
            "createdAt":"2026-09-24T00:00:00Z","updatedAt":"2026-09-24T00:00:00Z","version":1
        });
        let important_wire = legacy_to_wire(
            EntityType::EXECUTION_IMPORTANT_DATE,
            &important,
            "profile-1",
            None,
        ).unwrap();
        assert!(important_wire.get("meta").is_none());
        assert!(important_wire.get("createdAt").is_none());
        assert!(EntityPayload::try_from((
            &EntityType::new(EntityType::EXECUTION_IMPORTANT_DATE),
            important_wire.clone().into(),
        )).is_ok(), "{important_wire}");

        let focus = json!({
            "id":"focus-1","userId":"profile-1","taskId":"task-1","mode":"short",
            "startedAt":"2026-09-24T10:00:00Z","endedAt":"2026-09-24T10:25:00Z",
            "focusSeconds":1500,"completed":true,
            "createdAt":"2026-09-24T10:00:00Z","updatedAt":"2026-09-24T10:25:00Z","version":1
        });
        let focus_wire = legacy_to_wire(
            EntityType::EXECUTION_FOCUS_SESSION,
            &focus,
            "profile-1",
            None,
        ).unwrap();
        assert!(focus_wire.get("meta").is_none());
        assert!(focus_wire.get("version").is_none());
        assert!(EntityPayload::try_from((
            &EntityType::new(EntityType::EXECUTION_FOCUS_SESSION),
            focus_wire.clone().into(),
        )).is_ok(), "{focus_wire}");
    }


}
