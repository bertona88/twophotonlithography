import type { Metadata } from "next";
import LabInterface from "../lab-interface";
import { pageMetadata } from "../site-config";

export const metadata: Metadata = pageMetadata({
  title: "Interactive Two-Photon Lithography Simulator",
  description:
    "Run an interactive 3D two-photon lithography simulation with optical, scan-path, reaction–diffusion, and development controls.",
  path: "/lab",
});

export default function LabPage() {
  return <LabInterface />;
}
