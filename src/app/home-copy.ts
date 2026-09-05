export type WebsiteLocale = "en" | "zh-CN";

export const homeCopy = {
  en: {
    htmlLang: "en-US",
    brand: "RunWhale",
    homeAria: "RunWhale home",
    navAria: "Main navigation",
    nav: {
      demo: "Demo",
      features: "Features",
      workflow: "How it works",
      security: "Security",
      guide: "Guide",
      faq: "FAQ",
      help: "Help",
    },
    guideHref: "/guide",
    faqHref: "/faq",
    languageHref: "/zh-CN",
    languageLabel: "中文",
    languageAria: "查看简体中文网站",
    eyebrow: "Dive deep. Get it done.",
    heroTitle: "An AI coding agent and development workspace",
    heroAccent: "on your phone.",
    heroLead:
      "Create a Web or Expo project, or import a compatible repository. Ask RunWhale's AI coding agent to inspect and edit code, run supported checks, review Git changes, and open Web or React Native Preview. The workspace runs on your phone; model inference uses the provider you configure.",
    beginnerPitch:
      "Beginner-friendly vibe coding — start with an idea and learn by building.",
    downloadOnAppStore: "Download on the App Store",
    appStorePrice: "US$10 one-time purchase",
    watchWorkflow: "Watch a real workflow",
    localNote:
      "Workspace files and tools run on your device; model inference uses your configured provider",
    whaleAlt: "RunWhale whale mark",
    trustAria: "On-device capabilities",
    trustLabel: "ON YOUR PHONE",
    capabilities: ["Projects", "Agent sessions", "Git", "Node.js", "Metro", "Preview"],
    demo: {
      chip: "Real workflow",
      title: "One prompt. A game you can play.",
      description:
        "Start an Expo project called Baby game and ask: ‘Make a game for baby.’ Follow the Agent as it builds Animal Parade, then try the animal cards in Native Preview.",
      videoAria: "Silent RunWhale demo showing Baby game becoming Animal Parade in Native Preview",
      videoFallback: "Your browser does not support the video tag.",
      videoCaption:
        "Animal Parade · Full demo · About 2 min 12 sec · No audio",
      kicker: "One project. One durable session.",
      spotlightTitle: "Make a game for baby.",
      spotlightBody:
        "A short request becomes six colorful animal cards. Approve the file edit, follow the Agent's checks, and open Animal Parade in Native Preview. Tapping the cards brings up friendly feedback and the next animal prompt.",
      outline: [
        { title: "Create", body: "Name the project Baby game, choose Expo, and open the Agent." },
        { title: "Build", body: "Send the prompt, approve the edit, and follow the checks." },
        {
          title: "Play",
          body: "Find the Dog, tap the animal cards, and see the game respond.",
        },
      ],
      galleryLabel: "From prompt to play",
      galleryTitle: "Six moments from the same demo.",
      galleryBody:
        "Create the project, send one prompt, approve the file write, follow the checks, open Native Preview, and try the game.",
      disclosure:
        "All six screenshots are frames from the demo above, with the original English interface. RunWhale is available on the App Store as a US$10 one-time purchase.",
    },
    screenshots: [
      {
        slug: "01-create-baby-game",
        title: "Create Baby game with Expo.",
        alt: "RunWhale New Project screen with Baby game entered, Expo selected, and the optional Git repository field empty.",
      },
      {
        slug: "02-prompt-and-agent-plan",
        title: "Ask: Make a game for baby.",
        alt: "RunWhale Agent session showing Make a game for baby and a plan for large touch targets, gentle feedback, and no failure state.",
      },
      {
        slug: "03-approve-file-write",
        title: "Approve the file change.",
        alt: "RunWhale asking permission to write index.tsx, with Reject and Allow once buttons.",
      },
      {
        slug: "04-checks-before-preview",
        title: "Follow the checks before Preview.",
        alt: "TypeScript diagnostics and Git diff activity, followed by the Agent's unresolved-dependency summary before Native Preview.",
      },
      {
        slug: "05-animal-parade-preview",
        title: "Play Animal Parade in Native Preview.",
        alt: "Animal Parade in Native Preview with Can you find the Dog? above six colorful cards: Dog, Cat, Cow, Chick, Frog, and Lion.",
      },
      {
        slug: "06-interaction-feedback",
        title: "Tap an animal and see the response.",
        alt: "Animal Parade displaying Great job! beside the Lion icon after an interaction in Native Preview.",
      },
    ],
    featuresSection: {
      chip: "Why RunWhale",
      title: "A focused development loop,",
      titleSecondLine: "right on your phone.",
      description:
        "Not a remote desktop. Not a cloud IDE. RunWhale puts a focused, controlled development environment on the device itself.",
    },
    features: [
      {
        title: "An AI coding agent that works in your project",
        body: "Ask it to inspect, edit, test, and repair your code. RunWhale works inside the project, not beside it.",
        meta: "Inspect · Edit · Test",
      },
      {
        title: "Web and Native Preview",
        body: "Run compatible projects in Web Preview, or preview Expo projects natively on iOS and Android—without triggering cloud builds or native builds for the user project.",
        meta: "Web · iOS · Android",
      },
      {
        title: "On-device workspace",
        body: "Core development runs on your phone. Model inference, explicit network Git operations, and uncached dependency downloads use the network.",
        meta: "Local tools · Connected models",
      },
    ],
    workflow: {
      chip: "From repository to result",
      title: "Open a project. Ask the agent. Preview the result.",
      description:
        "Less context switching, more forward motion. Every step stays connected inside one durable project session.",
      steps: [
        {
          title: "Start a project",
          body: "Create a Web or Expo project, or import a compatible Git repository.",
        },
        {
          title: "Hand it to the agent",
          body: "Let it inspect, modify, and verify the code. Review write actions when you want control.",
        },
        {
          title: "Preview on device",
          body: "Start Web or Native Preview through embedded Metro and see the result immediately.",
        },
      ],
    },
    security: {
      chip: "Local-first architecture",
      title: "The development workspace stays on your device.",
      body: "Projects, developer tools, and Preview run locally. Model inference sends your prompt and the project or session context needed to answer it to the provider you configure. Explicit Git operations and uncached dependency downloads also use the network.",
      credentialBody:
        "API keys stay in system secure storage and never enter projects, environment variables, sessions, logs, or Preview bundles.",
      contextLink: "How RunWhale handles project context",
      privacyHref: "/privacy",
      checks: [
        "On-device Node.js and TypeScript tasks",
        "Token-protected localhost runtime",
        "Device-generated Git SSH keys",
      ],
    },
    finalCta: {
      chip: "Open source · Apache 2.0",
      title: "When the next idea arrives,",
      titleSecondLine: "you are already developing.",
      tagline: "RunWhale — Dive deep. Get it done.",
      github: "Explore RunWhale on GitHub",
    },
    footer: {
      copyright: "© 2026 RunWhale. Built for deep work.",
      navAria: "Guide, FAQ, legal, support, language, and project links",
      guide: "Guide",
      guideHref: "/guide",
      faq: "FAQ",
      faqHref: "/faq",
      privacy: "Privacy",
      privacyHref: "/privacy",
      support: "Support",
      supportHref: "/support",
    },
  },
  "zh-CN": {
    htmlLang: "zh-CN",
    brand: "哪里跑",
    homeAria: "哪里跑首页",
    navAria: "主导航",
    nav: {
      demo: "演示",
      features: "功能",
      workflow: "工作方式",
      security: "安全",
      guide: "教程",
      faq: "常见问题",
      help: "帮助",
    },
    guideHref: "/zh-CN/guide",
    faqHref: "/zh-CN/faq",
    languageHref: "/",
    languageLabel: "EN",
    languageAria: "View the website in English",
    eyebrow: "深入探索，高效完成。",
    heroTitle: "AI 编程智能体与开发工作区，",
    heroAccent: "就在你的手机上。",
    heroLead:
      "创建 Web 或 Expo 项目，也可以导入兼容的代码仓库。让哪里跑的 AI 编程智能体检查和编辑代码、运行受支持的检查、审查 Git 变更，并打开 Web 或 React Native 预览。工作区在手机本地运行；模型推理由你配置的服务商提供。",
    beginnerPitch: "对新手更友好的 Vibe Coding——从一个想法开始，在创造中学习。",
    downloadOnAppStore: "前往 App Store 下载",
    appStorePrice: "一次性购买 · 10 美元",
    watchWorkflow: "观看真实工作流程",
    localNote: "工作区文件和工具在设备本地运行；模型推理由你配置的服务商提供",
    whaleAlt: "哪里跑鲸鱼标志",
    trustAria: "设备端能力",
    trustLabel: "就在你的手机上",
    capabilities: ["项目", "智能体会话", "Git", "Node.js", "Metro", "预览"],
    demo: {
      chip: "真实工作流程",
      title: "一句需求，做出可以试玩的游戏。",
      description:
        "创建名为 Baby game 的 Expo 项目，输入“Make a game for baby”。跟随智能体完成 Animal Parade，再到原生预览中点击动物卡片，体验游戏。",
      videoAria: "哪里跑无声演示：从 Baby game 项目到原生预览中的 Animal Parade 游戏",
      videoFallback: "你的浏览器不支持视频播放。",
      videoCaption:
        "Animal Parade · 完整演示 · 约 2 分 12 秒 · 无声",
      kicker: "一个项目，一个持久化会话。",
      spotlightTitle: "给宝宝做一个游戏。",
      spotlightBody:
        "一句简单需求，变成六张彩色动物卡片。批准文件修改，跟进智能体的检查，再到原生预览中打开 Animal Parade。点击卡片，就能看到鼓励反馈和下一个寻找动物的提示。",
      outline: [
        { title: "创建", body: "将项目命名为 Baby game，选择 Expo，打开智能体。" },
        { title: "构建", body: "发送需求，批准文件修改，再跟进检查结果。" },
        { title: "试玩", body: "根据提示寻找小狗，点击动物卡片，查看游戏反馈。" },
      ],
      galleryLabel: "从提示到试玩",
      galleryTitle: "同一段演示中的六个时刻。",
      galleryBody:
        "创建项目、发送需求、批准文件写入、跟进检查、打开原生预览，再亲手试玩游戏。",
      disclosure:
        "六张截图均取自上方演示视频，保留原始英文界面。哪里跑现已在 App Store 上架，一次性购买价 10 美元。",
    },
    screenshots: [
      {
        slug: "01-create-baby-game",
        title: "用 Expo 创建 Baby game。",
        alt: "哪里跑的新建项目界面：已填写 Baby game，选择 Expo 模板，可选 Git 仓库地址为空。",
      },
      {
        slug: "02-prompt-and-agent-plan",
        title: "输入需求：给宝宝做个游戏。",
        alt: "智能体会话显示 Make a game for baby，以及使用大触控区域、温和反馈且没有失败状态的游戏计划。",
      },
      {
        slug: "03-approve-file-write",
        title: "批准文件修改。",
        alt: "哪里跑请求写入 index.tsx，弹窗提供 Reject 和 Allow once 按钮。",
      },
      {
        slug: "04-checks-before-preview",
        title: "打开预览前，跟进检查结果。",
        alt: "TypeScript 诊断和 Git diff 活动，以及智能体在启动原生预览前对依赖尚未解析的说明。",
      },
      {
        slug: "05-animal-parade-preview",
        title: "在原生预览中玩 Animal Parade。",
        alt: "Animal Parade 原生预览：寻找小狗的提示下方显示狗、猫、牛、小鸡、青蛙和狮子六张彩色卡片。",
      },
      {
        slug: "06-interaction-feedback",
        title: "点击动物，查看游戏反馈。",
        alt: "Animal Parade 在一次交互后，于狮子图标旁显示 Great job! 鼓励反馈。",
      },
    ],
    featuresSection: {
      chip: "为什么选择哪里跑",
      title: "专注的开发循环，",
      titleSecondLine: "就在你的手机上。",
      description:
        "不是远程桌面，也不是云端 IDE。哪里跑把专注、可控的开发环境直接放到设备本地。",
    },
    features: [
      {
        title: "真正进入项目工作的 AI 编程智能体",
        body: "让它检查、编辑、测试和修复代码。哪里跑在项目内部工作，而不是只在旁边提供建议。",
        meta: "检查 · 编辑 · 测试",
      },
      {
        title: "Web 与原生预览",
        body: "在 Web 预览中运行兼容项目，或直接在 iOS 和 Android 上原生预览 Expo 项目，无需为用户项目触发云端或原生构建。",
        meta: "Web · iOS · Android",
      },
      {
        title: "设备本地工作区",
        body: "核心开发过程在手机上运行。模型推理、明确发起的网络 Git 操作和未缓存的依赖下载会使用网络。",
        meta: "本地工具 · 联网模型",
      },
    ],
    workflow: {
      chip: "从代码仓库到运行结果",
      title: "打开项目，交给智能体，预览结果。",
      description: "少一些上下文切换，多一些持续推进。每一步都连接在同一个持久化项目会话中。",
      steps: [
        {
          title: "开始一个项目",
          body: "创建 Web 或 Expo 项目，也可以导入兼容的 Git 代码仓库。",
        },
        {
          title: "交给智能体",
          body: "让它检查、修改并验证代码；需要控制时，你可以审查写入操作。",
        },
        {
          title: "在设备上预览",
          body: "通过内嵌 Metro 启动 Web 或原生预览，立即查看结果。",
        },
      ],
    },
    security: {
      chip: "本地优先架构",
      title: "开发工作区始终留在你的设备上。",
      body: "项目、开发工具和预览都在本地运行。模型推理会把你的提示，以及回答所需的项目或会话上下文，发送给你配置的服务商。明确发起的 Git 操作和未缓存的依赖下载也会使用网络。",
      credentialBody:
        "API 密钥保存在系统安全存储中，绝不会进入项目、环境变量、会话、日志或预览包。",
      contextLink: "了解哪里跑如何处理项目上下文",
      privacyHref: "/zh-CN/privacy",
      checks: [
        "设备端 Node.js 和 TypeScript 任务",
        "令牌保护的 localhost 运行时",
        "设备生成的 Git SSH 密钥",
      ],
    },
    finalCta: {
      chip: "开源 · Apache 2.0",
      title: "下一个想法出现时，",
      titleSecondLine: "你已经在开发了。",
      tagline: "哪里跑——深入探索，高效完成。",
      github: "在 GitHub 上探索哪里跑",
    },
    footer: {
      copyright: "© 2026 哪里跑。为深度工作而生。",
      navAria: "教程、常见问题、法律、支持、语言和项目链接",
      guide: "教程",
      guideHref: "/zh-CN/guide",
      faq: "常见问题",
      faqHref: "/zh-CN/faq",
      privacy: "隐私",
      privacyHref: "/zh-CN/privacy",
      support: "支持",
      supportHref: "/zh-CN/support",
    },
  },
} as const satisfies Record<WebsiteLocale, object>;
