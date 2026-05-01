const os = require('os');

const { saveChat } = require('../models/chatModel');
const {
  getAccountByRemoteId,
  getAccountByUsername,
  upsertLocalAccountFromRemote,
} = require('../models/accountModel');
const { login, getInbox, getThreadMessages, sendMessage } = require('./igMobile');
const { loginWithChrome } = require('./playwrightLogin');

function allAsync(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function runAsync(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function getAgentConfig() {
  return {
    agentId: (process.env.LOCAL_AGENT_ID || `${os.hostname()}-agent`).trim(),
  };
}

async function getLatestSessionRow(db, localAccountId) {
  const rows = await allAsync(
    db,
    'SELECT * FROM sessions WHERE account_id = ? ORDER BY created_at DESC LIMIT 1',
    [localAccountId],
  );
  return rows[0] || null;
}

function parseSessionData(sessionRow) {
  if (!sessionRow?.session_data) {
    return null;
  }

  try {
    return JSON.parse(sessionRow.session_data);
  } catch (error) {
    console.warn('No se pudo parsear la sesion local guardada:', error.message);
    return null;
  }
}

async function insertSerializedSession(db, localAccountId, session) {
  await runAsync(
    db,
    `INSERT INTO sessions (account_id, session_data, cookies, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
    [localAccountId, JSON.stringify(session), session.cookies || null],
  );
}

async function fetchRemoteAccounts(supabase, agentId) {
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return data || [];
}

async function syncAccountsFromSupabase(db, supabase, agentId) {
  const remoteAccounts = await fetchRemoteAccounts(supabase, agentId);

  for (const remoteAccount of remoteAccounts) {
    await upsertLocalAccountFromRemote(db, remoteAccount);
  }
}

async function resolveAccountsForJob(db, supabase, payload, agentId) {
  let remoteAccount = null;

  if (payload.account_id) {
    const { data, error } = await supabase
      .from('accounts')
      .select('*')
      .eq('id', payload.account_id)
      .eq('agent_id', agentId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    remoteAccount = data || null;
  }

  if (!remoteAccount && payload.username) {
    const { data, error } = await supabase
      .from('accounts')
      .select('*')
      .eq('username', payload.username)
      .eq('agent_id', agentId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    remoteAccount = data || null;
  }

  if (!remoteAccount) {
    throw new Error('La cuenta remota no existe para este agente.');
  }

  const localAccount =
    (await getAccountByRemoteId(db, remoteAccount.id)) ||
    (await getAccountByUsername(db, remoteAccount.username, remoteAccount.owner_id || null)) ||
    (await upsertLocalAccountFromRemote(db, remoteAccount));

  if (!localAccount) {
    throw new Error('No se pudo preparar la cuenta local.');
  }

  return { remoteAccount, localAccount };
}

async function upsertPresence(supabase, agentId) {
  const { error } = await supabase.from('agent_presence').upsert({
    agent_id: agentId,
    machine_name: os.hostname(),
    status: 'online',
    last_seen_at: new Date().toISOString(),
  });

  if (error) {
    throw error;
  }
}

async function claimPendingJobs(supabase, agentId) {
  const { data, error } = await supabase
    .from('agent_jobs')
    .select('*')
    .eq('status', 'pending')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: true })
    .limit(10);

  if (error) {
    throw error;
  }

  const claimedJobs = [];

  for (const job of data || []) {
    const { data: claimed, error: claimError } = await supabase
      .from('agent_jobs')
      .update({
        status: 'running',
        claimed_by: agentId,
        started_at: new Date().toISOString(),
        error_message: null,
      })
      .eq('id', job.id)
      .eq('status', 'pending')
      .select('*')
      .maybeSingle();

    if (!claimError && claimed) {
      claimedJobs.push(claimed);
    }
  }

  return claimedJobs;
}

async function markJobCompleted(supabase, jobId, result) {
  const { error } = await supabase
    .from('agent_jobs')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      result: result || {},
      error_message: null,
    })
    .eq('id', jobId);

  if (error) {
    throw error;
  }
}

async function markJobFailed(supabase, jobId, errorMessage) {
  const { error } = await supabase
    .from('agent_jobs')
    .update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_message: errorMessage,
    })
    .eq('id', jobId);

  if (error) {
    throw error;
  }
}

async function updateRemoteAccountStatus(supabase, remoteAccountId, status) {
  try {
    const { error } = await supabase
      .from('accounts')
      .update({ status })
      .eq('id', remoteAccountId);

    if (error) {
      throw error;
    }
  } catch (error) {
    console.warn('No se pudo actualizar el status remoto:', error.message);
  }
}

async function persistInboxMessages(db, supabase, localAccount, remoteAccount, messages) {
  for (const item of messages) {
    const threadId = String(item.thread_id || item.threadId || '');
    if (!threadId) {
      continue;
    }

    const timestamp = item.timestamp ? new Date(item.timestamp).getTime() : Date.now();
    const text = item.text || item.item_type || 'Mensaje';
    const direction = item.user_id ? 'in' : 'out';
    const username = item.user?.username || item.profile?.username || remoteAccount.username;

    const existing = await allAsync(
      db,
      `SELECT id
       FROM chats
       WHERE account_id = ?
         AND thread_id = ?
         AND timestamp = ?
         AND message = ?
       LIMIT 1`,
      [localAccount.id, threadId, timestamp, text],
    );

    if (existing.length > 0) {
      continue;
    }

    await saveChat(db, supabase, {
      localAccountId: localAccount.id,
      remoteAccountId: remoteAccount.id,
      threadId,
      username,
      message: text,
      direction,
      timestamp,
      tags: null,
    });
  }
}

async function loginAccount(db, localAccount) {
  const savedSession = parseSessionData(await getLatestSessionRow(db, localAccount.id));

  try {
    const chromeResult = await loginWithChrome(localAccount);
    return {
      transport: 'chrome',
      warning: chromeResult.warning || null,
      session: savedSession,
    };
  } catch (chromeError) {
    const { session } = await login(localAccount, savedSession);
    await insertSerializedSession(db, localAccount.id, session);

    return {
      transport: 'mobile',
      warning: chromeError.message || null,
      session,
    };
  }
}

async function processJob(db, supabase, agentId, job) {
  const payload = job.payload || {};
  const { remoteAccount, localAccount } = await resolveAccountsForJob(
    db,
    supabase,
    payload,
    agentId,
  );

  if (job.type === 'login_account') {
    const result = await loginAccount(db, localAccount);
    await updateRemoteAccountStatus(supabase, remoteAccount.id, 'active');
    return {
      account_id: remoteAccount.id,
      username: remoteAccount.username,
      transport: result.transport,
      warning: result.warning,
    };
  }

  const savedSession = parseSessionData(await getLatestSessionRow(db, localAccount.id));
  const { ig, session } = await login(localAccount, savedSession);
  await insertSerializedSession(db, localAccount.id, session);

  if (job.type === 'sync_inbox') {
    const threads = await getInbox(ig);
    let totalMessages = 0;

    for (const thread of threads) {
      const threadId = String(thread.thread_id || thread.id || '');
      if (!threadId) {
        continue;
      }

      const messages = await getThreadMessages(ig, threadId);
      await persistInboxMessages(
        db,
        supabase,
        localAccount,
        remoteAccount,
        messages.map((message) => ({ ...message, thread_id: threadId })),
      );
      totalMessages += messages.length;
    }

    await updateRemoteAccountStatus(supabase, remoteAccount.id, 'active');
    return {
      account_id: remoteAccount.id,
      username: remoteAccount.username,
      threads: threads.length,
      messages: totalMessages,
    };
  }

  if (job.type === 'send_message') {
    const threadId = String(payload.thread_id || '').trim();
    const message = String(payload.message || '').trim();

    if (!threadId || !message) {
      throw new Error('Faltan datos para enviar el mensaje.');
    }

    await sendMessage(ig, threadId, message);
    await saveChat(db, supabase, {
      localAccountId: localAccount.id,
      remoteAccountId: remoteAccount.id,
      threadId,
      username: remoteAccount.username,
      message,
      direction: 'out',
      timestamp: Date.now(),
      tags: null,
    });

    await updateRemoteAccountStatus(supabase, remoteAccount.id, 'active');
    return {
      account_id: remoteAccount.id,
      username: remoteAccount.username,
      thread_id: threadId,
      message,
    };
  }

  throw new Error(`Tipo de job no soportado: ${job.type}`);
}

function startLocalAgentBridge({ supabase, db }) {
  const { agentId } = getAgentConfig();

  let heartbeatRunning = false;
  let syncRunning = false;
  let jobsRunning = false;

  async function runHeartbeat() {
    if (heartbeatRunning) {
      return;
    }

    heartbeatRunning = true;
    try {
      await upsertPresence(supabase, agentId);
    } catch (error) {
      console.warn('Heartbeat del agente local fallo:', error.message);
    } finally {
      heartbeatRunning = false;
    }
  }

  async function runAccountSync() {
    if (syncRunning) {
      return;
    }

    syncRunning = true;
    try {
      await syncAccountsFromSupabase(db, supabase, agentId);
    } catch (error) {
      console.warn('Sync de cuentas fallo:', error.message);
    } finally {
      syncRunning = false;
    }
  }

  async function runJobs() {
    if (jobsRunning) {
      return;
    }

    jobsRunning = true;
    try {
      const jobs = await claimPendingJobs(supabase, agentId);

      for (const job of jobs) {
        try {
          const result = await processJob(db, supabase, agentId, job);
          await markJobCompleted(supabase, job.id, result);
        } catch (error) {
          await markJobFailed(supabase, job.id, error.message || 'Job fallido.');
          console.warn(`Job ${job.id} fallo:`, error.message);
        }
      }
    } catch (error) {
      console.warn('Loop de jobs fallo:', error.message);
    } finally {
      jobsRunning = false;
    }
  }

  void runHeartbeat();
  void runAccountSync();
  void runJobs();

  setInterval(() => void runHeartbeat(), 15000);
  setInterval(() => void runAccountSync(), 20000);
  setInterval(() => void runJobs(), 5000);

  console.log(`Local agent bridge activo para agent_id ${agentId}.`);
}

module.exports = { startLocalAgentBridge };
