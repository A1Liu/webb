use super::{RunResult, RunStatus, Runnable, RunnerOutput};
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
    fn start(self: std::sync::Arc<Self>, ctx: super::RunCtx) -> RunResult {
        let sel_ref = self.clone();
        let sender = ctx.output_sender.clone();

        tokio::spawn(async move {
            let sel = sel_ref;
            let status = sel.status.clone();
            let libs = StdLib::TABLE
                | StdLib::OS
                | StdLib::STRING
                | StdLib::BIT
                | StdLib::UTF8
                | StdLib::MATH;
            let options = mlua::LuaOptions::new().catch_rust_panics(false);

            let lua = Lua::new_with(libs, options).expect("wtf");

            let print = lua
                .create_function(move |_, value: String| {
                    let sender = sender.clone();
                    tokio::spawn(async move {
                        sender.send(RunnerOutput::Stderr(value.into_bytes())).await
                    });

                    return Ok(());
                })
                .unwrap();

            // https://github.com/khvzak/mlua/issues/306
            lua.globals().set("print", print).unwrap();

            let _ = lua.sandbox(true).unwrap();

            let _ = lua.load(&sel.source).exec();

            status.success();
        });

        return RunResult::Text("Hello".to_string());
    }

    fn is_done(&self) -> bool {
        self.status.is_done()
    }

    fn is_successful(&self) -> Option<bool> {
        self.status.is_successful()
    }
}
