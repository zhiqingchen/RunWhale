![RunWhale — Build from anywhere.](.github/assets/runwhale-banner.png)

[English](README.md) | 简体中文

RunWhale（哪里跑）是一款手机端 AI 编程智能体，支持使用本地工具和 Git 创建、编辑并预览 Web 与 React Native 项目。

**社区版：** 免费开源，无需 RunWhale 账号或订阅。AI 功能需要自行配置受支持的服务商凭据并联网使用，服务商可能收取费用。

## 演示

https://github.com/user-attachments/assets/b8b7d184-8d6b-4fc0-b954-c159c02aa1b4

## 主要功能

- 创建项目、导入 Git 仓库并查看代码变更。
- 让智能体编写、测试和修复代码，并通过保存的会话继续工作。
- 运行受限的 Node.js 和 TypeScript 任务，安装受支持的纯 JavaScript 依赖。
- 在 Web、iOS 和 Android 上预览项目。智能体可查看日志、操作受支持的控件，并通过支持视觉的模型检查截图。

## 开始使用

配置 AI 服务商，创建或导入项目，再让智能体编写代码并打开预览。

通过 **工作区 → 项目更多操作 → 添加到主屏幕**，可以直接打开项目最近一次成功的预览。请保留 RunWhale 应用和项目。

## 支持范围

项目文件、会话、工具、Git 和预览在设备本地运行。AI 请求、远程 Git 操作、未缓存的依赖下载，以及项目使用的在线服务需要联网。

支持 Expo SDK 57 项目。不提供通用 Linux Shell/PTY、原生 npm 扩展、自定义原生 SDK、动态 Expo 配置插件或 iOS 无限制后台运行。用户项目在本地预览，不会构建为 IPA/APK 文件。

## 开发与贡献

[构建与开发指南](DEVELOPMENT.md) · [贡献指南](CONTRIBUTING.md)

## 许可证与商标

原创代码基于 [Apache License 2.0](LICENSE) 授权。第三方代码和资源仍遵循各自原始许可证，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。代码许可证不涵盖商标，也不涵盖单独授权或保留权利的 RunWhale 品牌资源，详见 [TRADEMARKS.md](TRADEMARKS.md)。
