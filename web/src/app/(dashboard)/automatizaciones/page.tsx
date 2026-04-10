import {
  formatCompactNumber,
  loadConversations,
  loadDueReminders,
  loadOwnedAccounts,
  requireUserContext,
} from "@/lib/app-data";

export default async function AutomatizacionesPage() {
  const { supabase, user } = await requireUserContext();
  const [accounts, conversations, dueReminders] = await Promise.all([
    loadOwnedAccounts(supabase, user.id),
    loadConversations(supabase, user.id),
    loadDueReminders(supabase, user.id),
  ]);

  return (
    <div className="page-stack">
      <section className="page-header">
        <div>
          <span className="eyebrow">Automatizaciones</span>
          <h1>Base lista para reglas y seguimiento</h1>
          <p className="page-copy">
            La operacion ya corre sobre Instagram Graph API. Esta vista queda
            preparada para sumar reglas de negocio sin volver al flujo anterior.
          </p>
        </div>
      </section>

      <section className="card-grid">
        <article className="metric-card">
          <span>Cuentas disponibles</span>
          <strong>{formatCompactNumber(accounts.length)}</strong>
          <p>Perfiles listos para disparar automatizaciones futuras.</p>
        </article>
        <article className="metric-card">
          <span>Conversaciones base</span>
          <strong>{formatCompactNumber(conversations.length)}</strong>
          <p>Hilos sobre los que se pueden aplicar reglas y etiquetas.</p>
        </article>
        <article className="metric-card">
          <span>Alertas activas</span>
          <strong>{formatCompactNumber(dueReminders.length)}</strong>
          <p>Recordatorios vencidos que hoy funcionan como notificaciones in-app.</p>
        </article>
      </section>

      <section className="split-grid">
        <article className="feature-card">
          <span className="eyebrow">Siguiente fase</span>
          <h2>Que encaja bien aca</h2>
          <ul>
            <li>Auto etiquetado por palabras clave o cuenta</li>
            <li>Reglas de asignacion y SLA sobre recordatorios</li>
            <li>Secuencias de respuesta guiadas por estado del lead</li>
          </ul>
        </article>

        <article className="feature-card">
          <span className="eyebrow">Estado actual</span>
          <h2>Infraestructura lista</h2>
          <p>
            Ya tenemos cuentas conectadas por OAuth, conversaciones persistidas,
            mensajes en tiempo real y panel de detalles para notas, labels y recordatorios.
          </p>
        </article>
      </section>
    </div>
  );
}
