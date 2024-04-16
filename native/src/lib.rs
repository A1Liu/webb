use tauri::App;

#[cfg(mobile)]
mod mobile;
#[cfg(mobile)]
pub use mobile::*;

mod networking;

pub type SetupHook = Box<dyn FnOnce(&mut App) -> Result<(), Box<dyn std::error::Error>> + Send>;

#[derive(Default)]
pub struct AppBuilder {
    setup: Option<SetupHook>,
    pub builder: tauri::Builder<tauri::Wry>,
}

// Download links using:
// https://stackoverflow.com/questions/77394050/how-can-i-download-the-contents-from-a-url-through-my-tauri-app-on-mac

impl AppBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    #[must_use]
    pub fn setup<F>(mut self, setup: F) -> Self
    where
        F: FnOnce(&mut App) -> Result<(), Box<dyn std::error::Error>> + Send + 'static,
    {
        self.setup.replace(Box::new(setup));
        self
    }

    pub fn run(self) {
        let setup = self.setup;
        self.builder
            .setup(move |app| {
                if let Some(setup) = setup {
                    (setup)(app)?;
                }

                // let main_window = app.get_webview_window("main").unwrap();

                Ok(())
            })
            .run(tauri::generate_context!())
            .expect("error while running tauri application");
    }
}
