-- Trusted server RPC wrappers need schema lookup, not CREATE or client access.
grant usage on schema private to service_role;
