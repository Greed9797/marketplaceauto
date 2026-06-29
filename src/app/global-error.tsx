"use client";

import NextError from "next/error";

type GlobalErrorProps = {
  error: Error & { digest?: string };
};

export default function GlobalError({ error }: GlobalErrorProps) {
  void error;

  return (
    <html lang="pt-BR">
      <body>
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
