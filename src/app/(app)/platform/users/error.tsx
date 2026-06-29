"use client";

import { SegmentError } from "@/components/errors/segment-error";

export default function PlatformUsersError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <SegmentError
      {...props}
      boundary="platform-users"
      title="Não foi possível carregar os usuários."
    />
  );
}
