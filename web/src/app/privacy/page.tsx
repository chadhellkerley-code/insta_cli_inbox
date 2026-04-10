export default function PrivacyPage() {
  return (
    <main className="auth-shell">
      <section className="auth-card privacy-card">
        <span className="eyebrow">Privacidad</span>
        <h1>Politica de privacidad</h1>
        <p className="auth-copy">
          Insta CLI Inbox permite gestionar mensajes de Instagram desde una
          bandeja unificada para facilitar la atencion y el seguimiento de
          conversaciones.
        </p>
        <p className="auth-copy">
          Los datos necesarios para operar la app se almacenan de forma segura y
          se usan solamente para brindar las funciones del servicio.
        </p>
        <p className="auth-copy">
          No compartimos la informacion de los usuarios ni los mensajes con
          terceros.
        </p>
        <p className="auth-copy">
          Si un usuario quiere eliminar sus datos, puede contactar al
          administrador de la app para solicitar la eliminacion de su informacion.
        </p>
      </section>
    </main>
  );
}
