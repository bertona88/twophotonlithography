import type { MetadataRoute } from "next";
import { absoluteUrl } from "./site-config";

const pages = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/lab", changeFrequency: "weekly", priority: 0.9 },
  { path: "/guides", changeFrequency: "weekly", priority: 0.9 },
  { path: "/guides/two-photon-lithography", changeFrequency: "monthly", priority: 0.9 },
  { path: "/guides/multiphoton-lithography", changeFrequency: "monthly", priority: 0.85 },
  { path: "/guides/direct-laser-writing", changeFrequency: "monthly", priority: 0.8 },
  { path: "/guides/model-space", changeFrequency: "monthly", priority: 0.85 },
  { path: "/guides/parameters", changeFrequency: "weekly", priority: 0.9 },
  { path: "/method", changeFrequency: "monthly", priority: 0.85 },
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return pages.map((page) => ({
    url: absoluteUrl(page.path),
    lastModified: "2026-08-02",
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }));
}
