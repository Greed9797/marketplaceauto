"use client";

import { SegmentError } from "@/components/errors/segment-error";

export default function WorkspaceMembersError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <SegmentError
      {...props}
      boundary="workspace-members"
      title="Não foi possível carregar os membros."
    />
  );
}
