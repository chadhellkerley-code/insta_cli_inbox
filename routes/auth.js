const express = require('express');
const router = express.Router();
const {
  registerUser,
  loginUser,
  getProfile,
  isUserExpired,
} = require('../models/userModel');

// Render login page
router.get('/login', (req, res) => {
  res.render('login', { error: null });
});

// Handle login submission
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const supabase = req.supabase;
  try {
    const user = await loginUser(supabase, email, password);
    const profile = await getProfile(supabase, user.id);
    if (isUserExpired(profile)) {
      return res.render('login', { error: 'Tu usuario está expirado. Contactá al administrador.' });
    }
    // Store minimal info in session
    req.session.user = {
      id: user.id,
      email: user.email,
      role: profile.role,
      expiresAt: profile.expires_at,
    };
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Login error:', err.message);
    res.render('login', { error: err.message });
  }
});

// Render registration page (for owner to add new users)
router.get('/register', (req, res) => {
  // Only allow access if logged in and user is owner
  if (!req.session.user || req.session.user.role !== 'owner') {
    return res.redirect('/login');
  }
  res.render('register', { error: null });
});

// Handle registration
router.post('/register', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'owner') {
    return res.redirect('/login');
  }
  const { email, password, expiresAt } = req.body;
  const supabase = req.supabase;
  try {
    await registerUser(supabase, email, password, 'user', expiresAt || null);
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Registration error:', err.message);
    res.render('register', { error: err.message });
  }
});

// Logout
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

module.exports = router;