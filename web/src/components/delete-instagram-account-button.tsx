"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type DeleteInstagramAccountButtonProps = {
  accountId: string;
  username: string;
};

export function DeleteInstagramAccountButton({
  accountId,
  username,
}: DeleteInstagramAccountButtonProps) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function handleDelete() {
    const confirmed = window.confirm(
      `Vas a eliminar @${username}. Tambien se borraran conversaciones y mensajes guardados de esa cuenta en Supabase. Esta accion no se puede deshacer.`,
    );

    if (!confirmed) {
      return;
    }

    setIsDeleting(true);
    setFeedback(null);

    try {
      const response = await fetch(`/api/instagram/accounts/${accountId}`, {
        method: "DELETE",
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; message?: string; error?: string }
        | null;

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "No pudimos eliminar la cuenta.");
      }

      setFeedback(payload.message || "Cuenta eliminada correctamente.");
      router.refresh();
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "No pudimos eliminar la cuenta.",
      );
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="account-actions">
      <button
        type="button"
        className="button button-danger"
        onClick={handleDelete}
        disabled={isDeleting}
      >
        {isDeleting ? "Eliminando..." : "Eliminar cuenta"}
      </button>
      {feedback ? <span className="status-copy">{feedback}</span> : null}
    </div>
  );
}
