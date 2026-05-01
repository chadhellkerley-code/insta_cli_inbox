const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { parse } = require('csv-parse');
const {
  addAccount,
  getAccounts,
  getAccountById,
  updateAccount,
  deleteAccount,
} = require('../models/accountModel');
const { login } = require('../util/igMobile');
const { loginWithChrome } = require('../util/playwrightLogin');

const router = express.Router();

const tempDir = path.join(__dirname, '..', 'tmp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

const upload = multer({
  dest: tempDir,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

const CSV_COLUMNS = [
  'username',
  'password',
  'secret_2fa',
  'proxy_host',
  'proxy_port',
  'proxy_username',
  'proxy_password',
];

function ensureAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

function normalizeNullableText(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function normalizePassword(value) {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value);
}

function normalizeProxyConfig({ proxy_host, proxy_port, proxy_username, proxy_password }) {
  const host = normalizeNullableText(proxy_host);

  if (!host) {
    return {
      proxy_host: null,
      proxy_port: null,
      proxy_username: null,
      proxy_password: null,
    };
  }

  const rawPort = normalizeNullableText(proxy_port);
  if (rawPort && !/^\d+$/.test(rawPort)) {
    throw new Error('El puerto del proxy debe ser numérico.');
  }

  return {
    proxy_host: host,
    proxy_port: rawPort ? parseInt(rawPort, 10) : null,
    proxy_username: normalizeNullableText(proxy_username),
    proxy_password: normalizeNullableText(proxy_password),
  };
}

function buildAccountPayload(input) {
  const username = normalizeNullableText(input.username);
  const password = normalizePassword(input.password);
  const proxyConfig = normalizeProxyConfig(input);
  const twofactor = normalizeNullableText(input.secret_2fa || input.twofactor);

  if (!username) {
    throw new Error('El usuario es obligatorio.');
  }

  if (!password.trim()) {
    throw new Error('La contraseña es obligatoria.');
  }

  return {
    username,
    password,
    twofactor,
    ...proxyConfig,
  };
}

function isOptionalHeaderRow(row) {
  if (!Array.isArray(row)) {
    return false;
  }

  return CSV_COLUMNS.every((column, index) => {
    const value = row[index];
    return String(value || '').trim().toLowerCase() === column;
  });
}

function parseCsvFile(filePath) {
  return new Promise((resolve, reject) => {
    const records = [];

    fs.createReadStream(filePath)
      .pipe(
        parse({
          bom: true,
          relax_column_count: true,
          skip_empty_lines: false,
          trim: true,
        }),
      )
      .on('data', (record) => records.push(record))
      .on('end', () => resolve(records))
      .on('error', reject);
  });
}

async function removeTempFile(filePath) {
  if (!filePath) {
    return;
  }

  try {
    await fs.promises.unlink(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn('No se pudo eliminar el CSV temporal:', err.message);
    }
  }
}

async function renderAccountsPage(req, res, overrides = {}, statusCode = 200) {
  const accounts = await getAccounts(req.db);
  const errorMessage = overrides.error !== undefined ? overrides.error : normalizeNullableText(req.query.error);
  const successMessage =
    overrides.success !== undefined ? overrides.success : normalizeNullableText(req.query.success);
  const warningMessage =
    overrides.warning !== undefined ? overrides.warning : normalizeNullableText(req.query.warning);

  res.status(statusCode).render('accounts', {
    user: req.session.user,
    accounts,
    error: errorMessage,
    success: successMessage,
    warning: warningMessage,
    editingAccount: null,
    ...overrides,
  });
}

function getLatestSessionRow(db, accountId) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT * FROM sessions WHERE account_id = ? ORDER BY created_at DESC LIMIT 1',
      [accountId],
      (err, row) => {
        if (err) {
          return reject(err);
        }

        return resolve(row || null);
      },
    );
  });
}

function insertSerializedSession(db, accountId, session) {
  const sessionJson = JSON.stringify(session);

  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO sessions (account_id, session_data, cookies, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
      [accountId, sessionJson, session.cookies || null],
      (err) => {
        if (err) {
          return reject(err);
        }

        return resolve();
      },
    );
  });
}

function parseSessionData(sessionRow) {
  if (!sessionRow || !sessionRow.session_data) {
    return null;
  }

  try {
    return JSON.parse(sessionRow.session_data);
  } catch (err) {
    console.warn('No se pudo restaurar la sesion guardada:', err.message);
    return null;
  }
}

function buildAccountsRedirect(params = {}) {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      searchParams.set(key, value);
    }
  });

  const queryString = searchParams.toString();
  return queryString ? `/accounts?${queryString}` : '/accounts';
}

function translateInstagramError(error) {
  const message = error && error.message ? error.message : '';
  const normalized = message.toLowerCase();

  if (!message) {
    return 'No se pudo iniciar sesion en Instagram.';
  }

  if (normalized.includes('chrome no encontrado')) {
    return 'Chrome no encontrado. Por favor instala Google Chrome.';
  }

  if (
    normalized.includes('instagram tardo demasiado') ||
    normalized.includes('instagram tardó demasiado') ||
    normalized.includes('timeout')
  ) {
    return 'Instagram tardo demasiado. Intenta de nuevo.';
  }

  if (
    normalized.includes('usuario o contrasena incorrectos') ||
    normalized.includes('usuario o contraseña incorrectos')
  ) {
    return 'Usuario o contrasena incorrectos.';
  }

  if (
    normalized.includes('codigo de verificacion es incorrecto') ||
    normalized.includes('código de verificación es incorrecto')
  ) {
    return 'El codigo de verificacion es incorrecto o vencio.';
  }

  if (
    normalized.includes('checkpoint') ||
    normalized.includes('challenge') ||
    normalized.includes('suspicious login')
  ) {
    return 'Instagram pidio una verificacion adicional. Revisa la ventana de Chrome e intentalo de nuevo.';
  }

  if (normalized.includes('proxy')) {
    return 'No se pudo conectar a Instagram con el proxy configurado.';
  }

  return message;
}

async function syncAccountUpdateToSupabase(supabase, currentAccount, updatedFields, ownerId) {
  try {
    const payload = {
      password: updatedFields.password,
      twofactor: updatedFields.twofactor,
      proxy_host: updatedFields.proxy_host,
      proxy_port: updatedFields.proxy_port,
      proxy_username: updatedFields.proxy_username,
      proxy_password: updatedFields.proxy_password,
    };

    let query = supabase.from('accounts').update(payload).eq('username', currentAccount.username);

    if (ownerId) {
      query = query.eq('owner_id', ownerId);
    }

    const { error } = await query;
    if (error) {
      throw error;
    }
  } catch (err) {
    console.warn('Supabase update for accounts failed:', err.message);
  }
}

async function syncAccountDeleteToSupabase(supabase, account, ownerId) {
  try {
    let query = supabase.from('accounts').delete().eq('username', account.username);

    if (ownerId) {
      query = query.eq('owner_id', ownerId);
    }

    const { error } = await query;
    if (error) {
      throw error;
    }
  } catch (err) {
    console.warn('Supabase delete for accounts failed:', err.message);
  }
}

router.get('/', ensureAuth, async (req, res) => {
  try {
    await renderAccountsPage(req, res);
  } catch (err) {
    console.error('Accounts GET error:', err.message);
    res.status(500).render('accounts', {
      user: req.session.user,
      accounts: [],
      error: err.message,
      success: null,
      warning: null,
      editingAccount: null,
    });
  }
});

router.post('/add', ensureAuth, async (req, res) => {
  const db = req.db;
  const supabase = req.supabase;

  try {
    const accountPayload = buildAccountPayload(req.body);

    await addAccount(db, supabase, {
      ...accountPayload,
      owner_id: req.session.user.id,
    });

    res.redirect('/accounts');
  } catch (err) {
    console.error('Accounts POST error:', err.message);
    await renderAccountsPage(req, res, { error: err.message }, 400);
  }
});

router.post('/import-csv', ensureAuth, (req, res) => {
  upload.single('csv_file')(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({
        imported: 0,
        skipped: 0,
        errors: [uploadErr.message],
      });
    }

    const filePath = req.file ? req.file.path : null;
    const db = req.db;
    const supabase = req.supabase;

    try {
      if (!req.file) {
        return res.status(400).json({
          imported: 0,
          skipped: 0,
          errors: ['Debes seleccionar un archivo CSV.'],
        });
      }

      const rows = await parseCsvFile(filePath);
      const startIndex = rows.length > 0 && isOptionalHeaderRow(rows[0]) ? 1 : 0;
      let imported = 0;
      let skipped = 0;
      const errors = [];

      for (let index = startIndex; index < rows.length; index += 1) {
        const rawRow = Array.isArray(rows[index]) ? rows[index].slice(0, CSV_COLUMNS.length) : [];
        while (rawRow.length < CSV_COLUMNS.length) {
          rawRow.push('');
        }

        const [
          username,
          password,
          secret_2fa,
          proxy_host,
          proxy_port,
          proxy_username,
          proxy_password,
        ] = rawRow.map((value) => String(value || '').trim());

        if (![username, password, secret_2fa, proxy_host, proxy_port, proxy_username, proxy_password].some(Boolean)) {
          continue;
        }

        try {
          const accountPayload = buildAccountPayload({
            username,
            password,
            secret_2fa,
            proxy_host,
            proxy_port,
            proxy_username,
            proxy_password,
          });

          await addAccount(db, supabase, {
            ...accountPayload,
            owner_id: req.session.user.id,
          });
          imported += 1;
        } catch (rowErr) {
          skipped += 1;
          errors.push(`Fila ${index + 1}: ${rowErr.message}`);
        }
      }

      return res.json({ imported, skipped, errors });
    } catch (err) {
      console.error('Accounts CSV import error:', err.message);
      return res.status(500).json({
        imported: 0,
        skipped: 0,
        errors: [err.message],
      });
    } finally {
      await removeTempFile(filePath);
    }
  });
});

router.get('/csv-template', ensureAuth, async (req, res) => {
  try {
    const csvTemplate = [
      'username,password,secret_2fa,proxy_host,proxy_port,proxy_username,proxy_password',
      'mi_cuenta,mi_password,JBSWY3DPEHPK3PXP,192.168.1.1,8080,proxyuser,proxypass',
      'otra_cuenta,otra_pass,,,,,',
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="accounts-template.csv"');
    res.send(csvTemplate);
  } catch (err) {
    console.error('Accounts CSV template error:', err.message);
    await renderAccountsPage(req, res, { error: err.message }, 500);
  }
});

router.get('/edit/:id', ensureAuth, async (req, res) => {
  try {
    const editingAccount = await getAccountById(req.db, req.params.id);

    if (!editingAccount) {
      return renderAccountsPage(req, res, { error: 'Cuenta no encontrada.' }, 404);
    }

    return renderAccountsPage(req, res, { editingAccount });
  } catch (err) {
    console.error('Accounts edit GET error:', err.message);
    return renderAccountsPage(req, res, { error: err.message }, 500);
  }
});

router.post('/edit/:id', ensureAuth, async (req, res) => {
  const db = req.db;
  const supabase = req.supabase;

  try {
    const currentAccount = await getAccountById(db, req.params.id);

    if (!currentAccount) {
      return renderAccountsPage(req, res, { error: 'Cuenta no encontrada.' }, 404);
    }

    const accountPayload = buildAccountPayload({
      username: currentAccount.username,
      password: req.body.password,
      secret_2fa: req.body.secret_2fa,
      proxy_host: req.body.proxy_host,
      proxy_port: req.body.proxy_port,
      proxy_username: req.body.proxy_username,
      proxy_password: req.body.proxy_password,
    });

    const changes = await updateAccount(db, req.params.id, accountPayload);
    if (!changes) {
      throw new Error('No se pudo actualizar la cuenta.');
    }

    await syncAccountUpdateToSupabase(supabase, currentAccount, accountPayload, req.session.user.id);

    return res.redirect('/accounts');
  } catch (err) {
    console.error('Accounts edit POST error:', err.message);

    const editingAccount = await getAccountById(db, req.params.id);
    return renderAccountsPage(
      req,
      res,
      {
        error: err.message,
        editingAccount: editingAccount
          ? {
              ...editingAccount,
              password: req.body.password,
              twofactor: req.body.secret_2fa,
              proxy_host: req.body.proxy_host,
              proxy_port: req.body.proxy_port,
              proxy_username: req.body.proxy_username,
              proxy_password: req.body.proxy_password,
            }
          : null,
      },
      400,
    );
  }
});

router.delete('/:id', ensureAuth, async (req, res) => {
  const db = req.db;
  const supabase = req.supabase;

  try {
    const account = await getAccountById(db, req.params.id);

    if (!account) {
      return res.redirect(buildAccountsRedirect({ error: 'Cuenta no encontrada.' }));
    }

    const changes = await deleteAccount(db, req.params.id);
    if (!changes) {
      return res.status(404).send('Cuenta no encontrada');
    }

    await syncAccountDeleteToSupabase(supabase, account, req.session.user.id);

    return res.redirect('/accounts');
  } catch (err) {
    console.error('Accounts DELETE error:', err.message);
    return res.status(500).send('No se pudo eliminar la cuenta');
  }
});

/**
 * Intenta iniciar sesion con Chrome real usando un perfil persistente por cuenta.
 * Si Playwright falla, hace fallback al login movil de instagram-private-api.
 */
router.get('/login/:id', ensureAuth, async (req, res) => {
  const db = req.db;

  try {
    const account = await getAccountById(db, req.params.id);
    if (!account) {
      return res.redirect(buildAccountsRedirect({ error: 'Cuenta no encontrada.' }));
    }

    const sessionRow = await getLatestSessionRow(db, account.id);
    const sessionData = parseSessionData(sessionRow);

    try {
      const result = await loginWithChrome(account);

      return res.redirect(
        buildAccountsRedirect({
          success: `Sesion iniciada con Chrome para ${account.username}.`,
          warning: result.warning || null,
        }),
      );
    } catch (playwrightErr) {
      const playwrightMessage = translateInstagramError(playwrightErr);
      console.warn('Playwright login warning:', playwrightMessage);

      try {
        const { session } = await login(account, sessionData);
        await insertSerializedSession(db, account.id, session);

        return res.redirect(
          buildAccountsRedirect({
            success: `Sesion iniciada para ${account.username} usando el fallback movil.`,
            warning: `No se pudo usar Chrome real. ${playwrightMessage}`,
          }),
        );
      } catch (mobileErr) {
        const mobileMessage = translateInstagramError(mobileErr);

        return res.redirect(
          buildAccountsRedirect({
            error: `No se pudo iniciar sesion en Instagram. ${mobileMessage}`,
            warning: `Intento con Chrome real: ${playwrightMessage}`,
          }),
        );
      }
    }
  } catch (err) {
    console.error('IG login error:', err.message);
    return res.redirect(
      buildAccountsRedirect({
        error: `No se pudo iniciar sesion en Instagram. ${translateInstagramError(err)}`,
      }),
    );
  }
});

module.exports = router;
