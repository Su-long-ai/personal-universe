import type { ProductLocale } from "../universe/locale";

const siteBase = import.meta.env.BASE_URL.replace(/\/+$/, "");

export function portfolioPath(locale: ProductLocale, id?: string): string {
  const route = siteBase + (locale === "zh" ? "/zh/portfolio/" : "/portfolio/");
  return id ? route + id.split("/").map(encodeURIComponent).join("/") + "/" : route;
}

export function universePath(locale: ProductLocale, id?: string): string {
  const query = new URLSearchParams({ lang: locale });
  if (id) query.set("destination", "personal:" + id);
  return siteBase + "/?" + query.toString();
}
