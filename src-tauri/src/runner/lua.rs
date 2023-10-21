use super::{Runnable, RunnableIO};
use mlua::{Lua, StdLib};

#[derive(Debug)]
pub struct LuaCommand {}

impl LuaCommand {
    pub fn new(source: String) -> (Self, RunnableIO) {
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
            let _ = lua.load(source).exec();

            // https://github.com/khvzak/mlua/issues/306
        });

        let sel = Self {};
        let io = RunnableIO::default();

        return (sel, io);
    }
}

impl Runnable for LuaCommand {
    fn is_done(&self) -> bool {
        todo!()
    }

    fn kill(&self) {
        todo!()
    }

    fn is_successful(&self) -> Option<bool> {
        todo!()
    }
}
