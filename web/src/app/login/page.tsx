"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";

function readParam(value: string | null) {
  return value?.trim() ? value : undefined;
}

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | undefined>(
    readParam(searchParams.get("error")),
  );
  const [successMessage, setSuccessMessage] = useState<string | undefined>(
    readParam(searchParams.get("success")),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setErrorMessage(readParam(searchParams.get("error")));
    setSuccessMessage(readParam(searchParams.get("success")));
  }, [searchParams]);

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedEmail = email.trim();

    if (!trimmedEmail || !password) {
      setSuccessMessage(undefined);
      setErrorMessage("Completá email y contraseña.");
      return;
    }

    setIsSubmitting(true);
    setSuccessMessage(undefined);
    setErrorMessage(undefined);

    const { error } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    });

    setIsSubmitting(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <span className="eyebrow">Acceso</span>
        <h1>Entrá al panel web</h1>
        <p className="auth-copy">
          Next.js 14, Supabase Auth y un dashboard oscuro pensado para operar
          inbox, cuentas y automatizaciones desde un solo lugar.
        </p>

        {errorMessage ? <div className="feedback error">{errorMessage}</div> : null}
        {successMessage ? <div className="feedback success">{successMessage}</div> : null}

        <form onSubmit={handleSubmit} className="form-stack">
          <div className="field">
            <label className="field-label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              className="text-input"
              placeholder="owner@instacli.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="password">
              Contraseña
            </label>
            <input
              id="password"
              name="password"
              type="password"
              className="text-input"
              placeholder="********"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>

          <button type="submit" className="button button-primary" disabled={isSubmitting}>
            {isSubmitting ? "Ingresando..." : "Ingresar"}
          </button>
        </form>

        <p className="auth-footer">
          Alta de usuarios en{" "}
          <Link href="/registro">
            <code>/registro</code>
          </Link>{" "}
          para owners.
        </p>
      </section>
    </main>
  );
}
