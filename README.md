# English Talk

个人使用的 Android／iPhone 英语口语陪练。包含语音聊天、场景练习、学习记忆和 API 设置。App 在手机上保存数据，直接请求你选定的聊天 API。项目使用 Expo SDK 55 和 React Native。

## 装好后怎么用

1. 打开「API 设置 → 新增 API 配置」，填写服务商给你的 HTTPS 地址、模型 ID 和 API Key。可直接选择 DeepSeek 预设，也可用「自定义兼容接口」。首版使用 Bearer API Key 和 `POST /chat/completions` 协议。服务商提供的基础地址或完整 Chat Completions 地址都可填写。
2. 保存后点「测试连接」。请求只发送一句 `Reply with just OK.`。新增其他配置后，点「切换使用」，下一轮会使用新配置。首次在新地址聊天时选择是否发送近期对话和相关记忆。之后也可以在设置中更改。
3. 在「聊天」点一次「语音通话」，等到显示「正在听，请开口」就能说。说完停顿，系统完成识别后会自动发送。AI 朗读完会自动继续听，点「挂断」结束。通话中双方轮流说，退出到后台会自动挂断。
4. 在「记忆」手动添加学习目标，或保存聊天中出现的记忆建议。记忆开关控制跨会话记忆。记忆与聊天记录是各自保存的两份数据。想从空白对话开始，可在聊天页点右上角加号。

聊天页仍可打字，也可点麦克风单独录一轮，修改转写后再发送。在「场景」可以练习课堂展示、点餐或面试。

语音转写和朗读使用手机的系统语音服务，系统语音识别可能联网。App 不保留原始录音。iPhone 听不到朗读时，可先检查静音开关与媒体音量。Android 若没有可用的系统识别服务，可以先在系统设置启用语音识别服务，或使用文字输入。

## 本地准备

安装 Node.js 22 或 24 和 pnpm 11。打开项目目录执行：

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
```

本项目使用原生语音识别模块，需要构建独立 App。API Key 在手机上的设置页填写。

## Android 真机安装

若已有本项目生成的 APK，复制到手机后打开。按手机提示允许文件管理器安装应用即可。也可以通过已授权的 USB 调试连接执行 `adb install -r <APK路径>`。

在 Windows 构建 APK 时，建议把源码放在短路径（例如 `D:\ETalk`），避免 Ninja 遇到 260 字符的路径限制。准备 JDK 17 和 Android SDK，配置 `JAVA_HOME` 与 `ANDROID_HOME`。在 SDK Manager 安装 Android SDK Platform 36、Build Tools 35.0.0 和 36.0.0、Platform Tools、NDK `27.1.12297006` 和 CMake `3.22.1`。然后在 PowerShell 执行：

```powershell
pnpm exec expo prebuild --no-install --platform android
Set-Location android
$env:NODE_ENV = 'production'
.\gradlew.bat :app:assembleRelease '-PreactNativeArchitectures=arm64-v8a,armeabi-v7a'
```

APK 位于 `android/app/build/outputs/apk/release/app-release.apk`。Expo 生成的本地配置用调试证书签这个 Release 包，适合个人侧装，启动时无需连接开发电脑。

## iPhone 真机安装

有 Mac 时，可以使用免费 Apple 账号。需要支持 Expo SDK 55 的 Xcode（26.2 或更新版本）和 CocoaPods。在 Mac 上打开项目并执行：

```sh
pnpm install --frozen-lockfile
pnpm exec expo prebuild --no-install --platform ios
cd ios
pod install
open *.xcworkspace
```

在 Xcode 登录 Apple 账号，连接并信任 iPhone，在目标的 **Signing & Capabilities** 选择自己的 **Personal Team** 和 **Automatically manage signing**。如遇到 Bundle ID 冲突，可在 `app.json` 里换成自己独有的 `ios.bundleIdentifier`，再生成原生项目。选择你的 iPhone 作为运行设备，按手机提示开启开发者模式。要生成离开电脑也能启动的版本，可在 **Product → Scheme → Edit Scheme → Run** 把构建配置选为 **Release**，再点击 Run。免费账号的签名有效期为 7 天，到期需用 Xcode 重新签名安装。[Apple 个人签名说明](https://developer.apple.com/help/account/basics/about-your-developer-account) · [Expo 本地构建说明](https://docs.expo.dev/guides/local-app-development/)

只有 Windows 时，可用已开通 Apple Developer Program 的账号，在 Expo EAS 生成 Ad Hoc 安装包。需要先用自己的 Expo 账号初始化 EAS 项目、注册 iPhone，再构建：

```sh
pnpm dlx eas-cli login
pnpm dlx eas-cli init
pnpm dlx eas-cli device:create
pnpm dlx eas-cli build --platform ios --profile personal
```

用注册过的 iPhone 打开构建页提供的安装链接。此流程是内部安装，不需要提交 App Store。EAS 也可用同一配置构建 Android APK，命令改为 `pnpm dlx eas-cli build --platform android --profile personal`。[Expo 内部分发说明](https://docs.expo.dev/build/internal-distribution/)

## 真机验收

Android 和 iPhone 各执行一次：

- 授予系统麦克风及语音识别权限，点一次「语音通话」，连续完成至少三轮英语对话。每轮说完停顿，确认自动发送、AI 回复并自动恢复聆听。分别在聆听、等待回复和朗读时测试挂断，确认挂断后麦克风不再重开。
- 用麦克风按钮手动录一轮，验证可以编辑转写并发送。确认回复能重播，纠错卡没有被朗读。
- 保存两套可用 API 配置并各测试一次。切换后发下一轮，查看聊天页模型，并确认之前的消息和记忆还在。若首次选择「仅本轮」，该配置只发送新输入。
- 新增一个独特的学习目标，退出并重开 App。允许当前 API 发送上下文，开始新会话后问 AI 你的练习目标。随后删除目标，再开始新会话复测。
- 断开网络或临时选用无效配置，确认报错后输入仍可编辑与重试。
