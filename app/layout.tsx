import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import { SITE_NAME, SITE_URL } from "./site-config";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Two-Photon Lithography Simulator | Interactive 3D Lab",
  description:
    "Explore two-photon lithography through an interactive 3D simulator connecting femtosecond focusing, scan paths, reaction–diffusion chemistry, and development.",
  applicationName: SITE_NAME,
  category: "science and education",
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    title: "Two-Photon Lithography Simulator | Interactive 3D Lab",
    description:
      "Explore focused light, reaction–diffusion chemistry, and development in an interactive two-photon lithography laboratory.",
    url: "/",
    siteName: SITE_NAME,
    locale: "en_US",
    type: "website",
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
    title: "Two-Photon Lithography Simulator | Interactive 3D Lab",
    description:
      "Explore focused light, reaction–diffusion chemistry, and development in an interactive 3D laboratory.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#070910",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
