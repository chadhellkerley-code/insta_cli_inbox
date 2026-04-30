const express = require('express');
const router = express.Router();
const { computeSummary } = require('../models/metricsModel');
const { getAccounts } = require('../models/accountModel');

// Middleware to ensure user is authenticated
function ensureAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

router.get('/', ensureAuth, async (req, res) => {
  const db = req.db;
  try {
    const metrics = await computeSummary(db, req.session.user.id);
    const accounts = await getAccounts(db, req.session.user.id);
    res.render('dashboard', {
      user: req.session.user,
      metrics,
      accounts,
    });
  } catch (err) {
    console.error('Dashboard error:', err.message);
    res.render('dashboard', {
      user: req.session.user,
      metrics: null,
      accounts: [],
      error: err.message,
    });
  }
});

module.exports = router;