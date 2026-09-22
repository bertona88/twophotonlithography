import { pageMetadata } from "../site-config";
import { SiteHeader, SiteFooter } from "../site-chrome";
import CarbonizationLab from "./carbonization-lab";

export const metadata = pageMetadata({
  title: "Carbonization Lab — BCC Foam on a Substrate",
  description: "Explore three-dimensional BCC foam pyrolysis, shrinkage, volatile transport and substrate constraint in a Rust/Wasm tetrahedral benchmark.",
  path: "/carbonization",
});

export default function CarbonizationPage() {
  return <><SiteHeader /><CarbonizationLab /><SiteFooter /></>;
}
