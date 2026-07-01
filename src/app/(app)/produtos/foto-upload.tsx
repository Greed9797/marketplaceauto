"use client";

import { ImageOff, Loader2, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";

type FotoUploadProps = {
  clienteId?: string;
  value: string;
  onChange: (url: string) => void;
};

/** Uploads a product image to /api/upload and reports back the public URL. */
export function FotoUpload({ clienteId, value, onChange }: FotoUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      if (clienteId) formData.append("clienteId", clienteId);

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      const data = (await response.json().catch(() => null)) as {
        url?: string;
        error?: string;
      } | null;

      if (!response.ok || !data?.url) {
        setError(data?.error ?? "Falha ao enviar imagem");
        return;
      }
      onChange(data.url);
    } catch {
      setError("Falha ao enviar imagem");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="grid gap-2">
      <span className="text-caption text-[var(--text-tertiary)]">
        Foto do produto
      </span>
      <div className="flex items-center gap-3">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt="Pré-visualização da foto do produto"
            className="size-16 shrink-0 rounded-md border border-[var(--border-subtle)] object-cover"
            src={value}
          />
        ) : (
          <span
            aria-hidden
            className="grid size-16 shrink-0 place-items-center rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-tertiary)]"
          >
            <ImageOff className="size-5" />
          </span>
        )}
        <div className="grid gap-1">
          <Button
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            size="sm"
            type="button"
            variant="secondary"
          >
            {uploading ? (
              <Loader2 aria-hidden className="size-3.5 animate-spin" />
            ) : (
              <Upload aria-hidden className="size-3.5" />
            )}
            {uploading ? "Enviando…" : value ? "Trocar foto" : "Enviar foto"}
          </Button>
          {error ? (
            <p className="text-xs text-[var(--danger)]">{error}</p>
          ) : null}
        </div>
      </div>
      <input
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={handleFile}
        ref={inputRef}
        type="file"
      />
    </div>
  );
}
