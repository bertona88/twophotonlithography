import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Two-Photon Lithography Lab",
    short_name: "Two-Photon Lab",
    description:
      "An interactive field guide and mechanistic simulator for two-photon lithography.",
    start_url: "/",
    display: "standalone",
    background_color: "#070910",
    theme_color: "#070910",
    icons: [
      {
        src: "/favicon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
