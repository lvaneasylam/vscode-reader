plugins {
    id("java")
    kotlin("jvm") version "2.0.21"
    id("org.jetbrains.intellij.platform") version "2.2.1"
}

group = "com.chiang"
version = "0.2.8"

repositories {
    mavenCentral()
    intellijPlatform { defaultRepositories() }
}

dependencies {
    intellijPlatform {
        create("IC", "2023.3")
    }
}

// sidecar 单文件 bundle 作为资源打进插件 jar
sourceSets {
    main {
        resources.srcDir(layout.projectDirectory.dir("jetbrains-resources"))
    }
}

kotlin {
    jvmToolchain(21)
    compilerOptions {
        // sinceBuild 233 的 JBR 是 17：字节码目标保持 17（编译用本机 JDK 21）
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

tasks.withType<JavaCompile> {
    options.release.set(17)
}

intellijPlatform {
    pluginConfiguration {
        id = "com.chiang.novelreader"
        name = "墨遥·阅山行"
        version = project.version.toString()
        ideaVersion {
            sinceBuild = "233"
            untilBuild = provider { null }
        }
    }
}
