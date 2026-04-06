/**
 * Account model for managing Instagram account credentials and proxies.
 * Accounts are persisted locally in SQLite and remotely in Supabase.
 */

// Convert callback-based sqlite methods to promises
function runAsync(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
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

/**
 * Insert a new Instagram account into local SQLite and Supabase.
 * The `account` object should include username, password, twofactor,
 * proxy_host, proxy_port, proxy_username, proxy_password and optional
 * owner_id linking it to the current user.
 */
async function addAccount(db, supabase, account) {
  // Store locally
  await runAsync(
    db,
    `INSERT INTO accounts (username, password, twofactor, proxy_host, proxy_port, proxy_username, proxy_password) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      account.username,
      account.password,
      account.twofactor || null,
      account.proxy_host || null,
      account.proxy_port || null,
      account.proxy_username || null,
      account.proxy_password || null,
    ],
  );
  // Optionally store in Supabase if the `accounts` table exists
  try {
    const { error } = await supabase.from('accounts').insert({
      username: account.username,
      password: account.password,
      twofactor: account.twofactor || null,
      proxy_host: account.proxy_host || null,
      proxy_port: account.proxy_port || null,
      proxy_username: account.proxy_username || null,
      proxy_password: account.proxy_password || null,
      owner_id: account.owner_id || null,
    });
    if (error) {
      throw error;
    }
  } catch (err) {
    // Non‑fatal if the table doesn't exist or insert fails; log warning
    console.warn('Supabase insert for accounts failed:', err.message);
  }
}

/**
 * Retrieve all stored accounts from local SQLite. Returns an array of
 * account records.
 */
async function getAccounts(db) {
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
    ORDER BY a.created_at DESC`,
  );
  return rows;
}

/**
 * Retrieve a single account by id.
 */
async function getAccountById(db, id) {
  const rows = await allAsync(db, 'SELECT * FROM accounts WHERE id = ?', [id]);
  return rows[0] || null;
}

/**
 * Update editable fields for an existing account in local SQLite.
 */
async function updateAccount(db, id, account) {
  const result = await runAsync(
    db,
    `UPDATE accounts
     SET password = ?,
         twofactor = ?,
         proxy_host = ?,
         proxy_port = ?,
         proxy_username = ?,
         proxy_password = ?
     WHERE id = ?`,
    [
      account.password,
      account.twofactor || null,
      account.proxy_host || null,
      account.proxy_port || null,
      account.proxy_username || null,
      account.proxy_password || null,
      id,
    ],
  );

  return result.changes || 0;
}

/**
 * Delete an account and its related local data from SQLite.
 */
async function deleteAccount(db, id) {
  await runAsync(db, 'DELETE FROM sessions WHERE account_id = ?', [id]);
  await runAsync(db, 'DELETE FROM chats WHERE account_id = ?', [id]);
  const result = await runAsync(db, 'DELETE FROM accounts WHERE id = ?', [id]);
  return result.changes || 0;
}

module.exports = {
  addAccount,
  getAccounts,
  getAccountById,
  updateAccount,
  deleteAccount,
};
