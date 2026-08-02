import type { Metadata } from "next";

export const SITE_URL = "https://twophotonlithography.com";
export const SITE_NAME = "Two-Photon Lithography Lab";

export function pageMetadata({
  title,
  description,
  path,
  type = "website",
}: {
  title: string;
  description: string;
  path: string;
  type?: "website" | "article";
}): Metadata {
  return {
    title,
    description,
    alternates: {
      canonical: path,
    },
    openGraph: {
      title,
      description,
      url: path,
      siteName: SITE_NAME,
      locale: "en_US",
      type,
      images: [
        {
          url: "/og.png",
          width: 1200,
          height: 630,
          alt: "Two-Photon Lithography Lab — focused light becoming calculated matter",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og.png"],
    },
  };
}

export function absoluteUrl(path: string) {
  return new URL(path, SITE_URL).toString();
}
