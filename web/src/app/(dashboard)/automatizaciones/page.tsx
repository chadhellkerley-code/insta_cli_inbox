import { loadStages, requireUserContext } from "@/lib/app-data";

function getStageLabel(stage: Record<string, unknown>, index: number) {
  const value = stage.name ?? stage.stage ?? stage.title;
  return typeof value === "string" && value.trim() ? value : `Etapa ${index + 1}`;
}

function getStageDescription(stage: Record<string, unknown>) {
  const candidates = [stage.prompt, stage.description, stage.notes];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }

  return "Sin descripción cargada todavía.";
}

export default async function AutomatizacionesPage() {
  const { supabase, user } = await requireUserContext();
  const stages = await loadStages(supabase, user.id);

  return (
    <div className="page-stack">
      <section className="page-header">
        <div>
          <span className="eyebrow">Automatizaciones</span>
          <h1>Estructura base para etapas y follow-ups</h1>
          <p className="page-copy">
            Dejé el esqueleto visual para enchufar reglas, prompts, ventanas
            horarias y secuencias por etapa sin rehacer la navegación.
          </p>
        </div>
      </section>

      <section className="split-grid">
        <article className="feature-card">
          <span className="eyebrow">Cobertura</span>
          <h2>Qué entra acá</h2>
          <ul>
            <li>Stages con múltiples mensajes y delays</li>
            <li>Prompt de IA por cuenta o por pipeline</li>
            <li>Follow-ups con ventana horaria y reglas de stop</li>
          </ul>
        </article>

        <article className="feature-card">
          <span className="eyebrow">Estado</span>
          <h2>Lectura desde Supabase</h2>
          <p>
            Si ya existe la tabla <code>stages</code> con registros del usuario,
            los muestro abajo. Si no, la UI queda lista como placeholder funcional.
          </p>
        </article>
      </section>

      <section className="card-grid">
        {stages.length === 0 ? (
          <article className="empty-state">
            <strong>Sin etapas cargadas</strong>
            <p>
              La vista base quedó lista para conectar creación, edición y métricas
              de avance por etapa.
            </p>
          </article>
        ) : (
          stages.map((stage, index) => (
            <article key={`${getStageLabel(stage, index)}-${index}`} className="feature-card">
              <span className="eyebrow">Stage</span>
              <h2>{getStageLabel(stage, index)}</h2>
              <p>{getStageDescription(stage)}</p>
            </article>
          ))
        )}
      </section>
    </div>
  );
}
