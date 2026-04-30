import {
  computeDashboardMetrics,
  enrichConversationsWithAccounts,
  formatCompactNumber,
  formatRelativeTime,
  getConversationDisplayName,
  getConversationPreview,
  getInstagramAccountDisplayName,
  loadConversations,
  loadOwnedAccounts,
  loadRecentMessagesForOwner,
  requireUserContext,
} from "@/lib/app-data";

export default async function DashboardPage() {
  const { supabase, user } = await requireUserContext();
  const [accounts, conversations, messages] = await Promise.all([
    loadOwnedAccounts(supabase, user.id),
    loadConversations(supabase, user.id),
    loadRecentMessagesForOwner(supabase, user.id),
  ]);

  const enrichedConversations = enrichConversationsWithAccounts(conversations, accounts);
  const visibleConversationIds = new Set(enrichedConversations.map((conversation) => conversation.id));
  const visibleMessages = messages.filter((message) =>
    visibleConversationIds.has(message.conversation_id),
  );
  const metrics = computeDashboardMetrics(visibleMessages, enrichedConversations, accounts);

  return (
    <div className="page-stack">
      <section className="page-header">
        <div>
          <span className="eyebrow">Dashboard</span>
          <h1>Operacion del inbox de Instagram</h1>
          <p className="page-copy">
            Resumen de actividad, conversaciones y cuentas conectadas sobre la
            integracion oficial con Meta.
          </p>
        </div>
      </section>

      <section className="card-grid">
        <article className="metric-card">
          <span>Entrantes hoy</span>
          <strong>{formatCompactNumber(metrics.todayInbound)}</strong>
          <p>Mensajes recibidos en las ultimas 24 horas.</p>
        </article>
        <article className="metric-card">
          <span>Conversaciones activas</span>
          <strong>{formatCompactNumber(metrics.activeConversations)}</strong>
          <p>Hilos persistidos en Supabase.</p>
        </article>
        <article className="metric-card">
          <span>Cuentas conectadas</span>
          <strong>{formatCompactNumber(metrics.activeAccounts)}</strong>
          <p>Perfiles Professional conectados por OAuth.</p>
        </article>
      </section>

      <section className="split-grid">
        <article className="list-card">
          <span className="eyebrow">Salud</span>
          <h2>Indicadores clave</h2>
          <div className="stack-list">
            <div className="list-row">
              <div>
                <strong>{formatCompactNumber(metrics.todayOutbound)}</strong>
                <p>mensajes salientes hoy</p>
              </div>
              <span className="pill">Hoy</span>
            </div>
            <div className="list-row">
              <div>
                <strong>{metrics.replyRatio.toFixed(0)}%</strong>
                <p>ratio de respuesta sobre mensajes de hoy</p>
              </div>
              <span className="pill">Reply</span>
            </div>
            <div className="list-row">
              <div>
                <strong>{formatCompactNumber(metrics.qualifiedConversations)}</strong>
                <p>conversaciones con etiqueta qualified</p>
              </div>
              <span className="pill">Labels</span>
            </div>
            <div className="list-row">
              <div>
                <strong>{formatCompactNumber(metrics.staleConversations)}</strong>
                <p>hilos sin actividad reciente</p>
              </div>
              <span className="pill">Stale</span>
            </div>
          </div>
        </article>

        <article className="list-card">
          <span className="eyebrow">Actividad</span>
          <h2>Volumen reciente</h2>
          <div className="stack-list">
            <div className="list-row">
              <div>
                <strong>{formatCompactNumber(metrics.weekTotal)}</strong>
                <p>mensajes en 7 dias</p>
              </div>
              <span className="pill">Semana</span>
            </div>
            <div className="list-row">
              <div>
                <strong>{formatCompactNumber(metrics.monthTotal)}</strong>
                <p>mensajes en 30 dias</p>
              </div>
              <span className="pill">Mes</span>
            </div>
            <div className="list-row">
              <div>
                <strong>{accounts.filter((account) => account.last_webhook_at).length}</strong>
                <p>cuentas con al menos un webhook real</p>
              </div>
              <span className="pill">Webhook</span>
            </div>
          </div>
        </article>
      </section>

      <section>
        <article className="list-card">
          <span className="eyebrow">Conversaciones</span>
          <h2>Ultima actividad</h2>
          {enrichedConversations.length === 0 ? (
            <div className="empty-state compact">
              <strong>No hay conversaciones aun</strong>
              <p>Cuando llegue el primer mensaje real por webhook, el dashboard se llena solo.</p>
            </div>
          ) : (
            <div className="stack-list">
              {enrichedConversations.slice(0, 6).map((conversation) => (
                <div key={conversation.id} className="list-row">
                  <div>
                    <strong>{getConversationDisplayName(conversation)}</strong>
                    <p>
                      {getInstagramAccountDisplayName(conversation.account_username)} -{" "}
                      {getConversationPreview(conversation)}
                    </p>
                  </div>
                  <span className="muted">{formatRelativeTime(conversation.last_message_at)}</span>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>
    </div>
  );
}
