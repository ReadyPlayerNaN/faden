use crate::commands::util::project_conn;
use crate::db::queries::person::{self, Person};
use crate::error::AppResult;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersonDTO {
    pub id: i64,
    pub name: String,
    pub linked_speaker_count: i64,
}

impl From<Person> for PersonDTO {
    fn from(value: Person) -> Self {
        Self {
            id: value.id,
            name: value.name,
            linked_speaker_count: value.linked_speaker_count,
        }
    }
}

#[tauri::command]
pub async fn person_list(app: tauri::AppHandle) -> AppResult<Vec<PersonDTO>> {
    let conn = project_conn(&app)?;
    Ok(person::list(&conn)?.into_iter().map(Into::into).collect())
}

#[tauri::command]
pub async fn person_create(app: tauri::AppHandle, name: String) -> AppResult<PersonDTO> {
    let conn = project_conn(&app)?;
    Ok(person::create(&conn, &name)?.into())
}

#[tauri::command]
pub async fn person_rename(
    app: tauri::AppHandle,
    person_id: i64,
    name: String,
) -> AppResult<()> {
    let conn = project_conn(&app)?;
    person::rename(&conn, person_id, &name)
}

#[tauri::command]
pub async fn person_delete(app: tauri::AppHandle, person_id: i64) -> AppResult<()> {
    let mut conn = project_conn(&app)?;
    person::delete(&mut conn, person_id)
}
