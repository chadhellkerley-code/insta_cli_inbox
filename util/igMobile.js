const { IgApiClient } = require('instagram-private-api');

/**
 * Helper for interacting with Instagram's private mobile API. This module
 * encapsulates login, inbox retrieval and messaging. It uses the
 * instagram-private-api package, which is an unofficial library that
 * leverages Instagram's Android API. Use at your own risk and ensure
 * compliance with Instagram's terms of service.
 */

/**
 * Perform login for a given account. If a session is already serialized
 * (for example from a prior run), it can be passed via the `sessionData`
 * parameter to avoid repeated logins. Upon successful login the IG client
 * state is serialised and returned for persistence.
 *
 * @param {Object} account - contains username, password, optional twofactor and proxy settings
 * @param {Object|null} sessionData - previous serialized client state
 * @returns {Promise<{ig: IgApiClient, loggedInUser: any, session: any}>}
 */
async function login(account, sessionData = null) {
  const ig = new IgApiClient();
  ig.state.generateDevice(account.username);
  // Apply proxy if defined. The proxy string must include protocol.
  if (account.proxy_host && account.proxy_port) {
    const authPart = account.proxy_username
      ? `${account.proxy_username}:${account.proxy_password}@`
      : '';
    ig.state.proxyUrl = `http://${authPart}${account.proxy_host}:${account.proxy_port}`;
  }
  // Restore session if available
  if (sessionData) {
    try {
      await ig.state.deserialize(sessionData);
      return { ig, loggedInUser: await ig.account.currentUser(), session: sessionData };
    } catch (err) {
      // Fall back to normal login if deserialisation fails
      console.warn('Failed to restore IG session, logging in again');
    }
  }
  // Perform login. Two‑factor authentication (2FA) and challenges are not
  // handled in this skeleton. In production you should implement 2FA flow
  // (via IG code) and handle checkpoint challenges.
  const loggedInUser = await ig.account.login(account.username, account.password);
  // Serialise state for persistence (includes cookies and tokens)
  const session = await ig.state.serialize();
  return { ig, loggedInUser, session };
}

/**
 * Retrieve the direct inbox for the logged‑in user. The returned array
 * contains threads (conversations) with the most recent messages.
 *
 * @param {IgApiClient} ig - authenticated IG client
 * @returns {Promise<any[]>}
 */
async function getInbox(ig) {
  const inboxFeed = ig.feed.directInbox();
  const threads = await inboxFeed.items();
  return threads;
}

/**
 * Retrieve messages from a specific thread.
 *
 * @param {IgApiClient} ig - authenticated IG client
 * @param {string} threadId - the thread identifier
 * @returns {Promise<any[]>}
 */
async function getThreadMessages(ig, threadId) {
  const threadFeed = ig.feed.directThread({ thread_id: threadId });
  const messages = await threadFeed.items();
  return messages;
}

/**
 * Send a text message to a thread. This uses the internal entity helper. If
 * you need to send media or perform more complex actions, consult the
 * instagram-private-api documentation.
 *
 * @param {IgApiClient} ig - authenticated IG client
 * @param {string} threadId - target thread id
 * @param {string} message - text to send
 */
async function sendMessage(ig, threadId, message) {
  // We use the entity wrapper to broadcast a text message to the thread
  const thread = ig.entity.directThread(threadId);
  await thread.broadcastText(message);
}

module.exports = {
  login,
  getInbox,
  getThreadMessages,
  sendMessage,
};