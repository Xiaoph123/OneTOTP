// 仓库源按环境区分：
//   - GitHub Actions（CI=true）：只用官方源（google/mavenCentral），海外访问稳定
//   - 本地开发（国内网络）：官方源 + 阿里云镜像兜底，加速依赖下载
// 阿里云镜像放在 CI 会导致 maven 仓库超时（海外访问不稳定），故不进入 CI。

buildscript {
    repositories {
        google()
        mavenCentral()
        if (System.getenv("CI") != "true") {
            maven { url = uri("https://maven.aliyun.com/repository/gradle-plugin") }
        }
    }
    dependencies {
        classpath("com.android.tools.build:gradle:9.3.1")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.2.10")
    }
}

allprojects {
    repositories {
        google()
        mavenCentral()
        if (System.getenv("CI") != "true") {
            maven { url = uri("https://maven.aliyun.com/repository/google") }
            maven { url = uri("https://maven.aliyun.com/repository/public") }
        }
    }
}

// ── 统一插件库工程的 compileSdk ──
// tauri-plugin-* 自带的 Android 库工程以其内置的较低 compileSdk 编译（如 biometry 为 34），
// 而 :tauri-android 要求依赖方 compileSdk >= 36，否则 :tauri-plugin-*:checkReleaseAarMetadata
// 会因 AAR 元数据校验失败中断整个构建。这里把插件库工程的 compileSdk 对齐到应用一致的值。
subprojects {
    afterEvaluate {
        if (!plugins.hasPlugin("com.android.library")) return@afterEvaluate
        val androidExt = extensions.findByName("android") as? groovy.lang.GroovyObject
        androidExt?.setProperty("compileSdk", 37)
    }
}

tasks.register("clean").configure {
    delete("build")
}
