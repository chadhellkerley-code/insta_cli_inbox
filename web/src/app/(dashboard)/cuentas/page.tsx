import { redirect } from "next/navigation";

import {
  formatDateTime,
  loadAgentPresenceForAgents,
  loadOwnedAccounts,
  loadOwnerAgents,
  requireUserContext,
} from "@/lib/app-data";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type SearchParams = {
  error?: string | string[];
  success?: string | string[];
};

type InsertClient = {
  insert: (
    values: Record<string, unknown>,
  ) => Promise<{ error: { message: string } | null }>;
};

type UpsertClient = {
  upsert: (
    values: Record<string, unknown>,
  ) => Promise<{ error: { message: string } | null }>;
};

type AccountLookupClient = {
  select: (
    columns: string,
  ) => {
    eq: (column: string, value: string | number) => unknown;
  };
};

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function pairAgentAction(formData: FormData) {
  "use server";

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const agentId = String(formData.get("agent_id") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim();

  if (!agentId) {
    redirect("/cuentas?error=Completa el agent_id.");
  }

  try {
    const admin = createAdminClient();
    const ownerAgentsClient = admin.from("owner_agents") as unknown as UpsertClient;
    const { error } = await ownerAgentsClient.upsert({
      owner_id: user.id,
      agent_id: agentId,
      label: label || null,
    });

    if (error) {
      throw error;
    }

    redirect("/cuentas?success=Agente vinculado correctamente.");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "No se pudo vincular el agente.";
    redirect(`/cuentas?error=${encodeURIComponent(message)}`);
  }
}

async function createAccountAction(formData: FormData) {
  "use server";

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const twofactor = String(formData.get("twofactor") ?? "").trim();
  const proxyHost = String(formData.get("proxy_host") ?? "").trim();
  const proxyPortRaw = String(formData.get("proxy_port") ?? "").trim();
  const proxyUsername = String(formData.get("proxy_username") ?? "").trim();
  const proxyPassword = String(formData.get("proxy_password") ?? "").trim();
  const agentId = String(formData.get("agent_id") ?? "").trim();

  if (!agentId) {
    redirect("/cuentas?error=Vincula o selecciona un agente antes de crear cuentas.");
  }

  if (!username || !password) {
    redirect("/cuentas?error=Completa usuario y contrasena.");
  }

  const proxyPort = proxyPortRaw ? Number.parseInt(proxyPortRaw, 10) : null;
  if (proxyPortRaw && Number.isNaN(proxyPort)) {
    redirect("/cuentas?error=El puerto del proxy debe ser numerico.");
  }

  try {
    const admin = createAdminClient();
    const accountsClient = admin.from("accounts") as unknown as InsertClient;
    const { error } = await accountsClient.insert({
      agent_id: agentId,
      username,
      password,
      twofactor: twofactor || null,
      proxy_host: proxyHost || null,
      proxy_port: proxyPort,
      proxy_username: proxyUsername || null,
      proxy_password: proxyPassword || null,
      owner_id: user.id,
      status: "queued",
    });

    if (error) {
      throw error;
    }

    redirect("/cuentas?success=Cuenta creada en Supabase y asignada al agente.");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "No se pudo crear la cuenta.";
    redirect(`/cuentas?error=${encodeURIComponent(message)}`);
  }
}

async function queueJobAction(formData: FormData) {
  "use server";

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const type = String(formData.get("type") ?? "").trim();
  const accountId = Number.parseInt(String(formData.get("account_id") ?? ""), 10);

  if (!type || Number.isNaN(accountId)) {
    redirect("/cuentas?error=Faltan datos para crear el job.");
  }

  try {
    const admin = createAdminClient();
    const accountsClient = admin.from("accounts") as unknown as AccountLookupClient;
    const accountQuery = accountsClient.select("id, agent_id") as {
      eq: (column: string, value: string | number) => {
        eq: (nestedColumn: string, nestedValue: string | number) => {
          maybeSingle: () => Promise<{
            data: { id: number; agent_id: string | null } | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
    const { data: account, error: accountError } = await accountQuery
      .eq("id", accountId)
      .eq("owner_id", user.id)
      .maybeSingle();

    if (accountError || !account) {
      throw new Error(accountError?.message ?? "Cuenta no encontrada.");
    }

    if (!account.agent_id) {
      throw new Error("La cuenta no tiene un agente asignado.");
    }

    const jobsClient = admin.from("agent_jobs") as unknown as InsertClient;
    const { error } = await jobsClient.insert({
      owner_id: user.id,
      agent_id: account.agent_id,
      type,
      status: "pending",
      payload: {
        account_id: account.id,
      },
    });

    if (error) {
      throw error;
    }

    redirect("/cuentas?success=Accion enviada al agente local.");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "No se pudo encolar la accion.";
    redirect(`/cuentas?error=${encodeURIComponent(message)}`);
  }
}

export default async function CuentasPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const { supabase, user } = await requireUserContext();
  const ownerAgents = await loadOwnerAgents(supabase, user.id);
  const agentPresences = await loadAgentPresenceForAgents(
    supabase,
    ownerAgents.map((agent) => agent.agent_id),
  );
  const accounts = await loadOwnedAccounts(supabase, user.id);
  const error = readParam(searchParams?.error);
  const success = readParam(searchParams?.success);
  const onlineAgentIds = new Set(
    agentPresences
      .filter((presence) => {
        if (!presence.last_seen_at) {
          return false;
        }

        return Date.now() - new Date(presence.last_seen_at).getTime() < 30_000;
      })
      .map((presence) => presence.agent_id),
  );

  return (
    <div className="page-stack">
      <section className="page-header">
        <div>
          <span className="eyebrow">Cuentas</span>
          <h1>Operacion multiusuario por agente</h1>
          <p className="page-copy">
            Cada owner vincula uno o mas <code>agent_id</code>. Las cuentas quedan
            asignadas a ese agente y los jobs solo los procesa la PC correcta.
          </p>
        </div>
      </section>

      {error ? <div className="feedback error">{error}</div> : null}
      {success ? <div className="feedback success">{success}</div> : null}

      <section className="card-grid">
        <article className="metric-card">
          <span>Agentes vinculados</span>
          <strong>{ownerAgents.length}</strong>
          <p>Agentes disponibles para este usuario.</p>
        </article>
        <article className="metric-card">
          <span>Agentes online</span>
          <strong>{onlineAgentIds.size}</strong>
          <p>Heartbeat reciente en agent_presence.</p>
        </article>
        <article className="metric-card">
          <span>Cuentas</span>
          <strong>{accounts.length}</strong>
          <p>Cuentas asignadas a tus agentes.</p>
        </article>
      </section>

      <section className="split-grid">
        <article className="list-card">
          <span className="eyebrow">Paso 1</span>
          <h2>Vincular agente</h2>
          <p className="page-copy">
            Inicia el agente local en tu PC y pega aca su <code>LOCAL_AGENT_ID</code>.
          </p>

          <form action={pairAgentAction} className="form-stack">
            <div className="field">
              <label className="field-label" htmlFor="agent_id">
                Agent ID
              </label>
              <input
                id="agent_id"
                name="agent_id"
                type="text"
                className="text-input"
                placeholder="pc-principal"
                required
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="label">
                Etiqueta
              </label>
              <input
                id="label"
                name="label"
                type="text"
                className="text-input"
                placeholder="Oficina, notebook, VPS..."
              />
            </div>

            <button type="submit" className="button button-primary">
              Vincular agente
            </button>
          </form>

          <div className="stack-list">
            {ownerAgents.length === 0 ? (
              <div className="empty-state compact">
                <strong>Sin agentes vinculados</strong>
                <p>Vincula al menos uno antes de crear cuentas.</p>
              </div>
            ) : (
              ownerAgents.map((agent) => {
                const presence = agentPresences.find(
                  (item) => item.agent_id === agent.agent_id,
                );

                return (
                  <div key={agent.agent_id} className="list-row">
                    <div>
                      <strong>{agent.label || agent.agent_id}</strong>
                      <p>
                        <code>{agent.agent_id}</code>
                      </p>
                    </div>
                    <span className="pill">
                      {presence?.last_seen_at &&
                      Date.now() - new Date(presence.last_seen_at).getTime() < 30_000
                        ? "online"
                        : "offline"}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </article>

        <article className="list-card">
          <span className="eyebrow">Paso 2</span>
          <h2>Nueva cuenta</h2>

          {ownerAgents.length === 0 ? (
            <div className="empty-state compact">
              <strong>Primero vincula un agente</strong>
              <p>La cuenta necesita saber en que PC se va a ejecutar.</p>
            </div>
          ) : (
            <form action={createAccountAction} className="form-stack">
              <div className="field">
                <label className="field-label" htmlFor="account-agent-id">
                  Agente
                </label>
                <select
                  id="account-agent-id"
                  name="agent_id"
                  className="text-input"
                  defaultValue={ownerAgents[0]?.agent_id}
                  required
                >
                  {ownerAgents.map((agent) => (
                    <option key={agent.agent_id} value={agent.agent_id}>
                      {agent.label || agent.agent_id}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label className="field-label" htmlFor="username">
                  Usuario
                </label>
                <input
                  id="username"
                  name="username"
                  type="text"
                  className="text-input"
                  placeholder="mi_cuenta_ig"
                  required
                />
              </div>

              <div className="field">
                <label className="field-label" htmlFor="password">
                  Contrasena
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  className="text-input"
                  placeholder="Password de Instagram"
                  required
                />
              </div>

              <div className="field">
                <label className="field-label" htmlFor="twofactor">
                  Secreto 2FA
                </label>
                <input
                  id="twofactor"
                  name="twofactor"
                  type="text"
                  className="text-input"
                  placeholder="Opcional"
                />
              </div>

              <div className="field">
                <label className="field-label" htmlFor="proxy_host">
                  Proxy host
                </label>
                <input
                  id="proxy_host"
                  name="proxy_host"
                  type="text"
                  className="text-input"
                  placeholder="Opcional"
                />
              </div>

              <div className="field">
                <label className="field-label" htmlFor="proxy_port">
                  Proxy port
                </label>
                <input
                  id="proxy_port"
                  name="proxy_port"
                  type="text"
                  className="text-input"
                  placeholder="8080"
                />
              </div>

              <div className="field">
                <label className="field-label" htmlFor="proxy_username">
                  Proxy user
                </label>
                <input
                  id="proxy_username"
                  name="proxy_username"
                  type="text"
                  className="text-input"
                  placeholder="Opcional"
                />
              </div>

              <div className="field">
                <label className="field-label" htmlFor="proxy_password">
                  Proxy password
                </label>
                <input
                  id="proxy_password"
                  name="proxy_password"
                  type="password"
                  className="text-input"
                  placeholder="Opcional"
                />
              </div>

              <button type="submit" className="button button-primary">
                Crear cuenta
              </button>
            </form>
          )}
        </article>
      </section>

      <section className="list-card">
        <span className="eyebrow">Paso 3</span>
        <h2>Cuentas asignadas</h2>

        {accounts.length === 0 ? (
          <div className="empty-state compact">
            <strong>Sin cuentas todavia</strong>
            <p>Crea la primera cuenta y luego dispara login o sync inbox.</p>
          </div>
        ) : (
          <div className="stack-list">
            {accounts.map((account) => (
              <div key={account.id} className="list-row">
                <div>
                  <strong>@{account.username}</strong>
                  <p>
                    Agente: <code>{account.agent_id || "sin asignar"}</code>
                  </p>
                  <p>
                    {account.proxy_host
                      ? `${account.proxy_host}:${account.proxy_port ?? "?"}`
                      : "Sin proxy"}
                  </p>
                  <p>Creada {formatDateTime(account.created_at)}</p>
                </div>

                <div className="stack-list">
                  <span className="pill">{account.status ?? "active"}</span>
                  <form action={queueJobAction} className="form-stack">
                    <input type="hidden" name="account_id" value={account.id} />
                    <input type="hidden" name="type" value="login_account" />
                    <button type="submit" className="button button-secondary">
                      Login IG
                    </button>
                  </form>
                  <form action={queueJobAction} className="form-stack">
                    <input type="hidden" name="account_id" value={account.id} />
                    <input type="hidden" name="type" value="sync_inbox" />
                    <button type="submit" className="button button-secondary">
                      Sync inbox
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
