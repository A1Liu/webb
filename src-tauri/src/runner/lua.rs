use super::{RunStatus, Runnable};
use mlua::{Lua, StdLib};

#[derive(Debug)]
pub struct LuaCommand {
    source: String,
    status: RunStatus,
}

impl LuaCommand {
    pub fn new(source: String) -> Self {
        return Self {
            source,
            status: RunStatus::new(),
        };
    }
}

impl Runnable for LuaCommand {
    fn start(self: std::sync::Arc<Self>, ctx: super::RunCtx) {
        let sel_ref = self.clone();
        tokio::spawn(async move {
            let libs = StdLib::TABLE
                | StdLib::OS
                | StdLib::STRING
                | StdLib::BIT
                | StdLib::UTF8
                | StdLib::MATH;
            let options = mlua::LuaOptions::new().catch_rust_panics(false);

            let lua = Lua::new_with(libs, options).expect("wtf");

            let _ = lua.sandbox(true).unwrap();
            let _ = lua.load(&sel_ref.source).exec();

            // https://github.com/khvzak/mlua/issues/306
        });

        todo!()
    }

    fn is_done(&self) -> bool {
        self.status.is_done()
    }

    fn is_successful(&self) -> Option<bool> {
        self.status.is_successful()
    }
}
