use super::*;
use mlua::{Lua, StdLib};
use std::io::Write;
use std::sync::{Arc, Mutex};

#[derive(Debug)]
pub struct LuaCommand {
    source: String,
}

impl LuaCommand {
    pub fn new(source: String) -> Self {
        return Self { source };
    }
}

impl Runnable for LuaCommand {
    fn start(self: Arc<Self>, ctx: Arc<RunCtx>) -> RunnableResult {
        let sel_ref = self.clone();

        let stdout = RunPipe::new();
        let output = stdout.runnable_result();

        tokio::task::spawn(async move {
            let sel = sel_ref;
            let libs = StdLib::TABLE
                | StdLib::OS
                | StdLib::STRING
                | StdLib::BIT
                | StdLib::UTF8
                | StdLib::MATH;
            let options = mlua::LuaOptions::new().catch_rust_panics(false);

            let file = stdout.out_file().await.into_std().await;
            let file = Mutex::new(file);

            let _ = tokio::task::block_in_place(move || {
                let lua = Lua::new_with(libs, options).expect("wtf");
                let print = lua
                    .create_function(move |_, value: String| {
                        let mut file = file.lock().expect("");
                        file.write_all(&value.into_bytes())?;

                        return Ok(());
                    })
                    .unwrap();

                // https://github.com/khvzak/mlua/issues/306
                lua.globals().set("print", print).unwrap();

                let _ = lua.sandbox(true).unwrap();
                let _ = lua.load(&sel.source).exec();
            });

            ctx.set_status(RunStatus::Success);
        });

        return output;
    }
}
