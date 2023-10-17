use mlua::{Lua, StdLib};

pub fn test() {
    let lua = Lua::new_with(
        StdLib::TABLE | StdLib::OS | StdLib::STRING | StdLib::BIT | StdLib::UTF8 | StdLib::MATH,
        mlua::LuaOptions::new().catch_rust_panics(false),
    )
    .expect("wtf");
    let _ = lua.sandbox(true).unwrap();
    let _ = lua.load("print('hello')").exec();

    // https://github.com/khvzak/mlua/issues/306
}
