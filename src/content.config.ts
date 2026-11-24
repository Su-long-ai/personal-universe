import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const contentIdSchema = z
  .string()
  .min(1)
  .regex(
    /^[a-z0-9][a-z0-9._-]*$/,
    "contentId must use lowercase letters, digits, dot, underscore, or hyphen.",
  );

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use ISO calendar dates (YYYY-MM-DD).");

const localizedCopySchema = z.object({
  title: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
});

const aliasesSchema = z
  .object({
    en: z.array(z.string().min(1)).default([]),
    zh: z.array(z.string().min(1)).default([]),
  })
  .default({ en: [], zh: [] });

const mediaSchema = z.object({
  src: z
    .string()
    .min(1)
    .refine(
      (value) => value.startsWith("/") || /^https?:\/\//.test(value),
      "Media src must be a public root path or http(s) URL.",
    ),
  alt: z.string().min(1),
  kind: z.enum(["image", "video", "audio", "document"]).default("image"),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

const linkSchema = z.object({
  label: z.string().min(1),
  url: z.url(),
});

const surfaceHintSchema = z.object({
  preferredRegion: z.string().min(1).optional(),
  anchorCategory: z
    .enum([
      "project",
      "milestone",
      "artifact",
      "experience",
      "research",
      "note",
      "archive",
    ])
    .optional(),
  cluster: z.string().min(1).optional(),
  order: z.number().int().min(0).optional(),
  featured: z.boolean().optional(),
});

const provenanceSchema = z
  .object({
    kind: z.enum(["authored", "generated", "observed"]).default("authored"),
    source: z.string().min(1).optional(),
  })
  .default({ kind: "authored" });

const relationSchema = z.object({
  type: z.enum(["contains", "related", "continues", "belongs-to"]),
  targetId: contentIdSchema,
});

const portfolioSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    contentId: contentIdSchema,
    title: z.string().min(1),
    summary: z.string().min(1),
    body: z.string().min(1).optional(),
    i18n: z
      .object({
        en: localizedCopySchema.optional(),
        zh: localizedCopySchema.optional(),
      })
      .default({}),
    aliases: aliasesSchema,
    kind: z.enum(["project", "experience", "research", "artifact", "note"]),
    status: z.enum(["active", "complete", "archived"]).default("active"),
    dateStart: dateSchema.optional(),
    dateEnd: dateSchema.optional(),
    importance: z.number().int().min(1).max(5).default(3),
    tags: z.array(z.string().min(1)).default([]),
    featured: z.boolean().default(false),
    signalVisible: z.boolean().default(true),
    placement: z.enum(["auto", "hero", "pinned"]).default("auto"),
    placementKey: z.string().min(1).optional(),
    starId: z.string().min(1).optional(),
    href: z.url().optional(),
    links: z.array(linkSchema).default([]),
    media: z.array(mediaSchema).default([]),
    surface: surfaceHintSchema.optional(),
    provenance: provenanceSchema,
    relations: z.array(relationSchema).default([]),
    journeys: z.array(z.string().min(1)).default([]),
    legacyIds: z.array(contentIdSchema).default([]),
    draft: z.boolean().default(false),
  })
  .superRefine((data, ctx) => {
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

    if (data.dateStart && data.dateEnd && data.dateEnd < data.dateStart) {
      ctx.addIssue({
        code: "custom",
        path: ["dateEnd"],
        message: "dateEnd must not be earlier than dateStart.",
      });
    }

    if (data.legacyIds.includes(data.contentId)) {
      ctx.addIssue({
        code: "custom",
        path: ["legacyIds"],
        message: "legacyIds must not repeat the canonical contentId.",
      });
    }

    if (
      data.provenance.kind !== "authored" &&
      !data.provenance.source?.trim()
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["provenance", "source"],
        message: "generated/observed provenance requires an explicit source.",
      });
    }
  });

const portfolio = defineCollection({
  loader: glob({
    base: "./src/content/portfolio",
    pattern: "**/*.{md,mdx,json}",
    // Keep Astro's framework-level collection identity aligned with the
    // persisted product identity. The fallback exists only so schema errors
    // for missing contentId stay readable; valid records always use contentId.
    generateId: ({ data, entry }) => {
      const contentId =
        typeof data.contentId === "string" ? data.contentId.trim() : "";
      return contentId || entry.replace(/\.(?:md|mdx|json)$/i, "");
    },
  }),
  schema: portfolioSchema,
});

export const collections = { portfolio };
