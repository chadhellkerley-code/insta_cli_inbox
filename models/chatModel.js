const util = require('util');

// Promisify sqlite operations
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
 * Persist a single chat message both locally in SQLite and remotely in Supabase.
 * Tags can be provided as a comma‑separated string. The timestamp should
 * represent the message time in milliseconds since epoch.
 */
async function saveChat(
  db,
  supabase,
  { accountId, localAccountId, remoteAccountId, threadId, username, message, direction, timestamp, tags },
) {
  const sqliteAccountId = localAccountId ?? accountId;
  const supabaseAccountId = remoteAccountId ?? accountId;

  await runAsync(
    db,
    `INSERT INTO chats (account_id, thread_id, username, message, direction, timestamp, tags) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [sqliteAccountId, threadId, username, message, direction, timestamp, tags || null],
  );
  // Insert into Supabase `chats` table if it exists
  try {
    await supabase.from('chats').insert({
      account_id: supabaseAccountId,
      thread_id: threadId,
      username,
      message,
      direction,
      timestamp,
      tags,
    });
  } catch (err) {
    console.warn('Supabase insert for chats failed:', err.message);
  }
}

/**
 * Fetch chats for a given thread id from local SQLite. Results are ordered
 * ascending by timestamp.
 */
async function getChatsByThread(db, threadId, ownerId) {
  return allAsync(
    db,
    `SELECT c.*
     FROM chats c
     JOIN accounts a ON a.id = c.account_id
     WHERE c.thread_id = ? AND a.owner_id = ?
     ORDER BY c.timestamp ASC`,
    [threadId, ownerId],
  );
}

/**
 * Update tags for a chat message by id.
 */
async function updateChatTags(db, id, tags) {
  await runAsync(db, 'UPDATE chats SET tags = ? WHERE id = ?', [tags, id]);
}

module.exports = {
  saveChat,
  getChatsByThread,
  updateChatTags,
};
