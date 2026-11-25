import { getCollection, type CollectionEntry } from "astro:content";
import type { ProductLocale } from "../universe/locale";

export type PortfolioEntry = CollectionEntry<"portfolio">;
export type PortfolioPageProps =
  | { entries: PortfolioEntry[]; entry?: never }
  | { entry: PortfolioEntry; entries?: never };

type CopyField = "title" | "summary" | "body";
type EntryCopy = Partial<Record<CopyField, string>>;
type DisplayText = { text: string; lang: "en" | "zh-CN" };

// Main's Markdown loader supplies entry.id. The canonical authoring candidate's
// loader makes the same entry.id derive from contentId. Reuse that identity and
// read its optional authoring fields without creating a second collection.
type AuthoringData = PortfolioEntry["data"] & {
  i18n?: Partial<Record<ProductLocale, EntryCopy>>;
  body?: string;
  signalVisible?: boolean;
  links?: Array<{ label: string; url: string }>;
};

export const PERSONAL_UNIVERSE_ID = "personal-universe";

// Compatibility copy for the one published Markdown entry. When the authored
// locale exists (e.g. on #180), its value wins. No extra item is published.
const legacyPersonalUniverseZh: EntryCopy = {
  title: "个人宇宙",
  summary: "一个可以探索的个人主页，把项目与经历放进真实观测和程序生成交织的星空。",
  body: "站点本身是第一条个人信号，用来验证如何把一件作品放进可访问的星球。",
};

export function portfolioCopy(entry: PortfolioEntry, locale: ProductLocale) {
  const data: AuthoringData = entry.data;
  const legacy = locale === "zh" && entry.id === PERSONAL_UNIVERSE_ID
    ? legacyPersonalUniverseZh
    : undefined;

  function read(field: CopyField): DisplayText | undefined {
    const requested = data.i18n?.[locale]?.[field] ?? legacy?.[field];
    if (requested) return { text: requested, lang: locale === "zh" ? "zh-CN" : "en" };
    const fallback = data.i18n?.en?.[field] ?? data[field];
    return fallback ? { text: fallback, lang: "en" } : undefined;
  }

  return {
    // The schema requires both base fields, even when no locale is authored.
    title: read("title") ?? { text: data.title, lang: "en" },
    summary: read("summary") ?? { text: data.summary, lang: "en" },
    body: read("body"),
  };
}

export function portfolioLinks(entry: PortfolioEntry, locale: ProductLocale) {
  const data: AuthoringData = entry.data;
  const authored = [
    ...(data.href ? [{ label: locale === "zh" ? "打开作品" : "Open project", url: data.href }] : []),
    ...(data.links ?? []),
  ];

  if (entry.id === PERSONAL_UNIVERSE_ID) {
    const repo = "https://github.com/Su-long-ai/personal-universe";
    authored.push(
      { label: locale === "zh" ? "GitHub 源码" : "Source on GitHub", url: repo },
      { label: locale === "zh" ? "导航设计" : "Navigation design", url: repo + "/blob/main/docs/architecture/navigation.md" },
    );
  }

  const links = new Map<string, { label: string; url: string }>();
  for (const link of authored) {
    const url = new URL(link.url);
    if ((url.protocol === "https:" || url.protocol === "http:") && !links.has(url.href)) {
      links.set(url.href, { label: link.label, url: url.href });
    }
  }
  return [...links.values()];
}

function isPublished(entry: PortfolioEntry): boolean {
  const data: AuthoringData = entry.data;
  return !data.draft && data.signalVisible !== false;
}

export async function portfolioStaticPaths(): Promise<
  Array<{ params: { entry: string | undefined }; props: PortfolioPageProps }>
> {
  const entries = (await getCollection("portfolio", isPublished)).sort(
    (a, b) =>
      Number(b.data.featured) - Number(a.data.featured) ||
      b.data.importance - a.data.importance ||
      a.id.localeCompare(b.id, "en"),
  );
  return [
    { params: { entry: undefined }, props: { entries } },
    ...entries.map((entry) => ({ params: { entry: entry.id }, props: { entry } })),
  ];
}

export const personalUniverseCaseStudy = {
  en: [
    {
      title: "A portfolio you can navigate",
      text: "The 3D homepage lets you move from the galaxy into a stellar system, approach a planet, enter orbit and, on supported worlds, descend to the surface. Search and Places let you go straight to a destination instead.",
    },
    {
      title: "One authored signal, one address",
      text: "The project is pinned to Spica in the star catalogue. The site keeps the project’s own copy separate from astronomical observations and generated worlds, so an unassigned planet does not pretend to be a personal work.",
    },
  ],
  zh: [
    {
      title: "从星空里找作品",
      text: "在 3D 首页可以从银河进入恒星系，靠近行星、进入轨道，并在支持着陆的星球降到地表。也可以直接用「搜索 / 地点」跳到想去的目的地。",
    },
    {
      title: "给作品一个稳定地址",
      text: "本站的作品信号固定挂在角宿一（Spica）。作品介绍、真实天文观测与程序生成是三类不同的内容，未关联作品的星球不会被编造成个人经历。",
    },
  ],
};
