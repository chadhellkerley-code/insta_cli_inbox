/**
 * Account model for managing Instagram account credentials and proxies.
 * Accounts are persisted locally in SQLite and remotely in Supabase.
 */

function runAsync(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function allAsync(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

async function insertLocalAccount(db, account) {
  await runAsync(
    db,
    `INSERT INTO accounts (
      username,
      password,
      twofactor,
      proxy_host,
      proxy_port,
      proxy_username,
      proxy_password,
      status,
      agent_id,
      owner_id,
      remote_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      account.username,
      account.password || null,
      account.twofactor || null,
      account.proxy_host || null,
      account.proxy_port || null,
      account.proxy_username || null,
      account.proxy_password || null,
      account.status || 'active',
      account.agent_id || null,
      account.owner_id || null,
      account.remote_id || null,
    ],
  );
}

async function addAccount(db, supabase, account) {
  let remoteAccount = null;

  try {
    const { data, error } = await supabase
      .from('accounts')
      .insert({
        username: account.username,
        password: account.password,
        twofactor: account.twofactor || null,
        proxy_host: account.proxy_host || null,
        proxy_port: account.proxy_port || null,
        proxy_username: account.proxy_username || null,
        proxy_password: account.proxy_password || null,
        agent_id: account.agent_id || null,
        owner_id: account.owner_id || null,
        status: account.status || 'active',
      })
      .select('*')
      .single();

    if (error) {
      throw error;
    }

    remoteAccount = data || null;
  } catch (err) {
    console.warn('Supabase insert for accounts failed:', err.message);
  }

  await insertLocalAccount(db, {
    ...account,
    agent_id: account.agent_id || remoteAccount?.agent_id || null,
    remote_id: remoteAccount?.id || null,
  });
}

async function getAccounts(db, ownerId) {
  const rows = await allAsync(
    db,
    `SELECT
      a.*,
      EXISTS (
        SELECT 1
        FROM sessions s
        WHERE s.account_id = a.id
      ) AS has_session
    FROM accounts a
    WHERE a.owner_id = ?
    ORDER BY a.created_at DESC`,
    [ownerId],
  );
  return rows;
}

async function getAccountById(db, id, ownerId) {
  const rows = await allAsync(db, 'SELECT * FROM accounts WHERE id = ? AND owner_id = ?', [id, ownerId]);
  return rows[0] || null;
}

async function getAccountByRemoteId(db, remoteId, ownerId = null) {
  const params = [remoteId];
  let sql = 'SELECT * FROM accounts WHERE remote_id = ?';

  if (ownerId) {
    sql += ' AND owner_id = ?';
    params.push(ownerId);
  }

  sql += ' LIMIT 1';
  const rows = await allAsync(db, sql, params);
  return rows[0] || null;
}

async function getAccountByUsername(db, username, ownerId = null) {
  const params = [username];
  let sql = 'SELECT * FROM accounts WHERE username = ?';

  if (ownerId) {
    sql += ' AND owner_id = ?';
    params.push(ownerId);
  }

  sql += ' ORDER BY created_at DESC LIMIT 1';
  const rows = await allAsync(db, sql, params);
  return rows[0] || null;
}

async function upsertLocalAccountFromRemote(db, account) {
  const existing =
    (account.id ? await getAccountByRemoteId(db, account.id, account.owner_id || null) : null) ||
    (await getAccountByUsername(db, account.username, account.owner_id || null));

  if (!existing) {
    await insertLocalAccount(db, {
      username: account.username,
      password: account.password || null,
      twofactor: account.twofactor || null,
      proxy_host: account.proxy_host || null,
      proxy_port: account.proxy_port || null,
      proxy_username: account.proxy_username || null,
      proxy_password: account.proxy_password || null,
      status: account.status || 'active',
      agent_id: account.agent_id || null,
      owner_id: account.owner_id || null,
      remote_id: account.id || null,
    });

    return getAccountByRemoteId(db, account.id, account.owner_id || null);
  }

  await runAsync(
    db,
    `UPDATE accounts
     SET username = ?,
         password = ?,
         twofactor = ?,
         proxy_host = ?,
         proxy_port = ?,
         proxy_username = ?,
         proxy_password = ?,
         status = ?,
         agent_id = ?,
         owner_id = ?,
         remote_id = ?
     WHERE id = ? AND owner_id = ?`,
    [
      account.username,
      account.password || null,
      account.twofactor || null,
      account.proxy_host || null,
      account.proxy_port || null,
      account.proxy_username || null,
      account.proxy_password || null,
      account.status || existing.status || 'active',
      account.agent_id || existing.agent_id || null,
      account.owner_id || null,
      account.id || existing.remote_id || null,
      existing.id,
      account.owner_id || existing.owner_id || null,
    ],
  );

  return getAccountById(db, existing.id, account.owner_id || null);
}

async function updateAccount(db, id, ownerId, account) {
  const result = await runAsync(
    db,
    `UPDATE accounts
     SET password = ?,
         twofactor = ?,
         proxy_host = ?,
         proxy_port = ?,
         proxy_username = ?,
         proxy_password = ?
     WHERE id = ? AND owner_id = ?`,
    [
      account.password,
      account.twofactor || null,
      account.proxy_host || null,
      account.proxy_port || null,
      account.proxy_username || null,
      account.proxy_password || null,
      id,
      ownerId,
    ],
  );

  return result.changes || 0;
}

async function deleteAccount(db, id, ownerId) {
  const existing = await getAccountById(db, id, ownerId);

  if (!existing) {
    return 0;
  }

  await runAsync(db, 'DELETE FROM sessions WHERE account_id = ?', [id]);
  await runAsync(db, 'DELETE FROM chats WHERE account_id = ?', [id]);
  const result = await runAsync(db, 'DELETE FROM accounts WHERE id = ? AND owner_id = ?', [id, ownerId]);
  return result.changes || 0;
}

module.exports = {
  addAccount,
  getAccounts,
  getAccountById,
  getAccountByRemoteId,
  getAccountByUsername,
  upsertLocalAccountFromRemote,
  updateAccount,
  deleteAccount,
};
