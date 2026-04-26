"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";

function readParam(value: string | null) {
  return value?.trim() ? value : undefined;
}

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [successMessage, setSuccessMessage] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    setErrorMessage(readParam(params.get("error")));
    setSuccessMessage(readParam(params.get("success")));
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadSession() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (isMounted && user) {
        router.replace("/dashboard");
      }
    }

    void loadSession();

    return () => {
      isMounted = false;
    };
  }, [router, supabase]);

  async function handleGoogleLogin() {
    setIsSubmitting(true);
    setSuccessMessage(undefined);
    setErrorMessage(undefined);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/supabase/callback`,
      },
    });

    if (error) {
      setIsSubmitting(false);
      setErrorMessage(error.message);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-brand">
          <span className="auth-logo" aria-hidden="true">
            IC
          </span>
          <div>
            <strong>Insta CLI Inbox</strong>
            <span>Instagram CRM</span>
          </div>
        </div>

        <div className="auth-heading">
          <span className="eyebrow">Acceso</span>
          <h1>Entrá a tu panel</h1>
          <p className="auth-copy">
            Inbox, cuentas y automatizaciones en un solo espacio privado.
          </p>
        </div>

        {errorMessage ? <div className="feedback error">{errorMessage}</div> : null}
        {successMessage ? <div className="feedback success">{successMessage}</div> : null}

        <button
          type="button"
          className="button button-secondary google-auth-button"
          disabled={isSubmitting}
          onClick={handleGoogleLogin}
        >
          <span className="google-mark" aria-hidden="true">
            G
          </span>
          {isSubmitting ? "Redirigiendo..." : "Continuar con Google"}
        </button>

        <div className="auth-proof" aria-label="Estado del acceso">
          <span>Google OAuth</span>
          <span>Datos aislados</span>
          <span>Meta API</span>
        </div>
      </section>
    </main>
  );
}
