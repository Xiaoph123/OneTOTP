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

tasks.register("clean").configure {
    delete("build")
}
