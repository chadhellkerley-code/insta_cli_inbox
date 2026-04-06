import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

type SearchParams = {
  error?: string | string[];
  success?: string | string[];
};

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function loginAction(formData: FormData) {
  "use server";

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    redirect("/login?error=Complet%C3%A1 email y contrase%C3%B1a.");
  }

  const supabase = createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/dashboard");
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  const error = readParam(searchParams?.error);
  const success = readParam(searchParams?.success);

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <span className="eyebrow">Acceso</span>
        <h1>Entrá al panel web</h1>
        <p className="auth-copy">
          Next.js 14, Supabase Auth y un dashboard oscuro pensado para operar
          inbox, cuentas y automatizaciones desde un solo lugar.
        </p>

        {error ? <div className="feedback error">{error}</div> : null}
        {success ? <div className="feedback success">{success}</div> : null}

        <form action={loginAction} className="form-stack">
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
              required
            />
          </div>

          <button type="submit" className="button button-primary">
            Ingresar
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
