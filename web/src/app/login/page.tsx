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
        <span className="eyebrow">Acceso</span>
        <h1>Entrá al panel web</h1>
        <p className="auth-copy">
          Accedé con Google. Cada cuenta queda registrada en Supabase y ve solo
          sus cuentas, conversaciones y automatizaciones.
        </p>

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

        <p className="auth-footer">
          Al ingresar se crea tu usuario y tu perfil operativo en Supabase.
        </p>
      </section>
    </main>
  );
}
