"use client";

import { SegmentError } from "@/components/errors/segment-error";

export default function DashboardDetailError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <SegmentError
      {...props}
      boundary="dashboard-detail"
      title="Não foi possível carregar este painel."
    />
  );
}
