const COMMANDS: &[&str] = &["set_secure"];

fn main() {
    let result = tauri_plugin::Builder::new(COMMANDS)
        .ios_path("ios")
        .try_build();

    // 与其它插件一致：文档构建环境下不校验移动端工程
    if std::env::var_os("DOCS_RS").is_none() {
        result.unwrap();
    }
}
