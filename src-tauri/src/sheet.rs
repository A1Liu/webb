use crate::commands::Command;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Clone, Copy, PartialOrd, Hash, PartialEq, Serialize, Deserialize)]
#[repr(transparent)]
pub struct CellId(Uuid);

pub struct Sheet {
    relations: BTreeMap<(CellId, CellId), ()>,
    layout: Vec<CellId>,
    running_commands: HashMap<CellId, Arc<Mutex<Command>>>,
}
