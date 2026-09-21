import { pageMetadata } from "../site-config";
import { SiteHeader, SiteFooter } from "../site-chrome";
import CarbonizationLab from "./carbonization-lab";

export const metadata = pageMetadata({
  title: "Carbonization Lab — Radial Transformation Benchmark",
  description: "Explore mass-conserving reactions, volatile escape and evolving carbon-network state in a Rust/Wasm radial specimen benchmark.",
  path: "/carbonization",
});

export default function CarbonizationPage() {
  return <><SiteHeader /><CarbonizationLab /><SiteFooter /></>;
}
