import { pageMetadata } from "../site-config";
import { SiteHeader, SiteFooter } from "../site-chrome";
import CarbonizationLab from "./carbonization-lab";

export const metadata = pageMetadata({
  title: "Carbonization Lab — Finite-Strain Strut Benchmark",
  description: "Explore mass-conserving carbonization, finite-strain shrinkage, axial supports and stress in an uncalibrated Rust/Wasm long-cylinder benchmark.",
  path: "/carbonization",
});

export default function CarbonizationPage() {
  return <><SiteHeader /><CarbonizationLab /><SiteFooter /></>;
}
