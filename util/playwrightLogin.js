const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { chromium } = require('playwright');
const { TOTP } = require('totp-generator');
const { db } = require('../config/sqlite');

const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires';
const LOGIN_URL = 'https://www.instagram.com/accounts/login/';
const IPHONE_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const LOGIN_INPUT_SELECTOR = 'input[name="username"]';
const PASSWORD_INPUT_SELECTOR = 'input[name="password"]';
const TWO_FACTOR_SELECTOR = [
  'input[name="verificationCode"]',
  'input[aria-label*="código"]',
  'input[aria-label*="codigo"]',
  'input[inputmode="numeric"]',
].join(', ');

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        return reject(err);
      }

      return resolve(this);
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        return reject(err);
      }

      return resolve(row || null);
    });
  });
}

function buildProxyConfig(account) {
  if (!account.proxy_host || !account.proxy_port) {
    return null;
  }

  return {
    server: `http://${account.proxy_host}:${account.proxy_port}`,
    ...(account.proxy_username ? { username: account.proxy_username } : {}),
    ...(account.proxy_password ? { password: account.proxy_password } : {}),
  };
}

function findChromeExecutable() {
  const candidates = [];

  if (process.platform === 'win32') {
    const windowsRoots = [
      process.env.PROGRAMFILES,
      process.env['PROGRAMFILES(X86)'],
      process.env.LOCALAPPDATA,
    ].filter(Boolean);

    windowsRoots.forEach((rootDir) => {
      candidates.push(path.join(rootDir, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    });
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  } else {
    candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium-browser');
  }

  const chromePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!chromePath) {
    throw new Error('Chrome no encontrado. Por favor instala Google Chrome.');
  }

  return chromePath;
}

async function getTimezoneFromProxy(proxyHost) {
  if (!proxyHost) {
    return DEFAULT_TIMEZONE;
  }

  try {
    const response = await axios.get(`http://ip-api.com/json/${encodeURIComponent(proxyHost)}`, {
      timeout: 5000,
    });

    if (response && response.data && typeof response.data.timezone === 'string' && response.data.timezone) {
      return response.data.timezone;
    }
  } catch (err) {
    console.warn('No se pudo detectar la zona horaria desde el proxy:', err.message);
  }

  return DEFAULT_TIMEZONE;
}

async function isSelectorVisible(page, selector, timeout = 500) {
  try {
    await page.locator(selector).first().waitFor({ state: 'visible', timeout });
    return true;
  } catch (err) {
    return false;
  }
}

async function clickFirstVisible(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();

    try {
      await locator.waitFor({ state: 'visible', timeout: 1000 });
      await locator.click();
      return true;
    } catch (err) {
      continue;
    }
  }

  return false;
}

async function getBodyText(page) {
  try {
    return await page.locator('body').innerText({ timeout: 1000 });
  } catch (err) {
    return '';
  }
}

async function isAlreadyLoggedIn(page) {
  const currentUrl = page.url();

  if (
    /instagram\.com/i.test(currentUrl) &&
    !/accounts\/login/i.test(currentUrl) &&
    !/challenge\//i.test(currentUrl) &&
    (/instagram\.com\/?$/i.test(currentUrl) || /\/direct\//i.test(currentUrl))
  ) {
    return true;
  }

  const loggedInSelectors = [
    'nav',
    'a[href="/"]',
    'a[href="/direct/inbox/"]',
    'svg[aria-label="Inicio"]',
    'svg[aria-label="Home"]',
  ];

  for (const selector of loggedInSelectors) {
    if (await isSelectorVisible(page, selector)) {
      return true;
    }
  }

  try {
    const content = await page.content();
    return content.includes('/_/seb/ajax') && !content.includes('name="username"');
  } catch (err) {
    return false;
  }
}

async function detectInstagramError(page) {
  const bodyText = (await getBodyText(page)).toLowerCase();

  if (!bodyText) {
    return null;
  }

  if (bodyText.includes('incorrect password') || bodyText.includes('contraseña no era correcta')) {
    return 'Usuario o contrasena incorrectos.';
  }

  if (bodyText.includes('the username you entered doesn\'t belong to an account')) {
    return 'El usuario ingresado no existe en Instagram.';
  }

  if (bodyText.includes('código no es válido') || bodyText.includes('code you entered is incorrect')) {
    return 'El codigo de verificacion es incorrecto o vencio.';
  }

  if (bodyText.includes('try again later') || bodyText.includes('inténtalo nuevamente más tarde')) {
    return 'Instagram bloqueo temporalmente el acceso. Intenta de nuevo mas tarde.';
  }

  return null;
}

async function detectChallenge(page) {
  const bodyText = (await getBodyText(page)).toLowerCase();
  const currentUrl = page.url().toLowerCase();

  return (
    bodyText.includes('suspicious login') ||
    bodyText.includes('inicio de sesión sospechoso') ||
    bodyText.includes('help us confirm you own this account') ||
    bodyText.includes('verifica tu identidad') ||
    currentUrl.includes('/challenge/')
  );
}

async function clearInput(page, selector) {
  const locator = page.locator(selector).first();
  await locator.click({ timeout: 5000 });
  await locator.fill('');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');
}

async function typeLikeHuman(page, selector, value) {
  await clearInput(page, selector);

  for (const character of String(value || '')) {
    await page.keyboard.type(character, { delay: randomBetween(80, 150) });
  }
}

async function dismissCookieBanner(page) {
  await clickFirstVisible(page, [
    'button:has-text("Permitir todas las cookies")',
    'button:has-text("Allow all cookies")',
    'button:has-text("Aceptar")',
  ]);
}

async function dismissInstagramDialogs(page) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const clicked = await clickFirstVisible(page, [
      'button:has-text("Ahora no")',
      'button:has-text("Not Now")',
      'div[role="button"]:has-text("Ahora no")',
      'div[role="button"]:has-text("Not Now")',
    ]);

    if (!clicked) {
      break;
    }

    await sleep(400);
  }
}

async function submitLogin(page) {
  const clicked = await clickFirstVisible(page, [
    'button[type="submit"]',
    'div[role="button"]:has-text("Iniciar sesión")',
    'div[role="button"]:has-text("Log in")',
  ]);

  if (!clicked) {
    await page.keyboard.press('Enter');
  }
}

async function completeTwoFactor(page, account) {
  const twoFactorDeadline = Date.now() + 10000;

  while (Date.now() < twoFactorDeadline) {
    if (await isSelectorVisible(page, TWO_FACTOR_SELECTOR, 500)) {
      if (!account.twofactor) {
        throw new Error('Instagram pidio verificacion en dos pasos y la cuenta no tiene un secreto 2FA configurado.');
      }

      const { otp } = await TOTP.generate(account.twofactor, {
        digits: 6,
        explicitZeroPad: true,
      });

      await typeLikeHuman(page, TWO_FACTOR_SELECTOR, otp);

      const clicked = await clickFirstVisible(page, [
        'button[type="submit"]',
        'button:has-text("Confirmar")',
        'button:has-text("Continuar")',
        'button:has-text("Enviar")',
        'div[role="button"]:has-text("Confirmar")',
        'div[role="button"]:has-text("Continuar")',
      ]);

      if (!clicked) {
        await page.keyboard.press('Enter');
      }

      return true;
    }

    const loginError = await detectInstagramError(page);
    if (loginError) {
      throw new Error(loginError);
    }

    if (await isAlreadyLoggedIn(page) || (await detectChallenge(page))) {
      return false;
    }

    await sleep(400);
  }

  return false;
}

async function waitForSuccessfulLogin(page) {
  const deadline = Date.now() + 15000;
  let challengeDetected = false;

  while (Date.now() < deadline) {
    if (await isAlreadyLoggedIn(page)) {
      return { challengeDetected, warning: null };
    }

    const loginError = await detectInstagramError(page);
    if (loginError) {
      throw new Error(loginError);
    }

    if (await detectChallenge(page)) {
      challengeDetected = true;
      console.warn('Instagram mostro un challenge o un inicio de sesion sospechoso.');
      return {
        challengeDetected: true,
        warning: 'Instagram pidio una verificacion adicional. Revisa la ventana de Chrome.',
      };
    }

    await sleep(500);
  }

  throw new Error('Instagram tardo demasiado. Intenta de nuevo.');
}

function extractCookiesObject(cookies) {
  const cookieMap = new Map();

  cookies
    .filter((cookie) => typeof cookie.domain === 'string' && cookie.domain.includes('instagram.com'))
    .forEach((cookie) => {
      cookieMap.set(cookie.name, cookie.value);
    });

  const cookieString = Array.from(cookieMap.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');

  return {
    cookieString,
    sessionid: cookieMap.get('sessionid') || null,
    csrftoken: cookieMap.get('csrftoken') || null,
    ds_user_id: cookieMap.get('ds_user_id') || null,
    mid: cookieMap.get('mid') || null,
    ig_did: cookieMap.get('ig_did') || null,
    userAgent: IPHONE_USER_AGENT,
  };
}

async function saveMobileCookies(accountId, cookiesObject) {
  if (!accountId) {
    throw new Error('No se pudo guardar la sesion porque falta el identificador de la cuenta.');
  }

  const sessionRow = await dbGet('SELECT id FROM sessions WHERE account_id = ? ORDER BY created_at DESC LIMIT 1', [
    accountId,
  ]);

  const mobileCookies = JSON.stringify(cookiesObject);

  if (sessionRow) {
    await dbRun(
      'UPDATE sessions SET mobile_cookies = ?, mobile_ua = ?, updated_at = CURRENT_TIMESTAMP WHERE account_id = ?',
      [mobileCookies, IPHONE_USER_AGENT, accountId],
    );
    return;
  }

  await dbRun(
    'INSERT INTO sessions (account_id, mobile_cookies, mobile_ua, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
    [accountId, mobileCookies, IPHONE_USER_AGENT],
  );
}

function normalizeLoginError(error) {
  const message = error && error.message ? error.message : '';

  if (!message) {
    return new Error('No se pudo iniciar sesion en Instagram.');
  }

  if (/chrome no encontrado/i.test(message)) {
    return new Error('Chrome no encontrado. Por favor instala Google Chrome.');
  }

  if (/timeout|timed out/i.test(message)) {
    return new Error('Instagram tardo demasiado. Intenta de nuevo.');
  }

  if (/net::err_proxy|proxy|econnreset|econnrefused/i.test(message)) {
    return new Error('No se pudo conectar a Instagram con el proxy configurado.');
  }

  return new Error(message);
}

async function loginWithChrome(account) {
  if (!account || !account.username || !account.password) {
    throw new Error('La cuenta no tiene usuario o contrasena configurados.');
  }

  const chromePath = findChromeExecutable();
  const timezoneId = await getTimezoneFromProxy(account.proxy_host);
  const userDataDir = path.join(__dirname, '..', 'browser', account.username);
  await fs.promises.mkdir(userDataDir, { recursive: true });
  const proxyConfig = buildProxyConfig(account);

  let context;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      executablePath: chromePath,
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--disable-dev-shm-usage',
        '--disable-extensions-except=',
        '--disable-plugins-discovery',
        '--no-first-run',
        '--no-default-browser-check',
        '--password-store=basic',
        '--use-mock-keychain',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
      ...(proxyConfig ? { proxy: proxyConfig } : {}),
      viewport: { width: 390, height: 844 },
      userAgent: IPHONE_USER_AGENT,
      locale: 'es-ES',
      timezoneId,
    });

    const page = context.pages()[0] || (await context.newPage());
    await page.goto(LOGIN_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });

    await dismissCookieBanner(page);

    let formVisible = true;

    try {
      await page.waitForSelector(LOGIN_INPUT_SELECTOR, { state: 'visible', timeout: 5000 });
    } catch (err) {
      if (await isAlreadyLoggedIn(page)) {
        formVisible = false;
      } else {
        await page.waitForSelector(LOGIN_INPUT_SELECTOR, { state: 'visible', timeout: 10000 });
      }
    }

    if (formVisible) {
      await typeLikeHuman(page, LOGIN_INPUT_SELECTOR, account.username);
      await typeLikeHuman(page, PASSWORD_INPUT_SELECTOR, account.password);
      await sleep(randomBetween(500, 1000));
      await submitLogin(page);
    }

    await completeTwoFactor(page, account);
    const loginResult = await waitForSuccessfulLogin(page);
    await dismissInstagramDialogs(page);

    const cookies = await context.cookies();
    const cookiesObject = extractCookiesObject(cookies);

    if (!cookiesObject.cookieString) {
      throw new Error('No se pudieron extraer las cookies de Instagram.');
    }

    await saveMobileCookies(account.id, cookiesObject);

    return {
      success: true,
      username: account.username,
      cookiesExtracted: true,
      ...(loginResult.warning ? { warning: loginResult.warning } : {}),
    };
  } catch (err) {
    throw normalizeLoginError(err);
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

module.exports = {
  getTimezoneFromProxy,
  loginWithChrome,
};
