import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const portfolioSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  kind: z.enum(["project", "experience", "research", "artifact", "note"]),
  status: z.enum(["active", "complete", "archived"]).default("active"),
  importance: z.number().int().min(1).max(5).default(3),
  tags: z.array(z.string()).default([]),
  featured: z.boolean().default(false),
  placement: z.enum(["auto", "hero", "pinned"]).default("auto"),
  placementKey: z.string().min(1).optional(),
  starId: z.string().min(1).optional(),
  href: z.url().optional(),
  draft: z.boolean().default(false),
}).superRefine((data, ctx) => {
  if (data.placement === "pinned" && !data.starId) {
    ctx.addIssue({
      code: "custom",
      path: ["starId"],
      message: 'starId is required when placement is "pinned".',
    });
  }

  if (data.placement !== "pinned" && data.starId) {
    ctx.addIssue({
      code: "custom",
      path: ["starId"],
      message: 'starId is only valid when placement is "pinned".',
    });
  }
});

const portfolio = defineCollection({
  loader: glob({
    base: "./src/content/portfolio",
    pattern: "**/*.{md,mdx}",
  }),
  schema: portfolioSchema,
});

export const collections = { portfolio };
