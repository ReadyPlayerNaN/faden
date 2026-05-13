use crate::error::{AppError, AppResult};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tokio_util::sync::CancellationToken;

#[derive(Default)]
pub struct AppState {
    current_project: Mutex<Option<PathBuf>>,
    active_runs: Mutex<HashMap<i64, CancellationToken>>,
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

    pub fn register_run_for_interview(&self, interview_id: i64, token: CancellationToken) {
        self.active_runs
            .lock()
            .unwrap()
            .insert(interview_id, token);
    }

    pub fn cancel_run_for_interview(&self, interview_id: i64) -> AppResult<()> {
        let mut guard = self.active_runs.lock().unwrap();
        let token = guard
            .remove(&interview_id)
            .ok_or_else(|| AppError::NotFound(format!("active run for interview {interview_id}")))?;
        token.cancel();
        Ok(())
    }

    pub fn deregister_run_for_interview(&self, interview_id: i64) {
        self.active_runs.lock().unwrap().remove(&interview_id);
    }
}
