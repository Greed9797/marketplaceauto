"use client";

import { SegmentError } from "@/components/errors/segment-error";

export default function WorkspaceSettingsError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <SegmentError
      {...props}
      boundary="workspace-settings"
      title="Não foi possível carregar os ajustes do workspace."
    />
  );
}
