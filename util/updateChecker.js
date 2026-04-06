const axios = require('axios');

/**
 * Compare two semantic version strings (e.g. "0.1.0" and "0.2.0"). Returns
 * true if `b` is greater than `a`. If either version is invalid or equal,
 * returns false.
 *
 * @param {string} a - current version
 * @param {string} b - version to compare
 */
function isVersionGreater(a, b) {
  const aParts = a.split('.').map((n) => parseInt(n, 10));
  const bParts = b.split('.').map((n) => parseInt(n, 10));
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aVal = aParts[i] || 0;
    const bVal = bParts[i] || 0;
    if (bVal > aVal) return true;
    if (bVal < aVal) return false;
  }
  return false;
}

/**
 * Check GitHub for a newer release. The repository to inspect must be
 * provided via the GITHUB_REPO environment variable in `owner/repo` form.
 * If a newer version is available, a message will be logged to the console.
 * This function does not perform any automatic update. Instead, it alerts
 * the administrator so they can decide when to apply the update.
 *
 * @param {string} currentVersion - the version currently running
 */
async function checkForUpdate(currentVersion) {
  const repo = process.env.GITHUB_REPO;
  if (!repo) {
    // Without a configured repo there is nothing to check
    console.warn('Update check skipped: GITHUB_REPO not set');
    return;
  }
  const url = `https://api.github.com/repos/${repo}/releases/latest`;
  try {
    const response = await axios.get(url, {
      headers: { 'User-Agent': 'insta-cli-inbox-update-check' },
    });
    const latest = response.data && (response.data.tag_name || response.data.name);
    if (!latest) {
      console.warn('Update check: unable to determine latest version');
      return;
    }
    if (isVersionGreater(currentVersion, latest)) {
      console.log(`You are running a newer version (${currentVersion}) than the latest release (${latest}).`);
    } else if (isVersionGreater(latest, currentVersion)) {
      console.log(
        `A newer version of Insta Cli Inbox is available: ${latest}. You are running ${currentVersion}.`,
      );
      console.log('Visit https://github.com/' + repo + ' to download the update.');
    } else {
      console.log('You are running the latest version of Insta Cli Inbox.');
    }
  } catch (err) {
    console.error('Failed to check for updates:', err.message);
  }
}

module.exports = { checkForUpdate };