import Link from "next/link";
import { redirect } from "next/navigation";

import { loadUserProfile } from "@/lib/app-data";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type SearchParams = {
  error?: string | string[];
  success?: string | string[];
};

type ProfileUpsertPayload = {
  id: string;
  role: string;
  expires_at: string | null;
};

type ProfileUpsertClient = {
  upsert: (
    values: ProfileUpsertPayload,
  ) => Promise<{ error: { message: string } | null }>;
};

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function registerAction(formData: FormData) {
  "use server";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const profile = await loadUserProfile(supabase, user.id);
  if (profile?.role !== "owner") {
    redirect("/dashboard");
  }

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const expiresAt = String(formData.get("expiresAt") ?? "").trim();

  if (!email || !password) {
    redirect("/registro?error=Complet%C3%A1 email y contrase%C3%B1a.");
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (error || !data.user) {
      throw new Error(error?.message ?? "No se pudo crear el usuario.");
    }

    const profilesClient = admin.from("profiles") as unknown as ProfileUpsertClient;
    const { error: profileError } = await profilesClient.upsert({
      id: data.user.id,
      role: "user",
      expires_at: expiresAt || null,
    });

    if (profileError) {
      throw new Error(profileError.message);
    }

    redirect("/registro?success=Usuario creado correctamente.");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "No se pudo crear el usuario.";
    redirect(`/registro?error=${encodeURIComponent(message)}`);
  }
}

export default async function RegistroPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const profile = await loadUserProfile(supabase, user.id);
  if (profile?.role !== "owner") {
    redirect("/dashboard");
  }

  const error = readParam(searchParams?.error);
  const success = readParam(searchParams?.success);

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <span className="eyebrow">Alta de usuarios</span>
        <h1>Registro administrativo</h1>
        <p className="auth-copy">
          Crea usuarios de operación para el panel. Esta pantalla usa la service
          role en el servidor para no romper la sesión del owner actual.
        </p>

        {error ? <div className="feedback error">{error}</div> : null}
        {success ? <div className="feedback success">{success}</div> : null}

        <form action={registerAction} className="form-stack">
          <div className="field">
            <label className="field-label" htmlFor="register-email">
              Email
            </label>
            <input
              id="register-email"
              name="email"
              type="email"
              className="text-input"
              placeholder="agente@instacli.com"
              required
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="register-password">
              Contraseña
            </label>
            <input
              id="register-password"
              name="password"
              type="password"
              className="text-input"
              placeholder="Mínimo recomendado: 8 caracteres"
              required
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="expires-at">
              Expira el
            </label>
            <input
              id="expires-at"
              name="expiresAt"
              type="datetime-local"
              className="text-input"
            />
          </div>

          <button type="submit" className="button button-primary">
            Crear usuario
          </button>
        </form>

        <p className="auth-footer">
          Volver al{" "}
          <Link href="/dashboard">
            <code>/dashboard</code>
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
