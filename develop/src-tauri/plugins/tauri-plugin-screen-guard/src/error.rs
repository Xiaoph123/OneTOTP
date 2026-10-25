use serde::{ser::Serializer, Serialize};

pub type Result<T> = std::result::Result<T, Error>;

/// 插件错误类型。
///
/// 为什么需要自定义而不是直接用 `tauri::Result`：
/// `run_mobile_plugin` 返回的是 `tauri::plugin::mobile::PluginInvokeError`，
/// 而 `tauri::Error` **没有**实现 `From<PluginInvokeError>`（它只覆盖
/// anyhow / io / serde_json 等少数类型）。直接 `?` 或 `.map_err(Into::into)`
/// 都会编译失败，必须自己包一层。
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    PluginInvoke(#[from] tauri::plugin::mobile::PluginInvokeError),
}

impl Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}
