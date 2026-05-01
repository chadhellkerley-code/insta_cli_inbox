export default function SettingPage() {
  return (
    <div className="page-stack">
      <section className="page-header">
        <div>
          <span className="eyebrow">Setting</span>
          <h1>Configuracion</h1>
          <p className="page-copy">
            Opciones generales para preparar integraciones externas del sistema.
          </p>
        </div>
      </section>

      <section className="list-card">
        <span className="eyebrow">Calendario</span>
        <h2>Conectar Calendly</h2>
        <div className="stack-list">
          <div className="list-row">
            <div>
              <strong>Conectar Calendly</strong>
              <p>
                Espacio reservado para la conexion de Calendly y la agenda
                automatica.
              </p>
            </div>
            <button type="button" className="button button-secondary" disabled>
              Conectar Calendly
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
