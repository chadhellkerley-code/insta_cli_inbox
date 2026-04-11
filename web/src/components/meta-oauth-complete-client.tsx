"use client";

import { useEffect } from "react";

type MetaOauthCompleteClientProps = {
  status: "success" | "error";
  message: string;
  helpUrl?: string;
};

export function MetaOauthCompleteClient({
  status,
  message,
  helpUrl,
}: MetaOauthCompleteClientProps) {
  useEffect(() => {
    const url = new URL("/cuentas", window.location.origin);
    url.searchParams.set(status, message);
    if (helpUrl) {
      url.searchParams.set("helpUrl", helpUrl);
    }
    window.location.replace(url.toString());
  }, [helpUrl, message, status]);

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <span className="eyebrow">Instagram</span>
        <h1>{status === "success" ? "Cuenta conectada" : "Conexion cancelada"}</h1>
        <p className="auth-copy">{message}</p>
      </section>
    </main>
  );
}
