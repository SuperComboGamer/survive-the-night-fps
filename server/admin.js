// Account administration shared by the management script and tests.
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
