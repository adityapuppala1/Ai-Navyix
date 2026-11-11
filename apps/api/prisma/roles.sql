-- Administrative setup only. This file contains NO password or default credential.
-- Run on the intended empty development database before migrations.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='navyix_runtime') THEN
    CREATE ROLE navyix_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='navyix_app') THEN
    CREATE ROLE navyix_app LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;
GRANT navyix_runtime TO navyix_app;
-- Set a fresh password interactively with psql: \password navyix_app
-- DATABASE_URL must use navyix_app; MIGRATION_DATABASE_URL is a separate privileged identity.
-- Never give the application a migration/owner/BYPASSRLS connection.
