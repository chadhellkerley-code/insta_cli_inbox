const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Ensure that a `db` directory exists to hold the local SQLite database
const dbDir = path.join(__dirname, '..', 'db');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir);
}

const dbPath = path.join(dbDir, 'local.sqlite');

// Create a new SQLite database (or open existing one)
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Failed to open local SQLite database:', err.message);
    return;
  }
  console.log('Connected to local SQLite database');
});

function addColumnIfMissing(tableName, columnName, definition) {
  db.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`, (alterErr) => {
    if (!alterErr) {
      return;
    }

    if (/duplicate column name/i.test(alterErr.message)) {
      return;
    }

    console.error(`Failed to add column ${columnName} to ${tableName}:`, alterErr.message);
  });
}

// Initialise schema for local persistence. These tables store sensitive
// information such as IG account credentials and cookies. Passwords and
// tokens should be encrypted at rest; this skeleton does not implement
// encryption but you can extend it to use libs like bcrypt or crypto.
db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      password TEXT,
      twofactor TEXT,
      proxy_host TEXT,
      proxy_port INTEGER,
      proxy_username TEXT,
      proxy_password TEXT,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER,
      session_data TEXT,
      cookies TEXT,
      mobile_cookies TEXT,
      mobile_ua TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(account_id) REFERENCES accounts(id)
    )`,
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER,
      thread_id TEXT,
      username TEXT,
      message TEXT,
      direction TEXT,
      timestamp INTEGER,
      tags TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(account_id) REFERENCES accounts(id)
    )`,
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE,
      value TEXT
    )`,
  );

  [
    ['agent_id', 'TEXT'],
    ['owner_id', 'TEXT'],
    ['remote_id', 'INTEGER'],
    ['password', 'TEXT'],
    ['twofactor', 'TEXT'],
    ['proxy_host', 'TEXT'],
    ['proxy_port', 'INTEGER'],
    ['proxy_username', 'TEXT'],
    ['proxy_password', 'TEXT'],
    ['status', "TEXT DEFAULT 'active'"],
  ].forEach(([columnName, definition]) => {
    addColumnIfMissing('accounts', columnName, definition);
  });

  [
    ['mobile_cookies', 'TEXT'],
    ['mobile_ua', 'TEXT'],
    ['updated_at', 'DATETIME'],
  ].forEach(([columnName, definition]) => {
    addColumnIfMissing('sessions', columnName, definition);
  });
});

module.exports = { db };
