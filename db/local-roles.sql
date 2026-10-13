-- Local development only: the login role the app connects with.
-- It owns nothing and can only act as app_user (no superuser, no BYPASSRLS).
CREATE ROLE invoice_app LOGIN PASSWORD 'invoice_local_only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT app_user TO invoice_app;
