const express = require('express');
const router = express.Router();
const { listStages, upsertStage } = require('../models/configModel');

// Ensure authentication
function ensureAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

router.get('/', ensureAuth, async (req, res) => {
  const supabase = req.supabase;
  try {
    const stages = await listStages(supabase, req.session.user.id);
    res.render('config', { user: req.session.user, stages, error: null });
  } catch (err) {
    console.error('Config GET error:', err.message);
    res.render('config', { user: req.session.user, stages: [], error: err.message });
  }
});

// Handle stage creation / update
router.post('/stage', ensureAuth, async (req, res) => {
  const supabase = req.supabase;
  const { id, name, messages, delay, followUps, aiPrompt, followupHours } = req.body;
  // Parse comma‑separated lists
  const messagesArr = messages ? messages.split('\n').map((s) => s.trim()).filter(Boolean) : [];
  const followUpsArr = followUps ? followUps.split('\n').map((s) => s.trim()).filter(Boolean) : [];
  const followupHoursArr = followupHours
    ? followupHours.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n))
    : [];
  try {
    await upsertStage(supabase, req.session.user.id, {
      id: id || undefined,
      name,
      messages: messagesArr,
      delay: parseInt(delay, 10) || 0,
      followUps: followUpsArr,
      aiPrompt: aiPrompt || null,
      followupHours: followupHoursArr,
    });
    res.redirect('/config');
  } catch (err) {
    console.error('Config POST error:', err.message);
    const stages = await listStages(supabase, req.session.user.id);
    res.render('config', { user: req.session.user, stages, error: err.message });
  }
});

module.exports = router;