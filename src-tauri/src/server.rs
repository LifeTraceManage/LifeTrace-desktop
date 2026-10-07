mod analytics;
mod execution;
mod execution_calendar;
mod execution_cloud;
mod execution_memo;
mod execution_relation;
mod execution_reminder;
mod execution_structure;
mod execution_waiting;
mod footprints;
mod imports;
pub(crate) mod migration;
mod notes;
pub(crate) mod photo;
mod state;
mod xunji;

use std::{
    net::SocketAddr,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use axum::{
    extract::{Request, State},
    http::{Method, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use rusqlite::Connection;
use serde::Serialize;
use tokio::net::TcpListener;
use tower_http::cors::{Any, CorsLayer};

use crate::database;

#[derive(Clone)]
pub(crate) struct AppState {
    data_dir: PathBuf,
    database: Arc<Mutex<Connection>>,
    photo_runtime: Arc<photo::Runtime>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Health {
    ok: bool,
    runtime: &'static str,
    data_dir: String,
}

async fn signal_local_sync(
    State(sync_state): State<crate::sync::SyncDesktopState>,
    request: Request,
    next: Next,
) -> Response {
    let mutating = matches!(
        request.method(),
        &Method::POST | &Method::PUT | &Method::PATCH | &Method::DELETE
    );
    let response = next.run(request).await;
    if mutating && response.status().is_success() {
        sync_state.signal_local_change();
    }
    response
}

async fn health(State(state): State<AppState>) -> impl IntoResponse {
    (
        StatusCode::OK,
        Json(Health {
            ok: true,
            runtime: "tauri-rust",
            data_dir: state.data_dir.display().to_string(),
        }),
    )
}


fn execution_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/execution/projects",
            get(execution::list_projects).post(execution::create_project),
        )
        .route(
            "/api/execution/projects/{id}",
            get(execution::get_project)
                .put(execution::update_project)
                .delete(execution::delete_project),
        )
        .route(
            "/api/execution/tasks",
            get(execution::list_tasks).post(execution::create_task),
        )
        .route(
            "/api/execution/tasks/{id}",
            get(execution::get_task)
                .put(execution::update_task)
                .delete(execution::delete_task),
        )
        .route(
            "/api/execution/tasks/{id}/status",
            axum::routing::put(execution::change_task_status),
        )
        .route(
            "/api/execution/tasks/{id}/completion-result",
            get(execution_relation::get_completion).put(execution_relation::save_completion),
        )
        .route(
            "/api/execution/tasks/{id}/schedule",
            axum::routing::post(execution_calendar::schedule_task),
        )
        .route(
            "/api/execution/tasks/{id}/subtasks",
            get(execution_structure::list_subtasks).post(execution_structure::add_subtask),
        )
        .route(
            "/api/execution/tasks/{id}/dependencies",
            get(execution_structure::list_dependencies).post(execution_structure::add_dependency),
        )
        .route(
            "/api/execution/tasks/{id}/dependencies/{prerequisite_id}",
            axum::routing::delete(execution_structure::remove_dependency),
        )
        .route(
            "/api/execution/tasks/{id}/blockers",
            get(execution_structure::list_blockers),
        )
        .route(
            "/api/execution/tasks/{id}/recurrence",
            get(execution_structure::get_recurrence)
                .put(execution_structure::set_recurrence)
                .delete(execution_structure::clear_recurrence),
        )
        .route(
            "/api/execution/tasks/{id}/occurrences",
            get(execution_structure::list_occurrences)
                .post(execution_structure::materialize_occurrence),
        )
        .route(
            "/api/execution/tasks/{id}/occurrences/{occurrence_id}",
            axum::routing::put(execution_structure::update_occurrence),
        )
        .route(
            "/api/execution/tasks/{id}/occurrences/{occurrence_id}/status",
            axum::routing::put(execution_structure::change_occurrence_status),
        )
        .route(
            "/api/execution/tasks/{id}/waiting-item",
            axum::routing::post(execution_waiting::create_waiting_from_task),
        )
        .route(
            "/api/execution/calendar-events",
            get(execution_calendar::list_events).post(execution_calendar::create_event),
        )
        .route(
            "/api/execution/calendar-events/{id}",
            get(execution_calendar::get_event)
                .put(execution_calendar::update_event)
                .delete(execution_calendar::delete_event),
        )
        .route(
            "/api/execution/calendar-events/{id}/move",
            axum::routing::put(execution_calendar::move_event),
        )
        .route(
            "/api/execution/calendar-events/{id}/cancel",
            axum::routing::post(execution_calendar::cancel_event),
        )
        .route(
            "/api/execution/calendar-events/{id}/recurrence",
            get(execution_calendar::get_recurrence)
                .put(execution_calendar::set_recurrence)
                .delete(execution_calendar::clear_recurrence),
        )
        .route(
            "/api/execution/calendar-events/{id}/occurrences",
            get(execution_calendar::list_occurrences)
                .post(execution_calendar::materialize_occurrence),
        )
        .route(
            "/api/execution/calendar-events/{id}/occurrences/{occurrence_id}",
            axum::routing::put(execution_calendar::update_occurrence),
        )
        .route(
            "/api/execution/calendar-events/{id}/occurrences/{occurrence_id}/status",
            axum::routing::put(execution_calendar::change_occurrence_status),
        )
        .route(
            "/api/execution/calendar-conflicts",
            axum::routing::post(execution_calendar::find_conflicts),
        )
        .route(
            "/api/execution/important-dates",
            get(execution_cloud::list_important_dates)
                .post(execution_cloud::create_important_date),
        )
        .route(
            "/api/execution/important-dates/{id}",
            get(execution_cloud::get_important_date)
                .put(execution_cloud::update_important_date)
                .delete(execution_cloud::delete_important_date),
        )
        .route(
            "/api/execution/focus-sessions",
            get(execution_cloud::list_focus_sessions)
                .post(execution_cloud::create_focus_session),
        )
        .route(
            "/api/execution/focus-sessions/{id}",
            get(execution_cloud::get_focus_session)
                .put(execution_cloud::update_focus_session)
                .delete(execution_cloud::delete_focus_session),
        )
        .route(
            "/api/execution/reminders",
            get(execution_reminder::list_subject).post(execution_reminder::create),
        )
        .route(
            "/api/execution/reminders/due",
            get(execution_reminder::list_due),
        )
        .route(
            "/api/execution/reminders/{id}",
            get(execution_reminder::get)
                .put(execution_reminder::update)
                .delete(execution_reminder::delete),
        )
        .route(
            "/api/execution/reminders/{id}/fire",
            axum::routing::post(execution_reminder::fire),
        )
        .route(
            "/api/execution/reminders/{id}/snooze",
            axum::routing::post(execution_reminder::snooze),
        )
        .route(
            "/api/execution/reminders/{id}/dismiss",
            axum::routing::post(execution_reminder::dismiss),
        )
        .route(
            "/api/execution/reminders/{id}/cancel",
            axum::routing::post(execution_reminder::cancel),
        )
        .route(
            "/api/execution/memos",
            get(execution_memo::list).post(execution_memo::create),
        )
        .route(
            "/api/execution/memos/{id}",
            get(execution_memo::get)
                .put(execution_memo::update)
                .delete(execution_memo::delete),
        )
        .route(
            "/api/execution/memos/{id}/pin",
            axum::routing::put(execution_memo::pin),
        )
        .route(
            "/api/execution/memos/{id}/archive",
            axum::routing::post(execution_memo::archive),
        )
        .route(
            "/api/execution/memos/{id}/restore",
            axum::routing::post(execution_memo::restore),
        )
        .route(
            "/api/execution/memos/{id}/convert-to-task",
            axum::routing::post(execution_memo::convert_to_task),
        )
        .route(
            "/api/execution/memos/{id}/convert-to-calendar",
            axum::routing::post(execution_memo::convert_to_calendar),
        )
        .route(
            "/api/execution/memos/{id}/convert-to-waiting",
            axum::routing::post(execution_memo::convert_to_waiting),
        )
        .route(
            "/api/execution/waiting-items",
            get(execution_waiting::list_waiting_items).post(execution_waiting::create_waiting_item),
        )
        .route(
            "/api/execution/waiting-items/{id}",
            get(execution_waiting::get_waiting_item)
                .put(execution_waiting::update_waiting_item)
                .delete(execution_waiting::delete_waiting_item),
        )
        .route(
            "/api/execution/waiting-items/{id}/resolve",
            axum::routing::post(execution_waiting::resolve_waiting_item),
        )
        .route(
            "/api/execution/waiting-items/{id}/cancel",
            axum::routing::post(execution_waiting::cancel_waiting_item),
        )
        .route(
            "/api/execution/waiting-items/{id}/convert-to-task",
            axum::routing::post(execution_waiting::convert_waiting_to_task),
        )
        .route(
            "/api/execution/entity-links",
            get(execution_relation::list_links).post(execution_relation::create_link),
        )
        .route(
            "/api/execution/entity-links/{id}",
            axum::routing::delete(execution_relation::delete_link),
        )
}

fn local_json_routes() -> Router<AppState> {
    Router::new()
        .merge(local_json_routes())
        .route("/api/xunji/parse", axum::routing::post(xunji::parse))
        .route("/api/xunji/imports", get(xunji::list).post(xunji::update))
        .layer(middleware::from_fn_with_state(
            sync_state,
            signal_local_sync,
        ))
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .with_state(state);
    let address = SocketAddr::from(([127, 0, 0, 1], 3103));
    let listener = TcpListener::bind(address).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
