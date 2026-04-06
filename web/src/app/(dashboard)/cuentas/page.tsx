import {
  formatDateTime,
  loadOwnedAccounts,
  requireUserContext,
} from "@/lib/app-data";

export default async function CuentasPage() {
  const { supabase, user } = await requireUserContext();
  const accounts = await loadOwnedAccounts(supabase, user.id);

  return (
    <div className="page-stack">
      <section className="page-header">
        <div>
          <span className="eyebrow">Cuentas</span>
          <h1>Estructura base de operación</h1>
          <p className="page-copy">
            Esta pantalla ya quedó lista como base visual para conectar alta,
            edición, login con Instagram y estados por cuenta cuando quieras.
          </p>
        </div>
      </section>

      <section className="card-grid">
        <article className="metric-card">
          <span>Total</span>
          <strong>{accounts.length}</strong>
          <p>Cuentas pertenecientes al owner actual.</p>
        </article>
        <article className="metric-card">
          <span>Con proxy</span>
          <strong>{accounts.filter((account) => account.proxy_host).length}</strong>
          <p>Listas para routing externo.</p>
        </article>
        <article className="metric-card">
          <span>Con 2FA</span>
          <strong>{accounts.filter((account) => account.twofactor).length}</strong>
          <p>Con secreto almacenado.</p>
        </article>
      </section>

      <section className="split-grid">
        <article className="list-card">
          <span className="eyebrow">Inventario</span>
          <h2>Cuentas conectadas</h2>
          {accounts.length === 0 ? (
            <div className="empty-state compact">
              <strong>Sin cuentas en Supabase</strong>
              <p>La estructura está lista; solo falta poblarla con el flujo de alta.</p>
            </div>
          ) : (
            <div className="stack-list">
              {accounts.map((account) => (
                <div key={account.id} className="list-row">
                  <div>
                    <strong>@{account.username}</strong>
                    <p>
                      {account.proxy_host
                        ? `${account.proxy_host}:${account.proxy_port ?? "?"}`
                        : "Sin proxy"}
                    </p>
                  </div>
                  <span className="pill">{account.status ?? "active"}</span>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="feature-card">
          <span className="eyebrow">Pendiente</span>
          <h2>Próximas integraciones</h2>
          <p>
            El siguiente paso natural acá es acoplar formularios, importación CSV,
            validación de proxies y el disparo del login móvil o Playwright.
          </p>
          <ul>
            <li>Alta y edición con server actions</li>
            <li>Estado de sesión por cuenta</li>
            <li>Acciones masivas e importación</li>
          </ul>
          {accounts[0] ? (
            <p className="auth-footer">
              Última cuenta creada: <code>{accounts[0].username}</code> el{" "}
              <code>{formatDateTime(accounts[0].created_at)}</code>
            </p>
          ) : null}
        </article>
      </section>
    </div>
  );
}
