import { DeleteInstagramAccountButton } from "@/components/delete-instagram-account-button";
import Link from "next/link";

import { MetaConnectButton } from "@/components/meta-connect-button";
import {
  getInstagramAccountStatusCopy,
  getInstagramAccountStatusLabel,
  isFallbackInstagramUsername,
  isInstagramUsernamePending,
} from "@/lib/meta/account-status";
import { formatDateTime, formatRelativeTime, loadOwnedAccounts, requireUserContext } from "@/lib/app-data";

type SearchParams = {
  error?: string | string[];
  success?: string | string[];
  helpUrl?: string | string[];
};

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CuentasPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const { supabase, user } = await requireUserContext();

  console.log("[cuentas-page] current user", { userId: user.id });

  const accounts = await loadOwnedAccounts(supabase, user.id);

  console.log("[cuentas-page] loaded accounts", {
    userId: user.id,
    count: accounts.length,
    accounts,
  });

  const error = readParam(searchParams?.error);
  const success = readParam(searchParams?.success);
  const helpUrl = readParam(searchParams?.helpUrl);

  return (
    <div className="page-stack accounts-page">
      <section className="page-header">
        <div>
          <h1>CONECTAR CUENTAS DE INSTAGRAM</h1>
          <p className="page-copy">
            Conecta una cuenta directo desde Instagram y el sistema intenta guardar token
            long-lived (60 dias) sin depender de Facebook Page.
          </p>
        </div>
        <div className="form-stack">
          <MetaConnectButton
            buttonLabel="Instagram directo (token 60 dias)"
            startPath="/api/instagram/oauth/start"
            redirectingLabel="Redirigiendo"
          />
          <MetaConnectButton
            buttonLabel="Facebook / Meta (como antes)"
            startPath="/api/meta/oauth/start"
            redirectingLabel="Redirigiendo"
          />
        </div>
      </section>

      {error ? <div className="feedback error">{error}</div> : null}
      {success ? <div className="feedback success">{success}</div> : null}
      {helpUrl ? (
        <div className="feedback error">
          <p>La cuenta debe estar en modo Professional (Business o Creator).</p>
          <p className="feedback-link-row">
            <Link href={helpUrl} target="_blank" rel="noreferrer">
              Ver instrucciones oficiales de Instagram
            </Link>
          </p>
        </div>
      ) : null}

      <section className="list-card">
        <span className="eyebrow">Tus cuentas</span>
        <h2>Estado actual</h2>

        {accounts.length === 0 ? (
          <div className="empty-state compact">
            <strong>No hay cuentas conectadas aun</strong>
            <p>Conecta la primera cuenta para empezar a recibir mensajes en el inbox unificado.</p>
          </div>
        ) : (
          <div className="stack-list">
            {accounts.map((account) => {
              const fallbackUsername = isFallbackInstagramUsername(account.username);
              const usernamePending = isInstagramUsernamePending(account.username);
              const accountTitle = fallbackUsername
                ? "Cuenta conectada"
                : `@${account.username}`;
              const accountSecondaryLine = fallbackUsername
                ? `ID de Instagram: ${account.instagram_account_id}`
                : account.name || `ID de Instagram: ${account.instagram_account_id}`;
              const accountStatusLabel = usernamePending
                ? "Conectada · username pendiente"
                : getInstagramAccountStatusLabel(account);

              return (
                <div key={account.id} className="account-row">
                  <div className="account-avatar" aria-hidden="true">
                    {account.profile_picture_url ? (
                      <div
                        className="account-avatar-image"
                        style={{ backgroundImage: `url(${account.profile_picture_url})` }}
                      />
                    ) : (
                      <span>{account.username.slice(0, 1).toUpperCase()}</span>
                    )}
                  </div>

                  <div className="account-copy">
                    <strong>{accountTitle}</strong>
                    <p>{accountSecondaryLine}</p>
                    <p>
                      Tipo:{" "}
                      <code>
                        {account.account_type || "Sin sincronizar"}
                      </code>
                    </p>
                    {usernamePending ? (
                      <p className="status-copy">
                        El username sigue pendiente. La readiness real depende de webhook o mensajeria, no del username.
                      </p>
                    ) : null}
                    <p>
                      Conectada {formatDateTime(account.connected_at)} - token vence{" "}
                      {account.token_expires_at
                        ? formatRelativeTime(account.token_expires_at)
                        : "sin dato"}
                    </p>
                    <p>
                      Token: <code>{account.token_lifecycle || "sin dato"}</code> - ultimo OAuth{" "}
                      {account.last_oauth_at
                        ? formatRelativeTime(account.last_oauth_at)
                        : "sin dato"}
                    </p>
                  </div>

                  <div className="account-meta">
                    <span className="pill">{accountStatusLabel}</span>
                    <span className="status-copy">
                      {getInstagramAccountStatusCopy({
                        account,
                        lastWebhookAt: account.last_webhook_at,
                        formatRelativeTime,
                      })}
                    </span>
                    <DeleteInstagramAccountButton
                      accountId={account.id}
                      username={account.username}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

    </div>
  );
}
