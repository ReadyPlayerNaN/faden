pub mod app_state;
pub mod commands;
pub mod db;
pub mod domain;
pub mod error;
pub mod settings;
pub mod transcription;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,stt=debug".into()),
        )
        .init();

    tauri::Builder::default()
        .manage(app_state::AppState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::project::project_create,
            commands::project::project_open,
            commands::settings::settings_get,
            commands::settings::settings_set,
            commands::settings::settings_add_recent,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
