const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

dotenv.config();

const { supabase } = require('./config/supabase');
const { db } = require('./config/sqlite');
const updateChecker = require('./util/updateChecker');
const { startLocalAgentBridge } = require('./util/localAgentBridge');

['browser', 'sesiones', 'chats', 'cache'].forEach((dir) => {
  const fullPath = path.join(__dirname, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath);
  }
});

const app = express();

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'insta_cli_inbox_secret',
    resave: false,
    saveUninitialized: false,
  }),
);

app.use((req, res, next) => {
  req.supabase = supabase;
  req.db = db;
  next();
});

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

app.get('/', (req, res) => {
  if (req.session && req.session.user) {
    res.redirect('/dashboard');
    return;
  }

  res.redirect('/login');
});

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function purgeCache() {
  const cacheDir = path.join(__dirname, 'cache');
  fs.readdir(cacheDir, (err, files) => {
    if (err) return;

    files.forEach((file) => {
      const filePath = path.join(cacheDir, file);
      fs.stat(filePath, (statError, stats) => {
        if (statError) return;

        if (Date.now() - stats.mtimeMs > 5 * MS_PER_DAY) {
          fs.unlink(filePath, () => {});
        }
      });
    });
  });
}

purgeCache();
setInterval(purgeCache, MS_PER_DAY);
startLocalAgentBridge({ supabase, db });

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Insta Cli Inbox server running on port ${port}`);

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
