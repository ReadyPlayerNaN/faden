use crate::error::{AppError, AppResult};
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Default)]
pub struct AppState {
    current_project: Mutex<Option<PathBuf>>,
}

impl AppState {
    pub fn set_current(&self, path: PathBuf) {
        *self.current_project.lock().unwrap() = Some(path);
    }

    pub fn clear_current(&self) {
        *self.current_project.lock().unwrap() = None;
    }

    pub fn current_project(&self) -> AppResult<PathBuf> {
        self.current_project
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| AppError::Invalid("no project open".into()))
    }
}
