-- Run explicitly as a database administrator before the browser-session migration.
-- No password is supplied here. Set it interactively with \password navyix_browser.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='navyix_browser') THEN
    CREATE ROLE navyix_browser LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='navyix_browser'
    AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolinherit)) THEN
    RAISE EXCEPTION 'Existing navyix_browser role must be reviewed; refusing to alter it automatically';
  END IF;
END $$;
