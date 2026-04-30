const util = require('util');

function allAsync(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

/**
 * Compute a basic summary of chat metrics for a user. This looks at the
 * `chats` table in SQLite and aggregates counts for today, last 7 days,
 * and last 30 days. It also groups counts by account and status. This is
 * intended as a starting point and can be extended to compute more complex
 * KPIs such as response rates and follow‑up success.
 */
async function computeSummary(db, ownerId) {
  const now = Date.now();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const startOfMonth = new Date(now - 30 * 24 * 60 * 60 * 1000);
  const scopedChatsSql = `
    SELECT c.*
    FROM chats c
    JOIN accounts a ON a.id = c.account_id
    WHERE c.timestamp >= ? AND a.owner_id = ?
  `;

  const [todayRows, weekRows, monthRows] = await Promise.all([
    allAsync(db, scopedChatsSql, [startOfDay.getTime(), ownerId]),
    allAsync(db, scopedChatsSql, [startOfWeek.getTime(), ownerId]),
    allAsync(db, scopedChatsSql, [startOfMonth.getTime(), ownerId]),
  ]);

  function countMessages(rows, direction = null) {
    return rows.filter((row) => (direction ? row.direction === direction : true)).length;
  }

  return {
    today: {
      inbound: countMessages(todayRows, 'in'),
      outbound: countMessages(todayRows, 'out'),
      total: todayRows.length,
    },
    lastWeek: {
      inbound: countMessages(weekRows, 'in'),
      outbound: countMessages(weekRows, 'out'),
      total: weekRows.length,
    },
    lastMonth: {
      inbound: countMessages(monthRows, 'in'),
      outbound: countMessages(monthRows, 'out'),
      total: monthRows.length,
    },
  };
}

module.exports = {
  computeSummary,
};