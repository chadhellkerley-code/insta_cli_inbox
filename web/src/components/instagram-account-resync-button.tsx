"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type InstagramAccountResyncButtonProps = {
  accountId: string;
};

export function InstagramAccountResyncButton({
  accountId,
}: InstagramAccountResyncButtonProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [tone, setTone] = useState<"success" | "error">("success");

  async function resyncAccount() {
    setIsSubmitting(true);
    setFeedback(null);

    try {
      const response = await fetch(`/api/instagram/accounts/${accountId}/subscription`, {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as
        | { message?: string; error?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error || "No pudimos revalidar la cuenta.");
      }

      setTone("success");
      setFeedback(payload?.message || "Cuenta revalidada.");
      router.refresh();
    } catch (error) {
      setTone("error");
      setFeedback(
        error instanceof Error ? error.message : "No pudimos revalidar la cuenta.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="connect-action">
      <button
        type="button"
        className="button button-secondary"
        disabled={isSubmitting}
        onClick={() => void resyncAccount()}
      >
        {isSubmitting ? "Revalidando..." : "Revalidar conexion"}
      </button>
      {feedback ? (
        <div className={tone === "success" ? "feedback success" : "feedback error"}>
          <p>{feedback}</p>
        </div>
      ) : null}
    </div>
  );
}
