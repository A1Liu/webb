use crate::commands::Command;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::num::NonZeroU32;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Clone, Copy, PartialOrd, Hash, PartialEq, Eq)]
#[repr(transparent)]
pub struct CellId(u32);

struct CellIdVisitor;

impl<'de> serde::de::Visitor<'de> for CellIdVisitor {
    type Value = CellId;

    fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
        formatter.write_str("an ID in hex")
    }

    fn visit_borrowed_str<E: serde::de::Error>(self, v: &str) -> Result<Self::Value, E> {
        return self.visit_str(v);
    }
    fn visit_string<E: serde::de::Error>(self, v: String) -> Result<Self::Value, E> {
        return self.visit_str(&v);
    }
    fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<Self::Value, E> {
        match u32::from_str_radix(v, 16) {
            Ok(v) => return Ok(CellId(v)),
            Err(e) => return Err(E::invalid_value(serde::de::Unexpected::Str(v), &self)),
        }
    }
}

impl<'de> Deserialize<'de> for CellId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        deserializer.deserialize_string(CellIdVisitor)
    }
}

impl Serialize for CellId {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&format!("{:08x}", self.0))
    }
}

pub struct Sheet {
    id_seed: u32,

    // Always having at least 1 column makes things a little easier to think about,
    // since cell_layout uses row-major order.
    columns: NonZeroU32,
    cell_layout: Vec<CellId>,

    cells: HashMap<CellId, Cell>,
}

pub struct Cell {
    pub id: CellId,
    pub invocation: Option<Arc<Mutex<Command>>>,
}

impl Sheet {
    pub fn new() -> Self {
        return Self {
            id_seed: 0,
            cell_layout: Vec::new(),
            columns: NonZeroU32::MIN,
            cells: HashMap::new(),
        };
    }

    pub fn cell_at(&self, row: u32, col: u32) -> Option<CellId> {
        if col >= self.columns.get() {
            return None;
        }

        let index = row * self.columns.get() + col;
        let cell_slot = self.cell_layout.get(index as usize)?;

        return Some(*cell_slot);
    }

    pub fn rows(&self) -> u32 {
        let rows = self.cell_layout.len() / self.columns.get() as usize;
        return rows as u32;
    }

    pub fn columns(&self) -> u32 {
        return self.columns.get();
    }

    pub fn get_cell(&self, id: CellId) -> Option<&Cell> {
        return self.cells.get(&id);
    }

    /// Resizes the sheet, potentially deleting or adding cells.
    pub fn resize(&mut self, rows: u32, columns: u32) {
        let columns = NonZeroU32::new(columns).unwrap_or(NonZeroU32::MIN);
        let new_size = columns.get() as usize * rows as usize;

        let mut new_layout = Vec::with_capacity(new_size);

        let mut index = 0;
        let source_rows = self.rows();

        for _row in 0..source_rows {
            for _column in 0..self.columns.get() {
                new_layout.push(self.cell_layout[index]);
                index += 1;
            }

            // NOTE: we're taking advantage of the fact that something like
            // 100..0 is a valid range but doesn't result in any loop iterations
            for _new_col in self.columns.get()..columns.get() {
                new_layout.push(self.create_cell());
            }
        }

        // NOTE: we're taking advantage of the fact that something like
        // 100..0 is a valid range but doesn't result in any loop iterations
        for _row in source_rows..rows {
            for _new_col in 0..columns.get() {
                new_layout.push(self.create_cell());
            }
        }

        self.columns = columns;
        self.cell_layout = new_layout;
    }

    fn create_cell(&mut self) -> CellId {
        let id = CellId(self.id_seed);
        self.id_seed += 1;

        self.cells.insert(
            id,
            Cell {
                id,
                invocation: None,
            },
        );

        return id;
    }
}
