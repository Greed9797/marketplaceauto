"use client";

import { Pencil, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";

import {
  deleteWorkspaceAction,
  updateWorkspaceSettingsAction,
} from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type WorkspaceRowActionsProps = {
  workspaceId: string;
  name: string;
  canEdit: boolean;
  canDelete: boolean;
};

export function WorkspaceRowActions({
  workspaceId,
  name,
  canEdit,
  canDelete,
}: WorkspaceRowActionsProps) {
  const [editing, setEditing] = useState(false);
  const confirmRef = useRef<HTMLInputElement>(null);

  if (editing) {
    return (
      <form
        action={updateWorkspaceSettingsAction}
        className="flex items-center justify-end gap-2"
      >
        <input name="workspaceId" type="hidden" value={workspaceId} />
        <Input
          aria-label="Novo nome do workspace"
          className="h-9 w-44"
          defaultValue={name}
          name="name"
          required
        />
        <Button size="sm" type="submit">
          Salvar
        </Button>
        <Button
          aria-label="Cancelar edição"
          onClick={() => setEditing(false)}
          size="sm"
          type="button"
          variant="secondary"
        >
          <X aria-hidden className="size-4" />
        </Button>
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {canEdit ? (
        <Button
          onClick={() => setEditing(true)}
          size="sm"
          type="button"
          variant="secondary"
        >
          <Pencil aria-hidden className="size-4" />
          Editar
        </Button>
      ) : null}

      {canDelete ? (
        <form
          action={deleteWorkspaceAction}
          onSubmit={(event) => {
            const typed = window.prompt(
              `Excluir "${name}" apaga TODOS os dados da marca (conectores, pedidos, métricas, membros) e é irreversível.\n\nDigite o nome da marca para confirmar:`,
            );
            if (typed === null) {
              event.preventDefault();
              return;
            }
            if (confirmRef.current) {
              confirmRef.current.value = typed;
            }
          }}
        >
          <input name="workspaceId" type="hidden" value={workspaceId} />
          <input name="confirmName" ref={confirmRef} type="hidden" />
          <Button size="sm" type="submit" variant="destructive">
            <Trash2 aria-hidden className="size-4" />
            Excluir
          </Button>
        </form>
      ) : null}
    </div>
  );
}
