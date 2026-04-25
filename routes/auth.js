const express = require('express');
const router = express.Router();

router.all(['/login', '/register'], (req, res) => {
  res.status(410).send('El acceso por credenciales fue eliminado. Usá Google OAuth en la app web.');
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

module.exports = router;
