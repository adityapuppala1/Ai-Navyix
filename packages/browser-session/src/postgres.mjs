/** Dedicated session identity. It must not have access to customer workflow tables. */
export class PostgresSessions {
  constructor(pool) { this.pool = pool; }
  async assertSafe() {
    const result = await this.pool.query(`SELECT current_user AS name,
      r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb AS elevated,
      EXISTS (SELECT 1 FROM pg_database d WHERE d.datname=current_database() AND d.datdba=r.oid) AS owns_database,
      has_schema_privilege(current_user,'public','CREATE') OR has_schema_privilege(current_user,'browser_auth','CREATE') AS can_create,
      EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('r','p') AND
        (has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') OR
         has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE'))) AS business_access,
      EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege(current_user,p.oid,'EXECUTE')) AS security_definer_access,
      EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid) AS inherited_roles,
      EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname IN ('public','browser_auth') AND n.nspowner=r.oid) AS owns_schema,
      EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='browser_auth' AND c.relowner=r.oid) AS owns_table
      FROM pg_roles r WHERE r.rolname=current_user`);
    const role = result.rows[0];
    if (!role || role.name !== 'navyix_browser' || role.elevated || role.owns_database || role.can_create || role.business_access || role.security_definer_access || role.inherited_roles || role.owns_schema || role.owns_table)
      throw new Error('Browser sessions require the restricted navyix_browser database role.');
    await this.pool.query('SELECT id_hash FROM browser_auth.sessions WHERE false');
    await this.pool.query('SELECT id_hash FROM browser_auth.login_transactions WHERE false');
  }
  async putLogin(id, sealed, expiresAt) {
    await this.pool.query('INSERT INTO browser_auth.login_transactions(id_hash,sealed,expires_at) VALUES($1,$2,$3)', [id, sealed, new Date(expiresAt)]);
  }
  async consumeLogin(id) {
    // DELETE RETURNING provides one-time consumption across all web replicas.
    const r = await this.pool.query('DELETE FROM browser_auth.login_transactions WHERE id_hash=$1 RETURNING sealed,expires_at', [id]);
    return r.rows[0] ? { sealed: r.rows[0].sealed, expiresAt: +r.rows[0].expires_at } : null;
  }
  async putSession(id, sealed, expiresAt, idleUntil) {
    await this.pool.query('INSERT INTO browser_auth.sessions(id_hash,sealed,expires_at,idle_until) VALUES($1,$2,$3,$4)', [id, sealed, new Date(expiresAt), new Date(idleUntil)]);
  }
  async getSession(id, now, idleSeconds) {
    const r = await this.pool.query(`UPDATE browser_auth.sessions SET idle_until=LEAST(expires_at,$2::timestamptz + $3::int * interval '1 second')
      WHERE id_hash=$1 AND expires_at > $2 AND idle_until > $2 RETURNING sealed,expires_at`, [id, new Date(now), idleSeconds]);
    return r.rows[0] ? { sealed: r.rows[0].sealed, expiresAt: +r.rows[0].expires_at } : null;
  }
  async deleteSession(id) { await this.pool.query('DELETE FROM browser_auth.sessions WHERE id_hash=$1', [id]); }
  async cleanup(now = Date.now()) {
    // Operator-invoked maintenance; no scheduled workflow is installed or dispatched.
    await this.pool.query('DELETE FROM browser_auth.login_transactions WHERE expires_at <= $1', [new Date(now)]);
    await this.pool.query('DELETE FROM browser_auth.sessions WHERE expires_at <= $1 OR idle_until <= $1', [new Date(now)]);
  }
}
