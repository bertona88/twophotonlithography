import type { Metadata } from "next";
import LabInterface from "../lab-interface";
import {
  opticalSetupImportNotice,
  parseOpticalSetupHandoff,
} from "../opticalsetup-handoff";
import { pageMetadata } from "../site-config";

export const metadata: Metadata = pageMetadata({
  title: "Interactive Two-Photon Lithography Simulator",
  description:
    "Run an interactive 3D two-photon lithography simulation with optical, scan-path, reaction–diffusion, and development controls.",
  path: "/lab",
});

type LabPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LabPage({ searchParams }: LabPageProps) {
  const handoff = parseOpticalSetupHandoff((await searchParams) ?? {});
  return (
    <LabInterface
      importedFromOpticalSetup={Boolean(handoff)}
      initialNotice={opticalSetupImportNotice(handoff)}
      initialParams={handoff?.params}
    />
  );
}
