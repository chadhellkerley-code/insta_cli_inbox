const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// Load environment variables from .env file if present
dotenv.config();

// Initialise Supabase client and local SQLite connection
const { supabase } = require('./config/supabase');
const { db } = require('./config/sqlite');
const updateChecker = require('./util/updateChecker');

// Create local directories if they don't exist. These folders mirror the
// specification: `browser` for isolated Chrome profiles, `sesiones` for
// persistent IG sessions (SQLite), `chats` for local chat histories,
// and `cache` for deleted data that should be auto‑purged after 5 days.
['browser', 'sesiones', 'chats', 'cache'].forEach((dir) => {
  const fullPath = path.join(__dirname, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath);
  }
});

const app = express();

// Configure view engine (EJS) and static assets
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));

// Parse incoming request bodies
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Session middleware. Sessions are used to remember the authenticated user
// across requests. The secret should be overridden via the SESSION_SECRET
// environment variable in production.
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'insta_cli_inbox_secret',
    resave: false,
    saveUninitialized: false,
  }),
);

// Make supabase and sqlite available on the request object for convenience
app.use((req, res, next) => {
  req.supabase = supabase;
  req.db = db;
  next();
});

// Route registrations. Each module handles a logical section of the app.
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const accountRoutes = require('./routes/accounts');
const configRoutes = require('./routes/config');
const inboxRoutes = require('./routes/inbox');
const metricsRoutes = require('./routes/metrics');

app.use('/', authRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/accounts', accountRoutes);
app.use('/config', configRoutes);
app.use('/inbox', inboxRoutes);
app.use('/metrics', metricsRoutes);

// Default route: redirect to login or dashboard depending on session
app.get('/', (req, res) => {
  if (req.session && req.session.user) {
    res.redirect('/dashboard');
  } else {
    res.redirect('/login');
  }
});

// Periodically purge items in the cache folder that are older than 5 days.
const MS_PER_DAY = 24 * 60 * 60 * 1000;
function purgeCache() {
  const cacheDir = path.join(__dirname, 'cache');
  fs.readdir(cacheDir, (err, files) => {
    if (err) return;
    files.forEach((file) => {
      const filePath = path.join(cacheDir, file);
      fs.stat(filePath, (err, stats) => {
        if (err) return;
        const now = Date.now();
        if (now - stats.mtimeMs > 5 * MS_PER_DAY) {
          fs.unlink(filePath, () => {});
        }
      });
    });
  });
}
// Run purge on startup and then every day
purgeCache();
setInterval(purgeCache, MS_PER_DAY);

// TODO: schedule monthly export of chat activity and auto‑delete conversations
// older than two months. This can be implemented using node‑schedule or
// cron, but is left as a placeholder for future development.

// Start the HTTP server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Insta Cli Inbox server running on port ${port}`);
  // Check for updates asynchronously when the server starts. Any update
  // notifications will be logged to the console. Update logic lives in
  // util/updateChecker.js. It will not perform the update automatically; it
  // merely informs the administrator that a new version is available.
  try {
    const pkg = require('./package.json');
    updateChecker.checkForUpdate(pkg.version).catch((err) => {
      console.error('Update check failed:', err.message);
    });
  } catch (err) {
    console.error('Unable to read package version for update check', err);
  }
});

module.exports = app;