"use client";

import { SegmentError } from "@/components/errors/segment-error";

export default function ProfileError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <SegmentError
      {...props}
      boundary="profile"
      title="Não foi possível carregar o perfil."
    />
  );
}
