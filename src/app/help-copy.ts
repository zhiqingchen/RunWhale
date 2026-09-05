import { siteUrl, sitePath } from "@/app/site-config";
import type { Metadata } from "next";
import { homeCopy, type WebsiteLocale } from "./home-copy";
import { indexableRobots } from "./seo-metadata";

export type HelpPageKind = "guide" | "faq";

export interface GuideCard {
  title: string;
  body: string;
}

export interface GuideStep {
  action: string;
  title: string;
  body: readonly string[];
}

export interface GuideScreenshot {
  id: string;
  title: string;
  alt: string;
  avifSrcSet: string;
  webpSrcSet: string;
  fallbackSrc: string;
  width: number;
  height: number;
}

export interface FaqItem {
  id: string;
  question: string;
  answer: readonly string[];
}

export interface FaqGroup {
  title: string;
  items: readonly FaqItem[];
}

interface HelpLocaleCopy {
  updatedLabel: string;
  updatedIso: string;
  guide: {
    metadataTitle: string;
    metadataDescription: string;
    eyebrow: string;
    title: string;
    summary: string;
    startTitle: string;
    startBody: string;
    prerequisites: readonly GuideCard[];
    workflowLabel: string;
    workflowTitle: string;
    workflowBody: string;
    steps: readonly GuideStep[];
    galleryLabel: string;
    galleryTitle: string;
    galleryBody: string;
    screenshots: readonly GuideScreenshot[];
    videoLabel: string;
    videoTitle: string;
    videoBody: string;
    videoAria: string;
    videoFallback: string;
    videoCaption: string;
    videoSrc: string;
    videoPoster: string;
    disclosure: string;
    nextTitle: string;
    nextLinks: {
      faq: GuideCard;
      support: GuideCard;
      privacy: GuideCard;
      github: GuideCard;
    };
  };
  faq: {
    metadataTitle: string;
    metadataDescription: string;
    eyebrow: string;
    title: string;
    summary: string;
    intro: string;
    groups: readonly FaqGroup[];
    moreTitle: string;
    moreBody: string;
    guideLabel: string;
    supportLabel: string;
  };
}

export type HelpCopy = Record<WebsiteLocale, HelpLocaleCopy>;

const optimizedMediaRoot = sitePath("/media/optimized/v1");

function createGuideScreenshots(locale: WebsiteLocale): GuideScreenshot[] {
  return homeCopy[locale].screenshots.map((screenshot) => ({
    id: screenshot.slug,
    title: screenshot.title,
    alt: screenshot.alt,
    avifSrcSet: `${optimizedMediaRoot}/${screenshot.slug}-360.avif 360w, ${optimizedMediaRoot}/${screenshot.slug}-720.avif 720w`,
    webpSrcSet: `${optimizedMediaRoot}/${screenshot.slug}-360.webp 360w, ${optimizedMediaRoot}/${screenshot.slug}-720.webp 720w`,
    fallbackSrc: `${optimizedMediaRoot}/${screenshot.slug}-720.webp`,
    width: 720,
    height: 1566,
  }));
}

export const helpCopy = {
  en: {
    updatedLabel: "September 4, 2026",
    updatedIso: "2026-09-04",
    guide: {
      metadataTitle: "RunWhale Guide — From Setup to Preview",
      metadataDescription:
        "Learn how to configure a model, create or import a project, work with the RunWhale Agent, and test the result in Web or Native Preview.",
      eyebrow: "Guide",
      title: "Get started with RunWhale",
      summary:
        "Configure your model, open a real project, ask the Agent to make a change, and test the result on your phone.",
      startTitle: "Before your first prompt",
      startBody:
        "RunWhale keeps the development workspace on your phone, while model inference uses the provider you configure. These three checks make the first run smoother.",
      prerequisites: [
        {
          title: "Bring a model API key",
          body: "Use a key from your chosen model provider. Save it only through RunWhale Settings—never in a project or prompt.",
        },
        {
          title: "Stay online for Agent work",
          body: "Model inference needs the network. Git network operations and uncached dependency downloads may need it too.",
        },
        {
          title: "Start with a compatible project",
          body: "Choose a built-in Web or Expo starter, or import a compatible repository with a valid RunWhale Preview entry.",
        },
      ],
      workflowLabel: "Core workflow",
      workflowTitle: "From setup to a tested result",
      workflowBody:
        "After model setup, follow the Baby game example: create an Expo project, ask for a game, approve the edit, and try Animal Parade in Native Preview.",
      steps: [
        {
          action: "Settings → Models · Save securely",
          title: "Configure a provider and model",
          body: [
            "Open Settings → Models, choose the provider and model you want to use, paste that provider's API key, and tap Save securely.",
            "The key stays in the device's secure storage. Agent inference uses the selected provider, so the device must be online when you send a prompt.",
          ],
        },
        {
          action: "New project · Web / Expo",
          title: "Create a project or import a repository",
          body: [
            "Tap New project, give it a name, and choose Web for a React website with Web Preview or Expo for an app with Native Preview.",
            "For this demo, enter Baby game, select Expo, leave the optional repository field empty, and tap Create and open Agent.",
            "To continue an existing codebase, enter a compatible Git repository instead. The imported project's runwhale.json determines its Preview target.",
          ],
        },
        {
          action: "Agent",
          title: "Describe one clear result",
          body: [
            "Tell the Agent what you want to build or change. Include the intended behavior and ask it to run the supported checks that matter to the task.",
            "The entire request in this demo is ‘Make a game for baby.’ The Agent plans a game with large touch targets, gentle feedback, and six animal cards.",
          ],
        },
        {
          action: "Review · Allow once · Activity",
          title: "Follow the work and review the result",
          body: [
            "In Review mode, RunWhale asks before the Agent writes index.tsx. Tap Allow once to approve this edit, then follow the file-write and check activity in the same session.",
            "The Agent runs TypeScript diagnostics and a Git diff. Its summary reports unresolved dependencies in the fresh workspace, then it moves to Native Preview to check the app by running it.",
          ],
        },
        {
          action: "Run / Reload · Preview",
          title: "Run the same project in Preview",
          body: [
            "In the recording, the Agent launches Native Preview directly. You can also tap the refresh icon (Run / Reload) after a turn finishes. Web projects use Web Preview; compatible Expo projects use Native Preview.",
            "Interact with the result instead of checking only the first screen. If Preview reports a diagnostic, return to the project and use that exact message for the next fix.",
          ],
        },
        {
          action: "Native Preview · Animal Parade",
          title: "Tap the animals and check the response",
          body: [
            "Animal Parade opens with ‘Can you find the Dog?’ above six cards: Dog, Cat, Cow, Chick, Frog, and Lion. Tap the cards and watch the prompt and feedback change.",
            "The demo shows ‘Yay!’, ‘Great job!’, and ‘You found it!’ responses before another animal prompt appears. For your next change, return to the same saved Agent session.",
          ],
        },
      ],
      galleryLabel: homeCopy.en.demo.galleryLabel,
      galleryTitle: homeCopy.en.demo.galleryTitle,
      galleryBody: homeCopy.en.demo.galleryBody,
      screenshots: createGuideScreenshots("en"),
      videoLabel: "Full walkthrough",
      videoTitle: "Watch the workflow from prompt to Preview",
      videoBody:
        "In about 2 minutes 12 seconds, this silent recording follows Baby game from project creation and one short prompt through file-write approval, checks, and interaction with Animal Parade in Native Preview.",
      videoAria: homeCopy.en.demo.videoAria,
      videoFallback: "Your browser does not support the video tag.",
      videoCaption: homeCopy.en.demo.videoCaption,
      videoSrc: sitePath("/media/demo/RunWhale-demo-readme.mp4"),
      videoPoster: `${optimizedMediaRoot}/runwhale-animal-parade-poster-720.webp`,
      disclosure: homeCopy.en.demo.disclosure,
      nextTitle: "Keep learning",
      nextLinks: {
        faq: {
          title: "Read common answers",
          body: "Understand connectivity, data handling, project limits, Git, and common failures.",
        },
        support: {
          title: "Contact support",
          body: "Send a private request or report a reproducible, non-sensitive issue on GitHub.",
        },
        privacy: {
          title: "Review data handling",
          body: "See what stays on your device and what is sent to services you choose.",
        },
        github: {
          title: "Explore the source",
          body: "Read the public RunWhale repository, project scope, and contribution guidance.",
        },
      },
    },
    faq: {
      metadataTitle: "RunWhale FAQ — Setup, Projects, Agent & Preview",
      metadataDescription:
        "Answers about RunWhale setup, local and remote processing, compatible projects, Git, dependencies, Preview, and troubleshooting.",
      eyebrow: "FAQ",
      title: "RunWhale questions, answered",
      summary:
        "Clear answers about getting started, what runs on your phone, project boundaries, and the fastest checks when something fails.",
      intro:
        "Choose a question below. The answers describe the current product boundaries without assuming a particular provider, device release, or distribution channel.",
      groups: [
        {
          title: "Getting started",
          items: [
            {
              id: "first-agent-run",
              question: "What do I need before the first Agent run?",
              answer: [
                "Choose a provider and model in Settings → Models, save a valid API key from that provider, and keep the device online. Then create a Web or Expo project, or import a compatible repository.",
              ],
            },
            {
              id: "web-or-expo",
              question: "Should I choose a Web or Expo project?",
              answer: [
                "Choose Web for a React website that runs in Web Preview. Choose Expo for a React Native project that runs in Native Preview inside RunWhale's fixed native shell. Both templates support the same project-and-Agent workflow.",
              ],
            },
            {
              id: "import-repository",
              question: "Can I import an existing repository?",
              answer: [
                "Yes, when the repository is compatible with RunWhale's Web or Expo runtime. Imported projects use runwhale.json to declare their entry points and Preview target. Repositories that require unsupported native code, binaries, or build steps will not fit the current runtime.",
              ],
            },
          ],
        },
        {
          title: "Local runtime and data",
          items: [
            {
              id: "local-or-offline",
              question: "Does everything run locally, and is RunWhale offline?",
              answer: [
                "Project files, Agent orchestration, sessions, Node.js and TypeScript tooling, supported tasks, Git, Metro, and Preview run on the phone. Model inference uses your configured remote provider. Explicit Git network operations and uncached dependency downloads also use the network, so RunWhale is not an offline product.",
              ],
            },
            {
              id: "model-context",
              question: "What project data can reach the model provider?",
              answer: [
                "When you run the Agent, RunWhale sends your prompt and the project or session context needed to answer it to the provider you selected. Depending on the request, that context can include source code, file contents, images, tool results, and conversation history.",
              ],
            },
            {
              id: "credential-storage",
              question: "Where are API and Git credentials stored?",
              answer: [
                "Model API keys and the device Git private key stay in iOS Keychain or Android Keystore. They are not written to project files, environment variables, Git configuration, Agent sessions, logs, or Preview bundles.",
              ],
            },
          ],
        },
        {
          title: "Compatibility and limits",
          items: [
            {
              id: "private-git",
              question: "Can RunWhale use a private Git repository?",
              answer: [
                "Yes, for GitHub repositories over SSH. In Settings → Git SSH key, generate or copy the device public key, add that public key to GitHub, and use the repository's GitHub SSH URL. The private key remains in the device's secure storage; access still depends on the network and the repository permissions granted on GitHub.",
              ],
            },
            {
              id: "npm-packages",
              question: "Can a project install any npm package?",
              answer: [
                "No. RunWhale supports compatible pure-JavaScript packages from the npm registry. Lifecycle scripts and binary links are disabled; Git or path dependencies, native addons or binaries, dynamic Expo config plugins, and project-specific native SDKs are not supported. Depending on your permission mode, RunWhale may ask you to approve an install.",
              ],
            },
            {
              id: "standalone-builds",
              question: "Does RunWhale build standalone iOS or Android apps?",
              answer: [
                "No. User projects run as Web or React Native Preview targets inside RunWhale. They do not trigger Xcode, Gradle, EAS, IPA, or APK builds.",
              ],
            },
            {
              id: "background-work",
              question: "Does Agent or Metro work continue in the background?",
              answer: [
                "Do not depend on continuous background execution. In particular, the current product does not keep Agent or Metro running continuously while iOS is backgrounded. Keep RunWhale in the foreground for an active development turn or Preview build.",
              ],
            },
          ],
        },
        {
          title: "Troubleshooting",
          items: [
            {
              id: "agent-wont-start",
              question: "Why won't the Agent start?",
              answer: [
                "Confirm that the selected provider has a valid saved API key and that the device is online. If RunWhale reports a local Runtime failure, restart the Runtime and try again before changing the project.",
              ],
            },
            {
              id: "preview-wont-open",
              question: "Why won't Web or Native Preview open?",
              answer: [
                "Use the refresh icon (labeled Run / Reload), then confirm that runwhale.json declares the intended Preview target and a matching Web or native entry. Read the displayed Metro or Native Preview diagnostic; use that exact non-sensitive message when asking the Agent to fix the project.",
              ],
            },
            {
              id: "git-operation-fails",
              question: "Why did Git clone, fetch, pull, or push fail?",
              answer: [
                "Check that the repository uses a supported HTTPS URL or a GitHub SSH URL, then verify the selected branch, network connection, and remote permissions. For GitHub SSH, confirm that the device's current public key is registered on GitHub. Pull also requires a clean worktree, and URLs with embedded credentials are rejected.",
              ],
            },
            {
              id: "support-report",
              question: "What should I include in a support report?",
              answer: [
                "Include the RunWhale version, device model, operating system version, action you attempted, exact error, smallest reproduction steps, and any non-sensitive diagnostic shown by the app. Never include API keys, private keys, credentials, private project data, personal data, or unsanitized logs and screenshots.",
              ],
            },
          ],
        },
      ],
      moreTitle: "Still need help?",
      moreBody:
        "Use the step-by-step guide for the complete first workflow, or contact support when you have a private question or a reproducible problem.",
      guideLabel: "Open the guide",
      supportLabel: "Contact support",
    },
  },
  "zh-CN": {
    updatedLabel: "2026 年 9 月 4 日",
    updatedIso: "2026-09-04",
    guide: {
      metadataTitle: "哪里跑使用教程——从设置到预览",
      metadataDescription:
        "了解如何配置模型、创建或导入项目、使用哪里跑 Agent，并在 Web 或原生 Preview 中测试结果。",
      eyebrow: "教程",
      title: "开始使用哪里跑",
      summary: "配置模型，打开一个真实项目，让 Agent 完成修改，再直接在手机上测试结果。",
      startTitle: "发送第一条需求前",
      startBody:
        "哪里跑把开发工作区放在手机本地，模型推理由你配置的服务商提供。先完成下面三项检查，首次运行会更顺利。",
      prerequisites: [
        {
          title: "准备模型 API 密钥",
          body: "使用你所选模型服务商提供的密钥，只通过哪里跑设置保存，切勿放进项目或提示中。",
        },
        {
          title: "使用 Agent 时保持联网",
          body: "模型推理需要网络；Git 网络操作和未缓存的依赖下载也可能需要联网。",
        },
        {
          title: "从兼容项目开始",
          body: "选择内置 Web 或 Expo 起始项目，或导入具有有效哪里跑 Preview 入口的兼容仓库。",
        },
      ],
      workflowLabel: "核心流程",
      workflowTitle: "从设置到完成一次真实测试",
      workflowBody:
        "完成模型设置后，跟随 Baby game 示例创建 Expo 项目、提出游戏需求、批准修改，再到原生 Preview 中试玩 Animal Parade。",
      steps: [
        {
          action: "设置 → 模型 · 安全保存",
          title: "配置服务商和模型",
          body: [
            "打开“设置 → 模型”，选择要使用的服务商和模型，粘贴该服务商提供的 API 密钥，再点击“安全保存”。",
            "密钥会留在设备的安全存储中。Agent 推理使用你选择的服务商，因此发送需求时设备需要联网。",
          ],
        },
        {
          action: "新建项目 · Web / Expo",
          title: "创建项目或导入仓库",
          body: [
            "点击“新建项目”，填写名称；要制作 React 网站就选择 Web，要制作使用原生 Preview 的应用就选择 Expo。",
            "本次演示输入 Baby game，选择 Expo，将可选仓库地址留空，然后点击 Create and open Agent。",
            "如果要继续现有代码，可以改为输入兼容的 Git 仓库。导入项目会由 runwhale.json 决定 Preview 目标。",
          ],
        },
        {
          action: "Agent",
          title: "描述一个明确结果",
          body: [
            "告诉 Agent 你想构建或修改什么，说明预期行为，并让它运行与当前任务有关的受支持检查。",
            "演示中的完整需求只有“Make a game for baby”。Agent 据此规划了一个使用大触控区域、温和反馈和六张动物卡片的游戏。",
          ],
        },
        {
          action: "审阅 · 仅允许一次 · 活动",
          title: "跟进过程并审查结果",
          body: [
            "在 Review（审阅）模式下，Agent 写入 index.tsx 前，哪里跑会请求批准。点击 Allow once（仅允许一次）后，就能在同一会话中继续跟进文件写入和检查活动。",
            "Agent 运行了 TypeScript 诊断和 Git diff。它在结果说明中指出新工作区的依赖尚未解析，随后转到原生 Preview，通过实际运行检查应用。",
          ],
        },
        {
          action: "运行 / 重新加载 · Preview",
          title: "在 Preview 中运行同一个项目",
          body: [
            "录屏中，Agent 直接启动了原生 Preview。你也可以在一轮任务完成后点击刷新图标（运行 / 重新加载）。Web 项目使用 Web Preview；兼容的 Expo 项目使用原生 Preview。",
            "不要只看第一个画面，要实际操作结果。如果 Preview 显示诊断信息，返回项目并把这条准确、非敏感的信息用于下一次修复。",
          ],
        },
        {
          action: "原生 Preview · Animal Parade",
          title: "点击动物，检查游戏反馈",
          body: [
            "Animal Parade 打开后，在狗、猫、牛、小鸡、青蛙和狮子六张卡片上方显示“Can you find the Dog?”。点击卡片，观察提示和反馈的变化。",
            "演示中可以看到“Yay!”、“Great job!”和“You found it!”等反馈，随后出现下一个寻找动物的提示。需要继续修改时，回到同一个已保存的 Agent 会话即可。",
          ],
        },
      ],
      galleryLabel: homeCopy["zh-CN"].demo.galleryLabel,
      galleryTitle: homeCopy["zh-CN"].demo.galleryTitle,
      galleryBody: homeCopy["zh-CN"].demo.galleryBody,
      screenshots: createGuideScreenshots("zh-CN"),
      videoLabel: "完整演示",
      videoTitle: "观看从需求到 Preview 的完整流程",
      videoBody:
        "这段约 2 分 12 秒的无声录屏，从创建 Baby game 项目和发送一句需求开始，依次展示文件写入批准、检查，以及在原生 Preview 中试玩 Animal Parade。",
      videoAria: homeCopy["zh-CN"].demo.videoAria,
      videoFallback: "你的浏览器不支持视频播放。",
      videoCaption: homeCopy["zh-CN"].demo.videoCaption,
      videoSrc: sitePath("/media/demo/RunWhale-demo-readme.mp4"),
      videoPoster: `${optimizedMediaRoot}/runwhale-animal-parade-poster-720.webp`,
      disclosure: homeCopy["zh-CN"].demo.disclosure,
      nextTitle: "继续了解",
      nextLinks: {
        faq: {
          title: "查看常见问题",
          body: "了解联网、数据处理、项目限制、Git 和常见故障。",
        },
        support: {
          title: "联系支持",
          body: "发送私密请求，或在 GitHub 报告可复现且不含敏感信息的问题。",
        },
        privacy: {
          title: "了解数据处理",
          body: "查看哪些内容留在设备上，哪些内容会发送给你选择的服务。",
        },
        github: {
          title: "浏览源代码",
          body: "查看哪里跑公开仓库、项目范围和贡献指南。",
        },
      },
    },
    faq: {
      metadataTitle: "哪里跑常见问题——设置、项目、Agent 与 Preview",
      metadataDescription:
        "解答哪里跑的设置、本地与远程处理、兼容项目、Git、依赖、Preview 和故障排查问题。",
      eyebrow: "常见问题",
      title: "哪里跑问题解答",
      summary: "快速了解如何开始、哪些内容在手机上运行、项目边界，以及遇到故障时先检查什么。",
      intro:
        "选择下面的问题查看答案。内容只描述当前产品边界，不预设特定服务商、设备发行状态或下载渠道。",
      groups: [
        {
          title: "开始使用",
          items: [
            {
              id: "first-agent-run",
              question: "首次运行 Agent 前需要准备什么？",
              answer: [
                "在“设置 → 模型”中选择服务商和模型，保存该服务商提供的有效 API 密钥，并保持设备联网。随后创建 Web 或 Expo 项目，或导入兼容的代码仓库。",
              ],
            },
            {
              id: "web-or-expo",
              question: "应该选择 Web 还是 Expo 项目？",
              answer: [
                "要制作在 Web Preview 中运行的 React 网站，请选择 Web；要制作在哪里跑固定原生容器中运行的 React Native 项目，请选择 Expo。两种模板都使用同一套项目与 Agent 工作流程。",
              ],
            },
            {
              id: "import-repository",
              question: "可以导入现有代码仓库吗？",
              answer: [
                "可以，但仓库需要兼容哪里跑的 Web 或 Expo 运行环境。导入项目通过 runwhale.json 声明入口和 Preview 目标；依赖不受支持的原生代码、二进制文件或构建步骤的仓库不适合当前运行环境。",
              ],
            },
          ],
        },
        {
          title: "本地运行与数据",
          items: [
            {
              id: "local-or-offline",
              question: "所有内容都在本地运行吗？哪里跑可以离线使用吗？",
              answer: [
                "项目文件、Agent 编排、会话、Node.js 和 TypeScript 工具、受支持的任务、Git、Metro 与 Preview 都在手机上运行。模型推理使用你配置的远程服务商；明确发起的 Git 网络操作和未缓存的依赖下载也会使用网络，因此哪里跑并不是离线产品。",
              ],
            },
            {
              id: "model-context",
              question: "哪些项目数据可能发送给模型服务商？",
              answer: [
                "运行 Agent 时，哪里跑会把你的提示，以及回答所需的项目或会话上下文发送给你选择的服务商。根据具体需求，这些上下文可能包括源代码、文件内容、图片、工具结果和对话历史。",
              ],
            },
            {
              id: "credential-storage",
              question: "API 与 Git 凭据保存在哪里？",
              answer: [
                "模型 API 密钥与设备 Git 私钥会保存在 iOS Keychain 或 Android Keystore 中，不会写入项目文件、环境变量、Git 配置、Agent 会话、日志或 Preview 包。",
              ],
            },
          ],
        },
        {
          title: "兼容性与限制",
          items: [
            {
              id: "private-git",
              question: "哪里跑可以使用私有 Git 仓库吗？",
              answer: [
                "可以，但当前指通过 SSH 访问 GitHub 私有仓库。在“设置 → Git SSH 密钥”中生成或复制设备公钥，把公钥添加到 GitHub，再使用仓库的 GitHub SSH 地址。私钥会继续留在设备安全存储中；访问是否成功仍取决于网络和 GitHub 上授予的仓库权限。",
              ],
            },
            {
              id: "npm-packages",
              question: "项目可以安装任意 npm 软件包吗？",
              answer: [
                "不可以。哪里跑支持 npm 注册表中兼容的纯 JavaScript 软件包。生命周期脚本和二进制链接会被禁用；Git 或路径依赖、原生扩展或二进制文件、动态 Expo 配置插件，以及项目专用原生 SDK 均不受支持。根据权限模式，哪里跑可能会要求你批准安装。",
              ],
            },
            {
              id: "standalone-builds",
              question: "哪里跑会构建独立的 iOS 或 Android 应用吗？",
              answer: [
                "不会。用户项目会作为 Web 或 React Native Preview 目标在当前应用中运行，不会触发 Xcode、Gradle、EAS、IPA 或 APK 构建。",
              ],
            },
            {
              id: "background-work",
              question: "Agent 或 Metro 会在后台继续工作吗？",
              answer: [
                "不要依赖持续后台执行。特别是在当前产品中，iOS 进入后台后不会持续运行 Agent 或 Metro。正在执行开发轮次或构建 Preview 时，请让哪里跑保持在前台。",
              ],
            },
          ],
        },
        {
          title: "故障排查",
          items: [
            {
              id: "agent-wont-start",
              question: "Agent 为什么无法启动？",
              answer: [
                "请确认所选服务商已经保存有效的 API 密钥，并且设备已联网。如果哪里跑报告本地运行环境故障，请先重启运行环境并再次尝试，不要急于修改项目。",
              ],
            },
            {
              id: "preview-wont-open",
              question: "Web 或原生 Preview 为什么无法打开？",
              answer: [
                "点击刷新图标（标注为“运行 / 重新加载”），再确认 runwhale.json 声明了预期的 Preview 目标和与之匹配的 Web 或原生入口。阅读界面显示的 Metro 或原生 Preview 诊断，并在请 Agent 修复时使用这条准确且不含敏感信息的内容。",
              ],
            },
            {
              id: "git-operation-fails",
              question: "Git clone、fetch、pull 或 push 为什么失败？",
              answer: [
                "请确认仓库使用受支持的 HTTPS 地址或 GitHub SSH 地址，并检查所选分支、网络连接和远程权限。使用 GitHub SSH 时，请确认设备当前公钥已添加到 GitHub。pull 还要求工作树保持干净；包含内嵌凭据的地址会被拒绝。",
              ],
            },
            {
              id: "support-report",
              question: "提交支持请求时应该提供什么？",
              answer: [
                "请提供哪里跑版本、设备型号、操作系统版本、尝试执行的操作、完整错误信息、最少复现步骤，以及应用显示的非敏感诊断。切勿提供 API 密钥、私钥、凭据、私有项目数据、个人数据，或未经脱敏的日志和截图。",
              ],
            },
          ],
        },
      ],
      moreTitle: "仍然需要帮助？",
      moreBody:
        "通过分步教程完成第一次完整流程；如果你有私密问题或可以复现的故障，请联系支持。",
      guideLabel: "打开教程",
      supportLabel: "联系支持",
    },
  },
} as const satisfies HelpCopy;

const socialImage = `${siteUrl}/media/optimized/v1/runwhale-og-1200x630.png`;

const helpPaths: Record<HelpPageKind, { en: string; "zh-CN": string }> = {
  guide: { en: "/guide", "zh-CN": "/zh-CN/guide" },
  faq: { en: "/faq", "zh-CN": "/zh-CN/faq" },
};

export function createHelpMetadata(kind: HelpPageKind, locale: WebsiteLocale): Metadata {
  const page = helpCopy[locale][kind];
  const path = helpPaths[kind][locale];
  const title = page.metadataTitle;
  const description = page.metadataDescription;
  const siteName = locale === "en" ? "RunWhale" : "哪里跑";
  const imageAlt = locale === "en"
    ? "RunWhale AI coding agent and development workspace on a phone"
    : "哪里跑——手机上的 AI 编程智能体与开发工作区";

  return {
    title,
    description,
    robots: indexableRobots,
    alternates: {
      canonical: `${siteUrl}${path}`,
      languages: {
        "en-US": `${siteUrl}${helpPaths[kind].en}`,
        "zh-CN": `${siteUrl}${helpPaths[kind]["zh-CN"]}`,
      },
    },
    openGraph: {
      title,
      description,
      url: `${siteUrl}${path}`,
      siteName,
      locale: locale === "en" ? "en_US" : "zh_CN",
      type: "website",
      images: [{ url: socialImage, width: 1200, height: 630, alt: imageAlt }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [{ url: socialImage, alt: imageAlt }],
    },
  };
}
