const express = require('express');
const router = express.Router();
const { getChatsByThread, saveChat } = require('../models/chatModel');
const { getAccounts, getAccountById } = require('../models/accountModel');
const { login: igLogin, getInbox, getThreadMessages, sendMessage } = require('../util/igMobile');

// Ensure authentication
function ensureAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

// List inbox threads
router.get('/', ensureAuth, async (req, res) => {
  const db = req.db;
  const filter = req.query.filter || 'all'; // all, qualified, lost
  const search = req.query.search || '';
  try {
    // Aggregate latest message per thread
    const rows = await new Promise((resolve, reject) => {
      const sql =
        'SELECT thread_id, account_id, username, MAX(timestamp) AS last_timestamp, SUM(CASE WHEN tags LIKE "%qualified%" THEN 1 ELSE 0 END) AS qualified_count FROM chats GROUP BY thread_id, account_id, username ORDER BY last_timestamp DESC';
      db.all(sql, [], (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });
    // Filter by search
    let threads = rows.filter((r) => {
      return (
        r.username.toLowerCase().includes(search.toLowerCase()) ||
        r.thread_id.toLowerCase().includes(search.toLowerCase())
      );
    });
    // Filter by type
    const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    if (filter === 'qualified') {
      threads = threads.filter((t) => t.qualified_count > 0);
    } else if (filter === 'lost') {
      threads = threads.filter((t) => t.last_timestamp < twoWeeksAgo);
    }
    // Fetch accounts to map names
    const accounts = await getAccounts(db);
    const accountsMap = {};
    accounts.forEach((acc) => {
      accountsMap[acc.id] = acc.username;
    });
    res.render('inbox', {
      user: req.session.user,
      threads,
      accounts: accountsMap,
      filter,
      search,
    });
  } catch (err) {
    console.error('Inbox GET error:', err.message);
    res.render('inbox', {
      user: req.session.user,
      threads: [],
      accounts: {},
      filter,
      search,
      error: err.message,
    });
  }
});

// Show conversation
router.get('/thread/:threadId', ensureAuth, async (req, res) => {
  const db = req.db;
  const threadId = req.params.threadId;
  try {
    const chats = await getChatsByThread(db, threadId);
    // Determine account
    const accountId = chats.length > 0 ? chats[0].account_id : null;
    // If no local chats, attempt to fetch from IG directly (optional)
    // For now we display only stored messages
    res.render('thread', {
      user: req.session.user,
      threadId,
      chats,
      accountId,
      error: null,
    });
  } catch (err) {
    console.error('Thread GET error:', err.message);
    res.render('thread', {
      user: req.session.user,
      threadId,
      chats: [],
      accountId: null,
      error: err.message,
    });
  }
});

// Send a message in a thread
router.post('/thread/:threadId/send', ensureAuth, async (req, res) => {
  const db = req.db;
  const supabase = req.supabase;
  const threadId = req.params.threadId;
  const { accountId, message } = req.body;
  try {
    const account = await getAccountById(db, accountId);
    if (!account) {
      throw new Error('Cuenta no encontrada');
    }
    // Load existing session (if any)
    let sessionData = null;
    const sessionRows = await new Promise((resolve, reject) => {
      db.all(
        'SELECT * FROM sessions WHERE account_id = ? ORDER BY created_at DESC LIMIT 1',
        [accountId],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows);
        },
      );
    });
    if (sessionRows.length > 0) {
      sessionData = JSON.parse(sessionRows[0].session_data);
    }
    // Login to IG (restore session if possible)
    const { ig, session } = await igLogin(account, sessionData);
    // Send the message
    await sendMessage(ig, threadId, message);
    // Persist message locally and in Supabase
    const now = Date.now();
    await saveChat(db, supabase, {
      accountId,
      threadId,
      username: account.username,
      message,
      direction: 'out',
      timestamp: now,
      tags: null,
    });
    // Update session store
    const sessionJson = JSON.stringify(session);
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO sessions (account_id, session_data, cookies) VALUES (?, ?, ?)',
        [account.id, sessionJson, session.cookies || null],
        (err) => {
          if (err) return reject(err);
          resolve();
        },
      );
    });
    res.redirect(`/inbox/thread/${threadId}`);
  } catch (err) {
    console.error('Send message error:', err.message);
    // fallback: show thread with error
    const chats = await getChatsByThread(db, threadId);
    res.render('thread', {
      user: req.session.user,
      threadId,
      chats,
      accountId,
      error: err.message,
    });
  }
});

module.exports = router;