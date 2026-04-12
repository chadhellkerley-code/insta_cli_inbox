import { DeleteInstagramAccountButton } from "@/components/delete-instagram-account-button";
import Link from "next/link";

import { MetaConnectButton } from "@/components/meta-connect-button";
import {
  getInstagramAccountStatusCopy,
  getInstagramAccountStatusLabel,
  isFallbackInstagramUsername,
  isInstagramProfileEnrichmentPending,
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
      <section className="page-header">
        <div>
          <span className="eyebrow">Cuentas</span>
          <h1>Conecta Instagram con Instagram Login oficial</h1>
          <p className="page-copy">
            Cada cuenta se conecta con el consentimiento oficial en instagram.com y
            solo queda guardada cuando OAuth y el token devuelto por Meta terminan bien.
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
                <strong>1. Redireccion a Instagram</strong>
                <p>Instagram muestra el consentimiento oficial y devuelve el codigo al callback del CRM.</p>
              </div>
            </div>
            <div className="list-row">
              <div>
                <strong>2. Validacion completa</strong>
                <p>El backend intercambia el code, valida el token y el identificador devuelto por Meta, y guarda la cuenta conectada.</p>
              </div>
            </div>
            <div className="list-row">
              <div>
                <strong>3. Inbox persistente</strong>
                <p>Los mensajes entran por el webhook global ya configurado en Meta, llegan a <code>/api/webhook/instagram</code>, se validan con firma SHA256 y se guardan para historial.</p>
              </div>
            </div>
          </div>
        </article>

        <article className="list-card">
          <span className="eyebrow">Requisito</span>
          <h2>Cuenta Professional</h2>
          <p className="page-copy">
            Si la cuenta conectada no es Business o Creator, el flujo mostrara el error
            y un enlace directo con las instrucciones oficiales para cambiar el tipo de cuenta.
          </p>
          <p className="page-copy">
            Una vez convertida, basta con repetir la conexion desde este panel para agregarla o reconectarla.
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
            {accounts.map((account) => {
              const fallbackUsername = isFallbackInstagramUsername(account.username);
              const profileEnrichmentPending = isInstagramProfileEnrichmentPending({
                username: account.username,
                name: account.name,
                accountType: account.account_type,
              });
              const accountTitle = fallbackUsername
                ? "Cuenta conectada"
                : `@${account.username}`;
              const accountSecondaryLine = fallbackUsername
                ? `ID de Instagram: ${account.instagram_account_id}`
                : account.name || `ID de Instagram: ${account.instagram_account_id}`;

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
                        {account.account_type || "Perfil pendiente de sincronizacion"}
                      </code>
                    </p>
                    {profileEnrichmentPending ? (
                      <p className="status-copy">
                        Los datos publicos del perfil se completaran en una sincronizacion posterior.
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
                    <span className="pill">{getInstagramAccountStatusLabel(account.status)}</span>
                    <span className="status-copy">
                      {getInstagramAccountStatusCopy({
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
