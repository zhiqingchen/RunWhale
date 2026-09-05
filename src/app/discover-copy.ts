import { siteUrl, sitePath } from "@/app/site-config";
import type { Metadata } from "next";
import type { WebsiteLocale } from "./home-copy";
import { indexableRobots } from "./seo-metadata";

export const discoverCopy = {
  en: {
    examplesLabel: "Examples",
    updatesLabel: "Changelog",
    examplesHref: "/examples",
    updatesHref: "/changelog",
    updated: "September 5, 2026",
    purchase: {
      title: "Before you download",
      downloadNote: "Model API key required. Provider usage is billed separately.",
      summary: "Bring your idea and a model API key.",
      items: [
        { title: "One-time app purchase", body: "The purchase gives you the RunWhale workspace. Check the App Store for your local price and availability." },
        { title: "Model usage is separate", body: "Bring your own provider API key. Model usage is billed by that provider and is not included in the app purchase." },
        { title: "Check your device", body: "Use the App Store listing to check iPhone and iPad compatibility. Agent requests need an internet connection." },
      ],
      guide: "Set up your first model",
      limits: "Check project compatibility",
    },
    examples: {
      title: "An idea you can start with.",
      summary: "Explore two projects from recorded RunWhale workflows, then copy a prompt for your own project.",
      all: "Explore the examples",
      watch: "Watch the recording",
      copy: "Copy prompt",
      copied: "Prompt copied",
      copyError: "Copy was unavailable. Select and copy the prompt above.",
      promptLabel: "Starting prompt",
      originalPrompt: "Original demo prompt",
      suggestedPrompt: "Suggested starting prompt",
      steps: "Create an Expo project, configure your model in Settings, then send the prompt in Agent. Open Native Preview to try the result.",
      note: "Screenshots and recordings show the existing demos. New Agent runs can produce different results; the Snake prompt below is a shorter suggestion, not the full recorded request.",
      ideasTitle: "What would you make next?",
      ideasBody: "These are starting ideas to build yourself. Choose the indicated project type and adapt the prompt to your needs.",
      guide: "Follow the setup guide",
      cases: [
        {
          id: "animal-parade",
          title: "Animal Parade",
          category: "Expo · Learning game",
          description: "Six animal cards, a friendly question, and feedback with every tap. See a short idea become a game in Native Preview.",
          image: sitePath("/media/optimized/v1/05-animal-parade-preview-720.webp"),
          imageAlt: "Animal Parade in Native Preview with six animal cards and a prompt to find the Dog.",
          width: 720,
          height: 1566,
          video: sitePath("/media/demo/RunWhale-demo-readme.mp4"),
          prompt: "Make a game for baby",
          original: true,
        },
        {
          id: "snake-sprint",
          title: "Snake Sprint",
          category: "Expo · Arcade game",
          description: "Steer with touch controls, pause a round, and try an obstacle mode added through a follow-up request.",
          image: sitePath("/media/optimized/v1/05-see-features-come-to-life-framed-720.webp"),
          imageAlt: "Recorded Snake Sprint Native Preview with Obstacle Mode and orange barriers on the game board.",
          width: 720,
          height: 1564,
          video: sitePath("/media/demo/runwhale-snake-agent-workflow.mp4"),
          prompt: "Build a portrait Snake game using React Native built-ins. Add food, a live score, large touch direction controls, Start, Pause, Resume, Restart, and a game-over state. Add an Obstacle Mode toggle that restarts the round and makes hitting a barrier end the game. Keep all controls visible on a phone. Run the supported checks before I open Native Preview.",
          original: false,
        },
      ],
      ideas: [
        { title: "Your personal website", category: "Web", prompt: "Build a responsive personal website with an introduction, three project cards, and a contact section. Use editable sample content and CSS for the layout. Make navigation work on a phone and run the supported checks before Web Preview." },
        { title: "A focus timer", category: "Expo", prompt: "Build a focus timer using React Native built-ins. Add adjustable focus and break durations, Start, Pause, Resume, and Reset. Show which session is active and keep all controls easy to tap. Keep the app in the foreground while timing. Run the supported checks before Native Preview." },
      ],
    },
    updates: {
      title: "What’s new at RunWhale.",
      summary: "Follow changes to the website, examples, and getting-started resources.",
      latest: "Latest website update",
      all: "Read the changelog",
      website: "Website",
      entries: [
        {
          id: "2026-09-05",
          date: "September 5, 2026",
          title: "Find your first project",
          summary: "Recorded examples, copyable prompts, and clearer information before you download.",
          changes: ["Explore Animal Parade and Snake Sprint, with recordings and prompts to get started.", "Find app purchase, model billing, and device information together beside the download section.", "Browse this changelog for dated website updates."],
        },
        {
          id: "2026-09-04",
          date: "September 4, 2026",
          title: "A guide for your first workflow",
          summary: "English and Chinese help pages now cover setup, Agent work, and Preview.",
          changes: ["Follow the guide from model setup to a project running in Preview.", "Find answers about compatible projects, Git, connectivity, and common errors in the FAQ."],
        },
      ],
    },
  },
  "zh-CN": {
    examplesLabel: "作品案例",
    updatesLabel: "更新日志",
    examplesHref: "/zh-CN/examples",
    updatesHref: "/zh-CN/changelog",
    updated: "2026 年 9 月 5 日",
    purchase: {
      title: "下载前，先了解这些",
      downloadNote: "需要自备模型 API 密钥，服务商用量单独计费。",
      summary: "准备一个想法，以及模型 API 密钥。",
      items: [
        { title: "应用一次性购买", body: "购买后即可使用哪里跑开发工作区。当地价格和可购买状态请以 App Store 为准。" },
        { title: "模型用量单独计费", body: "需要使用你自己的服务商 API 密钥。模型用量由该服务商计费，不包含在应用购买费用中。" },
        { title: "确认设备是否适用", body: "请在 App Store 查看 iPhone 和 iPad 的兼容性要求。向智能体发送需求时需要联网。" },
      ],
      guide: "配置第一个模型",
      limits: "查看项目兼容范围",
    },
    examples: {
      title: "从一个想做的作品开始。",
      summary: "看看两段真实工作流程中的作品，再复制提示词，开始自己的项目。",
      all: "浏览作品案例",
      watch: "观看演示录像",
      copy: "复制提示词",
      copied: "提示词已复制",
      copyError: "暂时无法自动复制，请选中上方提示词手动复制。",
      promptLabel: "起步提示词",
      originalPrompt: "演示中的原始提示词",
      suggestedPrompt: "建议起步提示词",
      steps: "创建 Expo 项目，在设置中配置模型，然后把提示词发送给智能体。完成后打开原生预览，亲手试一试。",
      note: "截图和录像展示已有演示。重新运行智能体时，结果可能不同；下方贪吃蛇提示词是精简后的建议，并非录像中的完整原始需求。",
      ideasTitle: "下一个，你想做什么？",
      ideasBody: "这些是供你动手实现的起步想法。选择对应项目类型，再按自己的需要修改提示词。",
      guide: "查看上手教程",
      cases: [
        {
          id: "animal-parade",
          title: "Animal Parade · 动物乐园",
          category: "Expo · 启蒙小游戏",
          description: "六张动物卡片、一个寻找动物的问题，以及点击后的鼓励反馈。看看一句想法如何变成原生预览中的游戏。",
          image: sitePath("/media/optimized/v1/05-animal-parade-preview-720.webp"),
          imageAlt: "Animal Parade 原生预览：寻找小狗的提示下方显示六张动物卡片。",
          width: 720,
          height: 1566,
          video: sitePath("/media/demo/RunWhale-demo-readme.mp4"),
          prompt: "Make a game for baby",
          original: true,
        },
        {
          id: "snake-sprint",
          title: "Snake Sprint · 贪吃蛇",
          category: "Expo · 街机小游戏",
          description: "通过触控按钮转向，随时暂停一局，再体验通过后续需求加入的障碍模式。",
          image: sitePath("/media/optimized/v1/05-see-features-come-to-life-framed-720.webp"),
          imageAlt: "Snake Sprint 真实原生预览画面：已启用障碍模式，棋盘上显示橙色障碍。",
          width: 720,
          height: 1564,
          video: sitePath("/media/demo/runwhale-snake-agent-workflow.mp4"),
          prompt: "使用 React Native 内置组件做一个竖屏贪吃蛇游戏，加入食物、实时分数、大尺寸触控方向键，以及开始、暂停、继续、重新开始和游戏结束状态。增加障碍模式开关，切换时重新开始，撞到障碍时结束游戏。确保所有操作按钮在手机上可见。在我打开原生预览前，运行受支持的检查。",
          original: false,
        },
      ],
      ideas: [
        { title: "你的个人网站", category: "Web", prompt: "做一个适配手机的个人网站，包含自我介绍、三个作品卡片和联系方式。使用方便替换的示例内容，通过 CSS 完成布局。确保手机上的导航可用，并在打开 Web 预览前运行受支持的检查。" },
        { title: "一个专注计时器", category: "Expo", prompt: "使用 React Native 内置组件做一个专注计时器，可以调整专注和休息时长，支持开始、暂停、继续和重置。清楚显示当前阶段，按钮方便点击。计时期间保持应用在前台。在打开原生预览前运行受支持的检查。" },
      ],
    },
    updates: {
      title: "哪里跑，又有了新变化。",
      summary: "了解官网、作品案例和上手资源的最新变化。",
      latest: "最近的官网更新",
      all: "查看更新日志",
      website: "官网",
      entries: [
        {
          id: "2026-09-05",
          date: "2026 年 9 月 5 日",
          title: "找到你的第一个项目",
          summary: "新增真实案例、可复制的提示词，以及更清晰的下载前说明。",
          changes: ["浏览 Animal Parade 和 Snake Sprint，通过录像和提示词开始动手。", "在下载区域旁集中了解应用购买、模型计费和设备要求。", "通过更新日志查看按日期记录的官网变化。"],
        },
        {
          id: "2026-09-04",
          date: "2026 年 9 月 4 日",
          title: "第一次完整开发流程，有了教程",
          summary: "中英文帮助页面覆盖模型配置、智能体工作和预览。",
          changes: ["跟随教程，从模型配置走到项目在预览中运行。", "通过常见问题了解项目兼容范围、Git、联网需求和故障处理。"],
        },
      ],
    },
  },
} as const;

export function createDiscoverMetadata(kind: "examples" | "updates", locale: WebsiteLocale): Metadata {
  const copy = discoverCopy[locale];
  const segment = kind === "examples" ? "examples" : "changelog";
  const path = locale === "en" ? `/${segment}` : `/zh-CN/${segment}`;
  const title = `${locale === "en" ? "RunWhale" : "哪里跑"} — ${kind === "examples" ? copy.examplesLabel : copy.updatesLabel}`;
  const description = copy[kind].summary;
  const socialImage = `${siteUrl}/media/optimized/v1/runwhale-og-1200x630.png`;
  return {
    title,
    description,
    robots: indexableRobots,
    alternates: {
      canonical: `${siteUrl}${path}`,
      languages: { "en-US": `${siteUrl}/${segment}`, "zh-CN": `${siteUrl}/zh-CN/${segment}` },
    },
    openGraph: { title, description, url: `${siteUrl}${path}`, locale: locale === "en" ? "en_US" : "zh_CN", type: "website", images: [{ url: socialImage, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description, images: [socialImage] },
  };
}
