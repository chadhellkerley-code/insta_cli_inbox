export default function TermsPage() {
  return (
    <main className="auth-shell">
      <section className="auth-card privacy-card">
        <span className="eyebrow">Legal</span>
        <h1>Términos de servicio</h1>
        <p className="auth-copy">
          Insta CLI Inbox permite gestionar cuentas, conversaciones y
          automatizaciones de Instagram desde un panel privado.
        </p>
        <p className="auth-copy">
          Cada usuario es responsable de conectar únicamente cuentas que puede
          administrar y de cumplir las políticas de Meta e Instagram.
        </p>
        <p className="auth-copy">
          El acceso al panel no garantiza operación automática: las cuentas deben
          completar los permisos necesarios antes de usar funciones conectadas.
        </p>
        <p className="auth-copy">
          Podemos ajustar, limitar o desactivar funciones para proteger la
          seguridad del servicio y de los datos de los usuarios.
        </p>
      </section>
    </main>
  );
}
