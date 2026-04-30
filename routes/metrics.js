const express = require('express');
const router = express.Router();
const { computeSummary } = require('../models/metricsModel');

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
    res.render('metrics', { user: req.session.user, metrics, error: null });
  } catch (err) {
    console.error('Metrics error:', err.message);
    res.render('metrics', { user: req.session.user, metrics: null, error: err.message });
  }
});

module.exports = router;