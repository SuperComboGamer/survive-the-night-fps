// Account administration shared by the management script, the admin panel and tests.
// Changing a role revokes the account's sessions so the next connection must authenticate and reads the new role.
export async function setAdmin(db, identity, isAdmin = true) {
  const who = typeof identity === 'string' ? identity.trim() : '';
  if (!who) throw new Error('Give a username or email address.');
  return db.tx(async (t) => {
    const changed = await t.query(
      `UPDATE users
          SET is_admin = $2
        WHERE lower(email) = lower($1) OR lower(username) = lower($1)
      RETURNING id, email, username, is_admin`,
      [who, !!isAdmin],
    );
    const user = changed.rows[0];
    if (!user) throw new Error(`No account matches ${who}.`);
    await t.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);
    return user;
  });
}

// Why a role change from the panel was turned down (AdminRuleError.rule): 'gone' (no such account), 'actor' (whoever
// asks is not an admin any more), 'self' (nobody takes their own admin flag away), 'last' (the game always has one).
export class AdminRuleError extends Error {
  constructor(rule, message) {
    super(message);
    this.rule = rule;
  }
}

// The same change, made by an admin from the panel (adminpanel.js): `actorId` gives or takes `targetId`'s admin flag.
// All of it in one transaction with every admin's row locked, so two admins taking each other's flag at the same
// moment cannot both succeed and leave the game with none: the second finds it is no longer an admin.
// -> { id, username, is_admin, changed } (changed: false when the account already was what was asked), or throws an
// AdminRuleError. A change revokes the account's sessions, as setAdmin does.
export async function setAdminById(db, actorId, targetId, isAdmin) {
  return db.tx(async (t) => {
    const admins = (await t.query('SELECT id FROM users WHERE is_admin ORDER BY id FOR UPDATE')).rows.map((r) => r.id);
    if (!admins.includes(actorId)) throw new AdminRuleError('actor', 'You are not an admin any more.');
    const target = (await t.query('SELECT id, username, is_admin FROM users WHERE id = $1 FOR UPDATE', [targetId])).rows[0];
    if (!target) throw new AdminRuleError('gone', 'No such account.');
    if (target.is_admin === !!isAdmin) return { ...target, changed: false };
    if (!isAdmin) {
      if (target.id === actorId) throw new AdminRuleError('self', 'You cannot take your own admin access away: another admin has to.');
      if (admins.length <= 1) throw new AdminRuleError('last', 'That is the only admin: the game must keep one.');
    }
    await t.query('UPDATE users SET is_admin = $2 WHERE id = $1', [target.id, !!isAdmin]);
    await t.query('DELETE FROM sessions WHERE user_id = $1', [target.id]);
    return { id: target.id, username: target.username, is_admin: !!isAdmin, changed: true };
  });
}
