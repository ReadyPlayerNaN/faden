pub mod ai;
pub mod app_state;
pub mod commands;
pub mod db;
pub mod domain;
pub mod error;
pub mod export;
pub mod history;
pub mod import;
pub mod llm;
pub mod media_server;
pub mod secrets;
pub mod settings;
pub mod transcription;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,faden=debug".into()),
        )
        .init();

    tauri::Builder::default()
        .manage(app_state::AppState::default())
        .setup(|app| {
            media_server::start(app.handle().clone())?;
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::project::project_create,
            commands::project::project_open,
            commands::project::project_rename,
            commands::project::project_update,
            commands::history::history_undo,
            commands::history::history_redo,
            commands::history::history_status,
            commands::settings::settings_get,
            commands::settings::settings_set,
            commands::settings::settings_add_recent,
            commands::settings::settings_recent_rename,
            commands::settings::settings_recent_remove,
            commands::settings::settings_provider_test,
            commands::settings::settings_system_appearance,
            commands::settings::project_settings_get,
            commands::settings::project_settings_set,
            commands::codebook::codebook_tree,
            commands::codebook::cluster_create,
            commands::codebook::cluster_rename,
            commands::codebook::cluster_set_description,
            commands::codebook::cluster_set_color,
            commands::codebook::cluster_delete,
            commands::codebook::cluster_reorder,
            commands::codebook::category_create,
            commands::codebook::category_rename,
            commands::codebook::category_set_description,
            commands::codebook::category_set_color,
            commands::codebook::category_delete,
            commands::codebook::category_reorder,
            commands::codebook::category_move_to_cluster,
            commands::codebook::tag_create,
            commands::codebook::tag_rename,
            commands::codebook::tag_set_description,
            commands::codebook::tag_set_color,
            commands::codebook::tag_delete,
            commands::codebook::tag_reorder,
            commands::codebook::tag_move_to_category,
            commands::interview::interview_create,
            commands::interview::interview_list,
            commands::interview::interview_get,
            commands::interview::interview_rename,
            commands::interview::interview_delete,
            commands::interview::interview_create_with_audio,
            commands::interview::interview_import_text,
            commands::interview::interview_import_json,
            commands::interview::interview_import_audio_text,
            commands::interview::interview_import_audio_json,
            commands::interview::interview_replace_transcript_text,
            commands::interview::interview_replace_transcript_json,
            commands::interview::segment_list_for_interview,
            commands::interview::speaker_list_for_interview,
            commands::interview::speaker_create,
            commands::interview::speaker_set_display_name,
            commands::interview::speaker_set_person,
            commands::interview::speaker_merge,
            commands::interview::speaker_delete,
            commands::interview::interview_set_audio,
            commands::interview::interview_clear_audio,
            commands::interview::interview_audio_stream_url,
            commands::segment::segment_update_text,
            commands::segment::segment_set_speaker,
            commands::segment::segment_append,
            commands::segment::segment_delete,
            commands::segment::segment_split,
            commands::segment::segment_merge,
            commands::person::person_list,
            commands::person::person_create,
            commands::person::person_rename,
            commands::person::person_delete,
            commands::transcribe::transcribe_start,
            commands::transcribe::transcribe_cancel,
            commands::transcribe::transcribe_status,
            commands::tagging::span_create,
            commands::tagging::span_update_tags,
            commands::tagging::span_update_offsets,
            commands::tagging::span_delete,
            commands::tagging::span_get,
            commands::tagging::span_list_for_interview,
            commands::tagging::memo_upsert,
            commands::ai::ai_codebook_gen_start,
            commands::ai::ai_pretag_start,
            commands::ai::ai_find_more_start,
            commands::ai::ai_categorize_start,
            commands::ai::ai_cluster_start,
            commands::ai::ai_run_list,
            commands::ai::ai_run_get,
            commands::ai::ai_run_detail,
            commands::ai::ai_run_retry,
            commands::ai::ai_proposal_get,
            commands::ai::ai_proposal_list,
            commands::ai::ai_proposal_accept,
            commands::ai::ai_proposal_reject,
            commands::ai::ai_cost_estimate,
            commands::export::export_csv,
            commands::export::export_markdown,
            commands::export::export_refi,
            commands::export::export_stats,
            commands::export::export_codebook,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
