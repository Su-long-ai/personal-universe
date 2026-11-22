import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const portfolio = defineCollection({
  loader: glob({
    base: "./src/content/portfolio",
    pattern: "**/*.{md,mdx}",
  }),
  schema: z.object({
    title: z.string().min(1),
    summary: z.string().min(1),
    kind: z.enum(["project", "experience", "research", "artifact", "note"]),
    status: z.enum(["active", "complete", "archived"]).default("active"),
    importance: z.number().int().min(1).max(5).default(3),
    tags: z.array(z.string()).default([]),
    featured: z.boolean().default(false),
    placement: z.enum(["auto", "hero"]).default("auto"),
    href: z.url().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { portfolio };
