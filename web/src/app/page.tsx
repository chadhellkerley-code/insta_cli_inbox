const features = [
  {
    title: "Automatización de mensajes directos",
    description:
      "Respondé conversaciones de Instagram con flujos guiados y seguimiento por estado.",
  },
  {
    title: "Bandeja operativa",
    description:
      "Centralizá mensajes, cuentas y contactos para trabajar sin cambiar de herramienta.",
  },
  {
    title: "Control humano",
    description:
      "Tomá una conversación cuando haga falta y mantené la automatización bajo control.",
  },
  {
    title: "API oficial de Meta",
    description:
      "El flujo se apoya en la conexión autorizada de Meta para operar cuentas aprobadas.",
  },
  {
    title: "Cuentas aisladas",
    description:
      "Cada usuario ve solo sus cuentas, mensajes, métricas y automatizaciones.",
  },
  {
    title: "Panel en tiempo real",
    description:
      "Monitoreá conversaciones, actividad y configuración desde un panel oscuro.",
  },
];

const steps = [
  {
    number: "01",
    title: "Entrás con Google",
    description:
      "El acceso es abierto y cada usuario queda registrado en Supabase.",
  },
  {
    number: "02",
    title: "Conectás Instagram",
    description:
      "La cuenta pasa por el permiso de Meta antes de operar mensajes reales.",
  },
  {
    number: "03",
    title: "Automatizás la bandeja",
    description:
      "Configurás cuentas, respuestas y seguimiento desde el CRM.",
  },
];

const plans = [
  {
    name: "Inicial",
    price: "Gratis",
    description: "Para probar el acceso, conectar una cuenta y validar el flujo.",
    items: ["Acceso con Google", "Perfil en Supabase", "Panel privado", "Conexión Meta"],
  },
  {
    name: "Operativo",
    price: "A medida",
    description: "Para equipos que necesitan gestionar varias conversaciones.",
    items: ["Múltiples cuentas", "Bandeja en tiempo real", "Automatizaciones", "Métricas"],
    highlighted: true,
  },
  {
    name: "Escala",
    price: "Personalizado",
    description: "Para operaciones con más volumen y configuración avanzada.",
    items: ["Acompañamiento", "Flujos dedicados", "Soporte de setup", "Revisión técnica"],
  },
];

const faqs = [
  {
    question: "¿El acceso queda abierto para cualquier persona?",
    answer:
      "Sí, puede entrar con Google. Pero para operar necesita conectar una cuenta válida y pasar por el permiso de Meta.",
  },
  {
    question: "¿Un usuario puede ver datos de otro?",
    answer:
            "No. Los datos se guardan por usuario y las consultas usan el usuario de la sesión.",
  },
  {
    question: "¿Necesito contraseña?",
    answer:
      "No. El acceso por credenciales fue eliminado. El ingreso es únicamente con Google vía Supabase.",
  },
  {
    question: "¿Puedo conectar más de una cuenta de Instagram?",
    answer:
      "Sí. El panel está preparado para manejar varias cuentas asociadas al usuario.",
  },
  {
    question: "¿Dónde se guardan los usuarios?",
    answer:
      "Supabase crea el usuario en Auth y el CRM actualiza su perfil operativo en la tabla de perfiles.",
  },
];

export default function Home() {
  return (
    <main className="landing-page">
      <nav className="landing-nav" aria-label="Navegación principal">
        <a className="landing-brand" href="/">
          <span className="brand-mark" aria-hidden="true">
            IC
          </span>
          <span>Insta CLI Inbox</span>
        </a>

        <div className="landing-links">
          <a href="#features">Funciones</a>
          <a href="#how-it-works">Cómo funciona</a>
          <a href="#pricing">Planes</a>
          <a href="#faq">Preguntas</a>
        </div>

        <div className="landing-actions">
          <a className="landing-link-button" href="/login">
            Iniciar sesión
          </a>
          <a className="landing-primary-button" href="/login">
            Empezar gratis
          </a>
        </div>
      </nav>

      <section className="landing-hero">
        <div className="landing-hero-copy">
          <span className="landing-pill">CRM para Instagram con IA</span>
          <h1>Automatizá tus mensajes directos sin perder control de la bandeja.</h1>
          <p>
            Gestioná mensajes, cuentas y automatizaciones desde un panel privado
            conectado con Supabase y preparado para Meta.
          </p>

          <div className="hero-actions">
            <a className="landing-primary-button large" href="/login">
              Empezar gratis
            </a>
            <a className="landing-secondary-button large" href="#how-it-works">
              Ver cómo funciona
            </a>
          </div>

          <div className="hero-stats" aria-label="Resumen del producto">
            <span>
              <strong>Google</strong>
              acceso seguro
            </span>
            <span>
              <strong>Meta</strong>
              conexión oficial
            </span>
            <span>
              <strong>Supabase</strong>
              datos aislados
            </span>
          </div>
        </div>

        <div className="hero-product" aria-label="Vista previa del CRM">
          <div className="mock-window">
            <div className="mock-topbar">
              <span />
              <span />
              <span />
            </div>
            <div className="mock-grid">
              <aside className="mock-sidebar">
                <strong>Bandeja</strong>
                <span>Cuentas</span>
                <span>Automatizaciones</span>
                <span>Métricas</span>
              </aside>
              <section className="mock-inbox">
                <div className="mock-thread active">
                  <strong>Lead nuevo</strong>
                  <span>Quiere información del servicio</span>
                </div>
                <div className="mock-thread">
                  <strong>Seguimiento</strong>
                  <span>Respuesta programada</span>
                </div>
                <div className="mock-thread">
                  <strong>Cuenta conectada</strong>
                  <span>API de Meta lista</span>
                </div>
              </section>
              <section className="mock-chat">
                <div className="mock-bubble left">Hola, quiero automatizar mis mensajes.</div>
                <div className="mock-bubble right">Perfecto. Te hago unas preguntas rápidas.</div>
                <div className="mock-status">Automatización activa</div>
              </section>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="landing-section">
        <div className="section-heading">
          <span className="landing-pill">Funciones</span>
          <h2>Todo lo necesario para operar conversaciones.</h2>
          <p>
            Un panel pensado para trabajar mensajes reales, cuentas conectadas y
            respuestas automatizadas.
          </p>
        </div>

        <div className="feature-grid">
          {features.map((feature) => (
            <article className="landing-card feature-card" key={feature.title}>
              <span className="card-icon" aria-hidden="true" />
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="how-it-works" className="landing-section muted-band">
        <div className="section-heading">
          <span className="landing-pill">Cómo funciona</span>
          <h2>Del acceso a la bandeja en tres pasos.</h2>
        </div>

        <div className="steps-grid">
          {steps.map((step) => (
            <article className="landing-card step-card" key={step.number}>
              <span>{step.number}</span>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="pricing" className="landing-section">
        <div className="section-heading">
          <span className="landing-pill">Planes</span>
          <h2>Empezá abierto y escalá cuando lo necesites.</h2>
          <p>
            El acceso con Google permite registrar usuarios rápido. La operación
            real depende de la cuenta conectada a Meta.
          </p>
        </div>

        <div className="pricing-grid">
          {plans.map((plan) => (
            <article
              className={`landing-card price-card${plan.highlighted ? " featured" : ""}`}
              key={plan.name}
            >
              <h3>{plan.name}</h3>
              <strong>{plan.price}</strong>
              <p>{plan.description}</p>
              <ul>
                {plan.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <a className="landing-primary-button" href="/login">
                Empezar
              </a>
            </article>
          ))}
        </div>
      </section>

      <section id="faq" className="landing-section muted-band">
        <div className="section-heading">
          <span className="landing-pill">Preguntas</span>
          <h2>Lo importante antes de entrar.</h2>
        </div>

        <div className="faq-list">
          {faqs.map((faq) => (
            <details className="faq-item" key={faq.question}>
              <summary>{faq.question}</summary>
              <p>{faq.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="landing-cta">
        <div>
          <span className="landing-pill">Listo para operar</span>
          <h2>Entrá con Google y conectá tu cuenta de Instagram.</h2>
          <p>
            El panel queda preparado para que cada usuario trabaje únicamente
            con su propia información.
          </p>
        </div>
        <a className="landing-primary-button large" href="/login">
          Empezar gratis
        </a>
      </section>

      <footer className="landing-footer">
        <div>
          <a className="landing-brand" href="/">
            <span className="brand-mark" aria-hidden="true">
              IC
            </span>
            <span>Insta CLI Inbox</span>
          </a>
          <p>Automatización de mensajes directos de Instagram con panel privado y API de Meta.</p>
        </div>

        <div>
          <h4>Producto</h4>
          <a href="#features">Funciones</a>
          <a href="#pricing">Planes</a>
          <a href="#how-it-works">Cómo funciona</a>
          <a href="#faq">Preguntas</a>
        </div>

        <div>
          <h4>Empresa</h4>
          <a href="#features">Acerca de</a>
          <a href="#faq">Soporte</a>
          <a href="/login">Contacto</a>
        </div>

        <div>
          <h4>Legal</h4>
          <a href="/privacy">Política de privacidad</a>
          <a href="/terms">Términos de servicio</a>
        </div>
      </footer>
    </main>
  );
}
