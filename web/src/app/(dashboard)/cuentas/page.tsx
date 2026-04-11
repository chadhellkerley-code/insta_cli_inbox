import { DeleteInstagramAccountButton } from "@/components/delete-instagram-account-button";
import { InstagramWebhookSubscriptionSync } from "@/components/instagram-webhook-subscription-sync";
import Link from "next/link";

import { MetaConnectButton } from "@/components/meta-connect-button";
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
  const accounts = await loadOwnedAccounts(supabase, user.id);
  const error = readParam(searchParams?.error);
  const success = readParam(searchParams?.success);
  const helpUrl = readParam(searchParams?.helpUrl);

  const recentlyActiveAccounts = accounts.filter((account) => {
    if (!account.last_webhook_at) {
      return false;
    }

    return Date.now() - new Date(account.last_webhook_at).getTime() < 24 * 60 * 60 * 1000;
  }).length;

  return (
    <div className="page-stack">
      <InstagramWebhookSubscriptionSync
        accounts={accounts.map((account) => ({ id: account.id }))}
      />
      <section className="page-header">
        <div>
          <span className="eyebrow">Cuentas</span>
          <h1>Conecta Instagram con Meta OAuth</h1>
          <p className="page-copy">
            Cada cuenta se conecta con OAuth oficial de Meta y queda lista para
            recibir mensajes por webhook en el inbox unificado.
          </p>
        </div>
        <MetaConnectButton />
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

      <section className="card-grid">
        <article className="metric-card">
          <span>Cuentas conectadas</span>
          <strong>{accounts.length}</strong>
          <p>Disponibles para inbox y automatizaciones.</p>
        </article>
        <article className="metric-card">
          <span>Webhook reciente</span>
          <strong>{recentlyActiveAccounts}</strong>
          <p>Cuentas con eventos recibidos en las ultimas 24 horas.</p>
        </article>
        <article className="metric-card">
          <span>Tipo soportado</span>
          <strong>Professional</strong>
          <p>Solo Business y Creator pueden usar Instagram Graph API.</p>
        </article>
      </section>

      <section className="split-grid">
        <article className="list-card">
          <span className="eyebrow">Conexion</span>
          <h2>Como funciona</h2>
          <div className="stack-list">
            <div className="list-row">
              <div>
                <strong>1. Abrir popup OAuth</strong>
                <p>Meta autoriza la cuenta y devuelve el codigo al callback del CRM.</p>
              </div>
            </div>
            <div className="list-row">
              <div>
                <strong>2. Guardar token y perfil</strong>
                <p>Supabase persiste access token, account id, username y avatar.</p>
              </div>
            </div>
            <div className="list-row">
              <div>
                <strong>3. Escuchar webhook</strong>
                <p>Los mensajes entran por <code>/api/webhook/instagram</code> y se guardan para historial.</p>
              </div>
            </div>
          </div>
        </article>

        <article className="list-card">
          <span className="eyebrow">Requisito</span>
          <h2>Cuenta Professional</h2>
          <p className="page-copy">
            Si la cuenta conectada no es Business o Creator, el popup mostrara el error
            y un enlace directo con las instrucciones oficiales para cambiar el tipo de cuenta.
          </p>
          <p className="page-copy">
            Una vez convertida, basta con repetir la conexion desde este panel.
          </p>
        </article>
      </section>

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
            {accounts.map((account) => (
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
                  <strong>@{account.username}</strong>
                  <p>{account.name || "Cuenta de Instagram conectada"}</p>
                  <p>
                    Tipo: <code>{account.account_type || "sin dato"}</code>
                  </p>
                  <p>
                    Conectada {formatDateTime(account.connected_at)} - token vence{" "}
                    {account.token_expires_at
                      ? formatRelativeTime(account.token_expires_at)
                      : "sin dato"}
                  </p>
                </div>

                <div className="account-meta">
                  <span className="pill">{account.status || "connected"}</span>
                  <span className="status-copy">
                    {account.last_webhook_at
                      ? `Webhook ${formatRelativeTime(account.last_webhook_at)}`
                      : "Sin eventos de webhook todavia"}
                  </span>
                  <DeleteInstagramAccountButton
                    accountId={account.id}
                    username={account.username}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
