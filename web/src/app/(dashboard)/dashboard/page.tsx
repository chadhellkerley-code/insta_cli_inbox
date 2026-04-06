import {
  buildThreadSummaries,
  computeDashboardMetrics,
  formatCompactNumber,
  formatRelativeTime,
  loadOwnedAccounts,
  loadRecentChatsForAccounts,
  requireUserContext,
} from "@/lib/app-data";

export default async function DashboardPage() {
  const { supabase, user } = await requireUserContext();
  const accounts = await loadOwnedAccounts(supabase, user.id);
  const chats = await loadRecentChatsForAccounts(
    supabase,
    accounts.map((account) => account.id),
  );
  const threads = buildThreadSummaries(chats, accounts);
  const metrics = computeDashboardMetrics(chats, threads, accounts);

  return (
    <div className="page-stack">
      <section className="page-header">
        <div>
          <span className="eyebrow">Dashboard</span>
          <h1>Vista general del pipeline</h1>
          <p className="page-copy">
            Un resumen rápido de actividad, cuentas y conversaciones para abrir
            la jornada con contexto real del inbox.
          </p>
        </div>
      </section>

      <section className="card-grid">
        <article className="metric-card">
          <span>Entrantes hoy</span>
          <strong>{formatCompactNumber(metrics.todayInbound)}</strong>
          <p>Mensajes recibidos en las últimas 24 horas.</p>
        </article>
        <article className="metric-card">
          <span>Salientes hoy</span>
          <strong>{formatCompactNumber(metrics.todayOutbound)}</strong>
          <p>Respuestas persistidas durante el mismo período.</p>
        </article>
        <article className="metric-card">
          <span>Hilos activos</span>
          <strong>{formatCompactNumber(metrics.activeThreads)}</strong>
          <p>Conversaciones únicas visibles para el owner actual.</p>
        </article>
        <article className="metric-card">
          <span>Reply ratio</span>
          <strong>{metrics.replyRatio.toFixed(0)}%</strong>
          <p>Relación salientes / entrantes de hoy, orientativa.</p>
        </article>
      </section>

      <section className="split-grid">
        <article className="list-card">
          <span className="eyebrow">Actividad</span>
          <h2>Volumen y calidad</h2>
          <div className="stack-list">
            <div className="list-row">
              <div>
                <strong>{formatCompactNumber(metrics.weekTotal)}</strong>
                <p>mensajes en 7 días</p>
              </div>
              <span className="pill">Semana</span>
            </div>
            <div className="list-row">
              <div>
                <strong>{formatCompactNumber(metrics.monthTotal)}</strong>
                <p>mensajes en 30 días</p>
              </div>
              <span className="pill">Mes</span>
            </div>
            <div className="list-row">
              <div>
                <strong>{formatCompactNumber(metrics.qualifiedThreads)}</strong>
                <p>hilos con etiqueta qualified</p>
              </div>
              <span className="pill">Qualify</span>
            </div>
            <div className="list-row">
              <div>
                <strong>{formatCompactNumber(metrics.staleThreads)}</strong>
                <p>hilos sin actividad en 14 días</p>
              </div>
              <span className="pill">Stale</span>
            </div>
          </div>
        </article>

        <article className="list-card">
          <span className="eyebrow">Cuentas</span>
          <h2>Estado operativo</h2>
          <div className="stack-list">
            <div className="list-row">
              <div>
                <strong>{formatCompactNumber(accounts.length)}</strong>
                <p>cuentas totales</p>
              </div>
              <span className="pill">Total</span>
            </div>
            <div className="list-row">
              <div>
                <strong>{formatCompactNumber(metrics.activeAccounts)}</strong>
                <p>cuentas marcadas activas</p>
              </div>
              <span className="pill">Active</span>
            </div>
            <div className="list-row">
              <div>
                <strong>
                  {
                    accounts.filter(
                      (account) => account.proxy_host || account.proxy_port,
                    ).length
                  }
                </strong>
                <p>cuentas con proxy configurado</p>
              </div>
              <span className="pill">Proxy</span>
            </div>
          </div>
        </article>
      </section>

      <section className="split-grid">
        <article className="list-card">
          <span className="eyebrow">Conversaciones</span>
          <h2>Últimos hilos</h2>
          {threads.length === 0 ? (
            <div className="empty-state compact">
              <strong>No hay conversaciones aún</strong>
              <p>Cuando entren mensajes en `chats`, el dashboard se va a poblar solo.</p>
            </div>
          ) : (
            <div className="stack-list">
              {threads.slice(0, 6).map((thread) => (
                <div key={thread.threadKey} className="list-row">
                  <div>
                    <strong>{thread.username}</strong>
                    <p>
                      @{thread.accountUsername} · {thread.messageCount} mensajes
                    </p>
                  </div>
                  <span className="muted">{formatRelativeTime(thread.lastTimestamp)}</span>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="feature-card">
          <span className="eyebrow">Siguiente paso</span>
          <h2>Base lista para crecer</h2>
          <p>
            El shell ya quedó preparado para sumar envío de mensajes, filtros
            persistidos, métricas avanzadas y automatizaciones reales sobre la misma
            sesión de Supabase.
          </p>
          <ul>
            <li>Inbox de 3 columnas con Realtime</li>
            <li>Rutas protegidas y auth SSR</li>
            <li>Registro administrativo para owners</li>
          </ul>
        </article>
      </section>
    </div>
  );
}
