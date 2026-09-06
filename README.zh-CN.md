![哪里跑——深入探索，高效完成，随处构建。](.github/assets/runwhale-banner.png)

[English](README.md) | 简体中文

哪里跑是一款将完整开发循环带到手机上的编程智能体。项目文件、工具、会话、Git、Metro 和预览功能都保留在设备本地；只有模型推理会使用你配置的远程服务商。

## 下载

[前往 App Store 下载哪里跑](https://apps.apple.com/app/id6807644595)，一次性购买价 10 美元。

## 演示

https://github.com/user-attachments/assets/b8b7d184-8d6b-4fc0-b954-c159c02aa1b4

## 随处构建

- 创建新项目或导入现有代码仓库。
- 让智能体检查、编辑、测试和修复代码。
- 编辑文件、运行受限的 Node.js 和 TypeScript 任务，并安装受支持的纯 JavaScript 依赖。
- 审查 Git 变更，在持久化会话中继续工作。
- 在 Web、iOS 和 Android 上预览同一个 Expo 项目。
- 让智能体读取预览日志和节点、操作受支持的控件，并使用支持视觉的模型检查截图。

用户项目绝不会触发 Xcode、Gradle、EAS、IPA 或 APK 构建。哪里跑会直接在手机本地打包和预览这些项目。

## 运行位置

| 手机本地 | 远程服务 |
| --- | --- |
| 项目、智能体会话、Node.js、TypeScript、任务、Git、Metro 和预览 | 通过所选服务商进行的模型推理 |
| Android Keystore 或 iOS Keychain 中的凭据 | 仅在明确发起网络 Git 操作时连接 Git 托管服务 |

凭据只会通过受信任的内存通道传递，绝不会写入项目、环境变量、Git 配置、会话、日志或预览包。本地运行时 RPC 受令牌保护，并且只绑定到 localhost。

访问私有 Git 远程仓库时，会使用设备生成的 Ed25519 密钥；私钥始终保存在安全存储中，绝不会离开设备。

iOS 切入后台后，智能体会在系统允许的有限时间内继续运行，随后保存会话并暂停。返回应用后会自动续接当前进程中因后台暂停的任务；应用重启后，可在暂停的会话中点击“继续”。手动停止的任务不会自动恢复。

## 项目范围

哪里跑面向使用 Expo SDK 57 的 Web 和 React Native 项目。Studio 用于管理项目、文件、智能体会话和设置；独立的 Native Preview 容器则负责运行用户项目的打包产物。

MVP 目前有意不提供以下功能：

- 通用 Linux 环境、Shell 或 PTY。
- 原生 npm 扩展、任意原生二进制文件、动态 Expo 配置插件或项目专属的原生 SDK。
- iOS 无限制后台运行或后台 Metro。
- 云端运行器、市场、支付或排行榜。

## 参与贡献

贡献指南请参阅 [CONTRIBUTING.md](CONTRIBUTING.md)，构建和开发流程请参阅 [DEVELOPMENT.md](DEVELOPMENT.md)。

## 许可证与商标

哪里跑的原创软件代码基于 [Apache License 2.0](LICENSE) 授权。第三方代码和资源仍受各自原始许可证约束，详情请参阅 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。Apache License 不适用于第三方商标，也不适用于被标明采用独立许可或保留权利的哪里跑品牌资源。

本项目的许可不包含将 `RunWhale` 名称用作商号、商标、服务标志或产品名称的权利。允许的描述性用法和保留的品牌权利请参阅 [TRADEMARKS.md](TRADEMARKS.md)。
