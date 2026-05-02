"use client";

import { useEffect, useMemo, useState } from "react";

type ConnectionState = {
  connected: boolean;
  calendly_user_uri: string | null;
  expires_at: string | null;
  needs_reconnect?: boolean;
};

type CalendlyEventType = {
  uri: string;
  name: string;
  active: boolean;
  schedulingUrl: string | null;
  duration: number | null;
};

type EventTypesState = {
  eventTypes: CalendlyEventType[];
  defaultEventTypeUri: string | null;
  defaultEventTypeName: string | null;
};

function readParam(value: string | null) {
  return value?.trim() ? value : null;
}

export default function SettingsPage() {
  const [connection, setConnection] = useState<ConnectionState | null>(null);
  const [eventTypesState, setEventTypesState] = useState<EventTypesState>({
    eventTypes: [],
    defaultEventTypeUri: null,
    defaultEventTypeName: null,
  });
  const [selectedEventTypeUri, setSelectedEventTypeUri] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackTone, setFeedbackTone] = useState<"success" | "error">("success");
  const [loading, setLoading] = useState(true);
  const [loadingEventTypes, setLoadingEventTypes] = useState(false);
  const [savingEventType, setSavingEventType] = useState(false);

  const selectedEventType = useMemo(
    () =>
      eventTypesState.eventTypes.find(
        (eventType) => eventType.uri === selectedEventTypeUri,
      ) ?? null,
    [eventTypesState.eventTypes, selectedEventTypeUri],
  );

  function showFeedback(message: string, tone: "success" | "error") {
    setFeedback(message);
    setFeedbackTone(tone);
  }

  async function loadConnection() {
    const response = await fetch("/api/calendly/connection", {
      method: "GET",
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => null)) as
      | (ConnectionState & { error?: string })
      | null;

    if (!response.ok || !payload) {
      throw new Error(payload?.error || "No pudimos cargar Calendly.");
    }

    setConnection(payload);
    return payload;
  }

  async function loadEventTypes() {
    setLoadingEventTypes(true);

    try {
      const response = await fetch("/api/calendly/event-types", {
        method: "GET",
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as
        | (EventTypesState & { error?: string })
        | null;

      if (!response.ok || !payload) {
        throw new Error(payload?.error || "No pudimos cargar reuniones.");
      }

      setEventTypesState({
        eventTypes: payload.eventTypes ?? [],
        defaultEventTypeUri: payload.defaultEventTypeUri ?? null,
        defaultEventTypeName: payload.defaultEventTypeName ?? null,
      });
      setSelectedEventTypeUri(payload.defaultEventTypeUri ?? "");
    } finally {
      setLoadingEventTypes(false);
    }
  }

  async function saveDefaultEventType() {
    setSavingEventType(true);

    try {
      const response = await fetch("/api/calendly/event-types", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          defaultEventTypeUri: selectedEventType?.uri ?? null,
          defaultEventTypeName: selectedEventType?.name ?? null,
          enabled: true,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            defaultEventTypeUri?: string | null;
            defaultEventTypeName?: string | null;
            error?: string;
          }
        | null;

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "No pudimos guardar la reunion.");
      }

      setEventTypesState((current) => ({
        ...current,
        defaultEventTypeUri: payload.defaultEventTypeUri ?? null,
        defaultEventTypeName: payload.defaultEventTypeName ?? null,
      }));
      showFeedback("Reunion por defecto guardada.", "success");
    } catch (error) {
      showFeedback(
        error instanceof Error ? error.message : "No pudimos guardar la reunion.",
        "error",
      );
    } finally {
      setSavingEventType(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = readParam(params.get("calendly"));
    const message = readParam(params.get("message"));

    if (status === "connected") {
      showFeedback("Calendly conectado.", "success");
    } else if (status === "error") {
      showFeedback(message ?? "No se pudo conectar Calendly.", "error");
    }

    void loadConnection()
      .then((nextConnection) => {
        if (nextConnection.connected) {
          return loadEventTypes();
        }

        return undefined;
      })
      .catch((error) => {
        showFeedback(
          error instanceof Error ? error.message : "No pudimos cargar Calendly.",
          "error",
        );
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  return (
    <div className="page-stack">
      <section className="page-header">
        <div>
          <span className="eyebrow">Settings</span>
          <h1>Configuracion</h1>
          <p className="page-copy">
            Integraciones externas para automatizar respuestas y agenda.
          </p>
        </div>
      </section>

      {feedback ? (
        <div className={`feedback ${feedbackTone}`}>{feedback}</div>
      ) : null}

      <section className="list-card settings-card">
        <span className="eyebrow">Calendario</span>
        <h2>Conectar Calendly</h2>
        <div className="stack-list">
          <div className="list-row settings-row">
            <div>
              <strong>
                {connection?.connected ? "Calendly conectado" : "No conectado"}
              </strong>
              <p>
                {connection?.connected
                  ? connection.calendly_user_uri
                  : "Conecta Calendly para preparar la agenda automatica."}
              </p>
              {connection?.expires_at ? (
                <p>
                  Token activo hasta{" "}
                  {new Intl.DateTimeFormat("es", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(connection.expires_at))}
                </p>
              ) : null}
              {connection?.needs_reconnect ? (
                <p>La conexion necesita reconectarse.</p>
              ) : null}
              {connection?.connected ? (
                <p>
                  Para reservar automaticamente, reconecta Calendly despues de
                  actualizar los permisos OAuth.
                </p>
              ) : null}
            </div>

            <a href="/api/calendly/oauth/start" className="button button-primary">
              {connection?.connected ? "Reconectar" : "Conectar Calendly"}
            </a>
          </div>
        </div>
      </section>

      {connection?.connected ? (
        <section className="list-card settings-card">
          <span className="eyebrow">Event Types</span>
          <h2>Reunion por defecto</h2>
          <div className="stack-list">
            <div className="list-row settings-row">
              <div>
                <strong>
                  {eventTypesState.defaultEventTypeName ?? "Sin reunion por defecto"}
                </strong>
                <p>
                  Elige la reunion que usara la agenda automatica cuando el lead
                  este listo. El modo reservar automaticamente requiere email,
                  horario claro y permisos scheduled_events:write.
                </p>
              </div>

              <div className="settings-actions">
                <select
                  className="text-input"
                  value={selectedEventTypeUri}
                  disabled={loading || loadingEventTypes}
                  onChange={(event) => setSelectedEventTypeUri(event.target.value)}
                >
                  <option value="">
                    {loadingEventTypes ? "Cargando reuniones..." : "Seleccionar reunion"}
                  </option>
                  {eventTypesState.eventTypes.map((eventType) => (
                    <option key={eventType.uri} value={eventType.uri}>
                      {eventType.name}
                      {eventType.duration ? ` - ${eventType.duration} min` : ""}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={savingEventType || !selectedEventTypeUri}
                  onClick={saveDefaultEventType}
                >
                  {savingEventType ? "Guardando..." : "Guardar"}
                </button>
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
