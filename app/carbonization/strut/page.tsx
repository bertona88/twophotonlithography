import { pageMetadata } from "../../site-config";
import { SiteHeader, SiteFooter } from "../../site-chrome";
import StrutLab from "../strut-lab";

export const metadata = pageMetadata({
  title: "Carbonization Lab — Radial Strut Benchmark",
  description: "Inspect the radial long-cylinder verification benchmark for finite-strain carbonization and volatile transport.",
  path: "/carbonization/strut",
});

export default function StrutPage() { return <><SiteHeader /><StrutLab /><SiteFooter /></>; }
