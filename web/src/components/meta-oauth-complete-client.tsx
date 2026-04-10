"use client";

import { useEffect } from "react";

type PopupPayload = {
  type: "meta-instagram-oauth";
  status: "success" | "error";
  message: string;
  username?: string;
  helpUrl?: string;
};

type MetaOauthCompleteClientProps = {
  status: "success" | "error";
  message: string;
  username?: string;
  helpUrl?: string;
};

export function MetaOauthCompleteClient({
  status,
  message,
  username,
  helpUrl,
}: MetaOauthCompleteClientProps) {
  useEffect(() => {
    const payload: PopupPayload = {
      type: "meta-instagram-oauth",
      status,
      message,
      username,
      helpUrl,
    };

    if (window.opener) {
      window.opener.postMessage(payload, window.location.origin);
      window.setTimeout(() => window.close(), 120);
      return;
    }

    const url = new URL("/cuentas", window.location.origin);
    url.searchParams.set(status, message);
    if (helpUrl) {
      url.searchParams.set("helpUrl", helpUrl);
    }
    window.location.replace(url.toString());
  }, [helpUrl, message, status, username]);

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
