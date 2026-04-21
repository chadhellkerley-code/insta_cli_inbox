"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type ConnectManualPayload = {
  ok?: boolean;
  error?: string;
  message?: string;
};

export function ManualInstagramAccountForm() {
  const router = useRouter();
  const [accessToken, setAccessToken] = useState("");
  const [instagramAccountId, setInstagramAccountId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackTone, setFeedbackTone] = useState<"success" | "error">("success");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedToken = accessToken.trim();
    const normalizedAccountId = instagramAccountId.trim();

    if (!normalizedToken) {
      setFeedbackTone("error");
      setFeedback("Pega un access token valido para conectar la cuenta.");
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/instagram/accounts/manual", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          accessToken: normalizedToken,
          instagramAccountId: normalizedAccountId || undefined,
        }),
      });
      const payload = (await response.json().catch(() => null)) as ConnectManualPayload | null;

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "No pudimos conectar la cuenta manualmente.");
      }

      setFeedbackTone("success");
      setFeedback(payload.message || "Cuenta conectada correctamente.");
      setAccessToken("");
      setInstagramAccountId("");
      router.refresh();
    } catch (error) {
      setFeedbackTone("error");
      setFeedback(
        error instanceof Error
          ? error.message
          : "No pudimos conectar la cuenta manualmente.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="list-card">
      <span className="eyebrow">Alta manual</span>
      <h2>Conectar con token long-lived</h2>
      <p className="status-copy">
        Usa este formulario si la cuenta no aparece vinculada en Meta Business. El token
        se guarda para operar mensajeria desde el CRM.
      </p>

      <form className="form-stack" onSubmit={handleSubmit}>
        <div className="field">
          <label className="field-label" htmlFor="manual-access-token">
            Access token (long-lived)
          </label>
          <input
            id="manual-access-token"
            name="accessToken"
            type="password"
            className="text-input"
            value={accessToken}
            onChange={(event) => setAccessToken(event.target.value)}
            placeholder="IGQVJ..."
            autoComplete="off"
            required
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="manual-instagram-account-id">
            Instagram account ID (opcional)
          </label>
          <input
            id="manual-instagram-account-id"
            name="instagramAccountId"
            type="text"
            className="text-input"
            value={instagramAccountId}
            onChange={(event) => setInstagramAccountId(event.target.value)}
            placeholder="17841400000000000"
            autoComplete="off"
          />
        </div>

        <button type="submit" className="button button-primary" disabled={isSubmitting}>
          {isSubmitting ? "Conectando..." : "Agregar cuenta con token"}
        </button>
      </form>

      {feedback ? (
        <div className={`feedback ${feedbackTone === "error" ? "error" : "success"}`}>
          {feedback}
        </div>
      ) : null}
    </section>
  );
}
