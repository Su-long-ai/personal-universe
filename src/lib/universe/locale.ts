import type { UniverseContentKind } from "./content";
import type { UniversePhase } from "./types";
import type {
  UniverseNavigationGroup,
  UniverseNavigationKind,
} from "./yeis/navigation";

export type ProductLocale = "en" | "zh";

const STORAGE_KEY = "personal-universe.locale";

const TEXT = {
  en: {
    open: "OPEN",
    hide: "HIDE",
    currentLayer: "CURRENT LAYER",
    soundOff: "SOUND OFF",
    soundOn: "SOUND ON",
    quality: "QUALITY",
    auto: "AUTO",
    high: "HIGH",
    low: "LOW",
    searchPlaces: "SEARCH / PLACES",
    returnGalaxy: "← RETURN TO GALAXY",
    returning: "RETURNING…",
    returnSystem: "← RETURN TO SYSTEM",
    universeNavigator: "Universe Navigator",
    navigationKicker: "YEIS NAVIGATION // SEARCH + PLACES",
    closeNavigator: "Close navigator",
    searchPlaceholder:
      "Search personal signals, planets, stars, landmarks, galaxies…",
    searchUniverse: "Search universe",
    searchResults: "SEARCH RESULTS",
    placesDestinations: "PLACES / DESTINATIONS",
    scanning: "SCANNING…",
    destinations: "DESTINATIONS",
    guidedJourneys: "GUIDED JOURNEYS",
    featuredJourney: "Featured Journey",
    projectsJourney: "Projects Journey",
    researchJourney: "Research Journey",
    stops: "STOPS",
    noSignalsYet: "NO SIGNALS YET",
    scanningDestinations: "Scanning destinations…",
    navigationUnavailable: "YEIS navigation index unavailable.",
    noDestination: "No destination matched this signal.",
    traveling: "TRAVELING…",
    opening: "OPENING…",
    locating: "LOCATING…",
    active: "ACTIVE",
    travel: "TRAVEL →",
    openAction: "OPEN →",
    locate: "LOCATE",
    selectHint: "↑↓ SELECT",
    openHint: "ENTER OPEN / TRAVEL",
    locateHint: "SHIFT+ENTER LOCATE",
    closeHint: "ESC CLOSE",
    personalSignal: "PERSONAL SIGNAL",
    journeyComplete: "JOURNEY COMPLETE",
    guidedJourney: "GUIDED JOURNEY",
    stop: "STOP",
    prev: "← PREV",
    resume: "RESUME",
    pause: "PAUSE",
    close: "CLOSE",
    done: "DONE",
    next: "NEXT →",
    completeMode: "COMPLETE · NAVIGATION REMAINS AVAILABLE",
    reducedMode: "REDUCED MOTION · MANUAL ADVANCE",
    pausedMode: "PAUSED · NAVIGATION REMAINS AVAILABLE",
    dwellingMode: "DWELLING · AUTO ADVANCE AFTER ARRIVAL",
    settlingMode: "SETTLING · AUTO ADVANCE WAITS FOR ARRIVAL",
    stopJourney: "Stop guided journey",
    routeInterrupted: "ROUTE INTERRUPTED",
    routeFailure:
      "The universe camera could not complete this route. Retry keeps the same destination.",
    retry: "RETRY",
    dismiss: "DISMISS",
    arrived: "ARRIVED",
    located: "LOCATED",
    navigating: "NAVIGATING",
    heroEyebrow: "PERSONAL UNIVERSE // GALACTIC INDEX",
    heroTitle: "A living map of observed and imagined worlds.",
    systemWord: "SYSTEM",
    worlds: "worlds",
    personalSignalsDetected: "personal signals detected",
    personalSignalDetected: "personal signal detected",
    linkedWorldHighlighted: "the linked world is highlighted.",
    selectPlanet:
      "Select a planet to approach it. Ordinary worlds remain orbital; Hero worlds may continue below the clouds.",
    contentSignal: "PERSONAL SIGNAL",
    worldSignal: "WORLD SIGNAL",
    heroSurface: "HERO WORLD // SURFACE MODULE",
    surfaceDescription:
      "Custom surfaces are overrides. The procedural universe does not require every generated planet to carry a handcrafted world.",
    lockAcquired: "LOCK ACQUIRED",
    orbit: "ORBIT",
    scanMode: "SCAN MODE",
    atmosphericEntry: "ATMOSPHERIC ENTRY",
    unresolvedSystem: "UNRESOLVED SYSTEM",
    unresolvedWorld: "UNRESOLVED WORLD",
    systemUnavailable: "system data unavailable",
    planetUnavailable: "planet data unavailable",
    observed: "observed",
    hero: "hero",
    procedural: "procedural",
    surveyMarkers: "survey markers / observed + procedural",
    couldNotOpen: "Could not open {title}. Try again.",
    couldNotLocate: "Could not locate {title}. Try again.",
    locateInGalaxy: "Locate {title} in galaxy",
  },
  zh: {
    open: "展开",
    hide: "收起",
    currentLayer: "当前层级",
    soundOff: "声音：关",
    soundOn: "声音：开",
    quality: "画质",
    auto: "自动",
    high: "高",
    low: "低",
    searchPlaces: "搜索 / 地点",
    returnGalaxy: "← 返回银河",
    returning: "正在返回…",
    returnSystem: "← 返回恒星系",
    universeNavigator: "宇宙导航",
    navigationKicker: "YEIS 导航 // 搜索 + 地点",
    closeNavigator: "关闭宇宙导航",
    searchPlaceholder: "搜索个人信号、行星、恒星、天体地标、星系…",
    searchUniverse: "搜索宇宙",
    searchResults: "搜索结果",
    placesDestinations: "地点 / 目的地",
    scanning: "扫描中…",
    destinations: "个目的地",
    guidedJourneys: "引导旅程",
    featuredJourney: "精选旅程",
    projectsJourney: "项目旅程",
    researchJourney: "研究旅程",
    stops: "站",
    noSignalsYet: "暂无信号",
    scanningDestinations: "正在扫描目的地…",
    navigationUnavailable: "YEIS 导航索引当前不可用。",
    noDestination: "没有找到匹配的目的地。",
    traveling: "航行中…",
    opening: "打开中…",
    locating: "定位中…",
    active: "当前",
    travel: "前往 →",
    openAction: "打开 →",
    locate: "定位",
    selectHint: "↑↓ 选择",
    openHint: "ENTER 打开 / 前往",
    locateHint: "SHIFT+ENTER 定位",
    closeHint: "ESC 关闭",
    personalSignal: "个人信号",
    journeyComplete: "旅程完成",
    guidedJourney: "引导旅程",
    stop: "停止",
    prev: "← 上一站",
    resume: "继续",
    pause: "暂停",
    close: "关闭",
    done: "完成",
    next: "下一站 →",
    completeMode: "已完成 · 仍可自由导航",
    reducedMode: "减少动态效果 · 手动前进",
    pausedMode: "已暂停 · 仍可自由导航",
    dwellingMode: "停留中 · 到达后自动前进",
    settlingMode: "等待到达 · 到达后才开始计时",
    stopJourney: "停止引导旅程",
    routeInterrupted: "路线中断",
    routeFailure: "宇宙相机未能完成这条路线。重试会保留同一目的地。",
    retry: "重试",
    dismiss: "关闭",
    arrived: "已到达",
    located: "已定位",
    navigating: "航行中",
    heroEyebrow: "个人宇宙 // 银河索引",
    heroTitle: "一张连接真实观测与想象世界的动态地图。",
    systemWord: "恒星系",
    worlds: "个世界",
    personalSignalsDetected: "个个人信号已发现",
    personalSignalDetected: "个个人信号已发现",
    linkedWorldHighlighted: "关联世界已高亮。",
    selectPlanet:
      "选择一颗行星接近。普通世界停留在轨道层；Hero 世界可以继续深入云层之下。",
    contentSignal: "个人信号",
    worldSignal: "世界信号",
    heroSurface: "HERO 世界 // 地表模块",
    surfaceDescription:
      "自定义地表只作为覆盖层存在；程序化宇宙不要求每颗生成行星都拥有手工制作的世界。",
    lockAcquired: "已锁定",
    orbit: "轨道",
    scanMode: "扫描模式",
    atmosphericEntry: "进入大气层",
    unresolvedSystem: "未解析恒星系",
    unresolvedWorld: "未解析世界",
    systemUnavailable: "恒星系数据不可用",
    planetUnavailable: "行星数据不可用",
    observed: "已观测",
    hero: "Hero",
    procedural: "程序化",
    surveyMarkers: "个勘测标记 / 观测 + 程序化",
    couldNotOpen: "无法打开 {title}，请重试。",
    couldNotLocate: "无法定位 {title}，请重试。",
    locateInGalaxy: "在银河中定位 {title}",
  },
} as const;

export type ProductTextKey = keyof typeof TEXT.en;

export function text(
  locale: ProductLocale,
  key: ProductTextKey,
  params?: Record<string, string | number>,
): string {
  let value: string = TEXT[locale][key];
  if (params) {
    for (const [name, replacement] of Object.entries(params)) {
      value = value.split(`{${name}}`).join(String(replacement));
    }
  }
  return value;
}

export function detectProductLocale(): ProductLocale {
  if (typeof window === "undefined") return "en";
  try {
    const query = new URLSearchParams(window.location.search).get("lang");
    if (query === "zh" || query === "en") return query;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "zh" || saved === "en") return saved;
  } catch {
    // Storage may be unavailable in privacy modes.
  }

  const languages = navigator.languages?.length
    ? navigator.languages
    : [navigator.language];
  return languages.some((language) =>
    language.toLowerCase().startsWith("zh"),
  )
    ? "zh"
    : "en";
}

export function applyProductLocale(locale: ProductLocale): void {
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    document.documentElement.dataset.universeLocale = locale;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Preference persistence is best-effort.
  }
}

export function phaseLabel(
  locale: ProductLocale,
  phase: UniversePhase,
): string {
  const labels: Record<ProductLocale, Record<UniversePhase, string>> = {
    en: {
      galaxy: "GALACTIC OVERVIEW",
      system: "STELLAR SYSTEM",
      approach: "INTERPLANETARY APPROACH",
      orbit: "LOW ORBIT",
      atmosphere: "ATMOSPHERIC ENTRY",
      surface: "SURFACE",
      returning: "RETURN VECTOR",
    },
    zh: {
      galaxy: "银河总览",
      system: "恒星系",
      approach: "行星际接近",
      orbit: "低轨道",
      atmosphere: "进入大气层",
      surface: "地表",
      returning: "返回航线",
    },
  };
  return labels[locale][phase];
}

const GROUP_ZH: Record<UniverseNavigationGroup, string> = {
  "personal-signals": "个人信号",
  featured: "精选",
  projects: "项目",
  research: "研究",
  experience: "经历",
  artifacts: "作品",
  notes: "笔记",
  hero: "Hero 世界",
  "observed-hosts": "已观测系外行星宿主星",
  exoplanets: "已观测系外行星",
  bodies: "行星与天体",
  stars: "恒星",
  "black-holes": "黑洞",
  "deep-sky": "星云、星团与深空地标",
  galaxies: "星系",
};

export function navigationGroupLabel(
  locale: ProductLocale,
  group: UniverseNavigationGroup,
  englishFallback: string,
): string {
  return locale === "zh" ? GROUP_ZH[group] : englishFallback;
}

const KIND_ZH: Partial<Record<UniverseNavigationKind | UniverseContentKind, string>> = {
  personal: "个人",
  project: "项目",
  research: "研究",
  experience: "经历",
  artifact: "作品",
  note: "笔记",
  featured: "精选",
  hero: "Hero",
  body: "天体",
  observed: "已观测",
  exoplanet: "系外行星",
  star: "恒星",
  blackhole: "黑洞",
  landmark: "地标",
  galaxy: "星系",
};

export function kindLabel(locale: ProductLocale, kind: string): string {
  if (locale === "en") return kind.toUpperCase();
  return KIND_ZH[kind as keyof typeof KIND_ZH] ?? kind;
}

const NAME_ZH: Record<string, string> = {
  "MILKY WAY": "银河系",
  "Milky Way": "银河系",
  "Solar System": "太阳系",
  Sun: "太阳",
  Earth: "地球",
  Moon: "月球",
  Mars: "火星",
  Jupiter: "木星",
  Saturn: "土星",
  Uranus: "天王星",
  Neptune: "海王星",
  Pluto: "冥王星",
  Europa: "欧罗巴",
  Io: "木卫一",
  Titan: "泰坦",
  Enceladus: "土卫二",
  Triton: "海卫一",
};

export function astronomicalName(
  locale: ProductLocale,
  name: string,
): string {
  return locale === "zh" ? NAME_ZH[name] ?? name : name;
}

const DETAIL_REPLACEMENTS: Array<[string, string]> = [
  ["OBSERVED EXOPLANET", "已观测系外行星"],
  ["OBSERVED HOST", "已观测宿主星"],
  ["NASA EXOPLANET ARCHIVE", "NASA 系外行星档案"],
  ["CURRENT SYSTEM", "当前恒星系"],
  ["HOME SYSTEM", "本地恒星系"],
  ["HERO WORLD", "HERO 世界"],
  ["BLACK HOLE", "黑洞"],
  ["YEIS PLACE", "YEIS 地点"],
  ["STELLAR LANDMARK", "恒星地标"],
  ["DEEP-SKY PLACE", "深空地点"],
  ["GALAXY", "星系"],
  ["HOME", "本地"],
  ["PLANET", "行星"],
  ["STAR", "恒星"],
  ["MOON", "卫星"],
  ["SPACECRAFT", "航天器"],
];

export function navigationDetail(
  locale: ProductLocale,
  detail: string,
): string {
  if (locale === "en") return detail;
  let localized = detail;
  for (const [source, target] of DETAIL_REPLACEMENTS) {
    localized = localized.replaceAll(source, target);
  }
  return localized;
}

export function journeyTitle(
  locale: ProductLocale,
  title: string,
): string {
  if (locale === "en") return title;
  if (title === "Featured Journey") return TEXT.zh.featuredJourney;
  if (title === "Projects Journey") return TEXT.zh.projectsJourney;
  if (title === "Research Journey") return TEXT.zh.researchJourney;
  return title;
}

export function archetypeLabel(locale: ProductLocale, archetype: string): string {
  if (locale === "en") return archetype.replace("_", " ");
  const labels: Record<string, string> = {
    ocean: "海洋",
    temperate: "温带",
    desert: "沙漠",
    rocky: "岩石",
    frozen: "冰冻",
    lava: "熔岩",
    volcanic: "火山",
    gas_giant: "气态巨行星",
    ice_giant: "冰巨行星",
    alien: "异星",
  };
  return labels[archetype] ?? archetype.replace("_", " ");
}
