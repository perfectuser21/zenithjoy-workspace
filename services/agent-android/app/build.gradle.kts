plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "com.zenithjoy.agent"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.zenithjoy.agent"
        minSdk = 26
        targetSdk = 34
        versionCode = 46
        versionName = "2.1.42"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildFeatures {
        buildConfig = true
    }

    val keystorePath = System.getenv("ANDROID_KEYSTORE_PATH")
    if (keystorePath != null) {
        signingConfigs {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD") ?: ""
                keyAlias = System.getenv("ANDROID_KEY_ALIAS") ?: ""
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD") ?: ""
            }
        }
    }

    buildTypes {
        create("e2e") {
            initWith(getByName("debug"))
            applicationIdSuffix = ".e2e"
            versionNameSuffix = "-e2e"
            isDebuggable = true
        }
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfigs.findByName("release")?.let { signingConfig = it }
        }
    }

    // 真机复现 2026-08-15：e2e buildType 的 initWith(getByName("debug")) 只复制构建*配置*
    // （签名/可调试标志等），不会带上 src/debug 源码目录——AGP 按 buildType 名字找源码目录，
    // "e2e" 默认只认 src/e2e/，从不看 src/debug/。结果是 DebugE2ETriggerReceiver.kt（写在
    // src/debug/kotlin，唯一能在真机上不经服务端直接触发 collect/dm/scan 任务的 adb 广播入口）
    // 从未被编进任何一次实际安装到真机的 e2e 包——aapt2 dump xmltree 反查已装包的 manifest
    // 实锤验证：receiver 列表里压根没有它。两台不同品牌真机（realme/ColorOS、荣耀/MagicOS）
    // 分别复现过"广播已enqueue但App进程从未处理"的假阳性，一度被误判为两种不同的厂商后台
    // 限制问题，根因其实是这一个源码集配置缺口。显式把 src/debug 纳入 e2e 变体的编译单元。
    sourceSets {
        getByName("e2e") {
            kotlin.srcDir("src/debug/kotlin")
            manifest.srcFile("src/debug/AndroidManifest.xml")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }

    kotlinOptions {
        jvmTarget = "1.8"
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.okhttp)
    implementation(libs.gson)
    implementation(libs.kotlinx.coroutines.android)

    testImplementation(libs.junit)
    testImplementation(libs.mockwebserver)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation("org.json:json:20240303")
    androidTestImplementation(libs.androidx.test.junit)
    androidTestImplementation(libs.espresso.core)
}
