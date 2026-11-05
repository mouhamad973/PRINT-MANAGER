-- =====================================================================
-- Conservation des données (Phase 10), écrit à la main.
--
-- Le journal d'audit reste en ajout seul : aucune modification, et aucune suppression sauf
-- par la fonction de purge ci-dessous, qui ne touche que les entrées de plus d'un an.
-- =====================================================================

CREATE OR REPLACE FUNCTION "audit_logs_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE'
       AND current_setting('arksen.audit_purge', true) = 'on'
       AND OLD."created_at" < now() - interval '365 days' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Le journal d''audit est en ajout seul';
END;
$$;

-- Purge des entrées antérieures à une date, au moins un an en arrière. Elle s'exécute avec les
-- droits du propriétaire de la base ; seul le rôle système peut l'appeler.
CREATE FUNCTION "purge_audit_logs"(older_than timestamptz) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    purged integer;
BEGIN
    IF older_than > now() - interval '365 days' THEN
        RAISE EXCEPTION 'Le journal d''audit se conserve un an au moins';
    END IF;
    PERFORM set_config('arksen.audit_purge', 'on', true);
    DELETE FROM "audit_logs" WHERE "created_at" < older_than;
    GET DIAGNOSTICS purged = ROW_COUNT;
    PERFORM set_config('arksen.audit_purge', 'off', true);
    RETURN purged;
END;
$$;

REVOKE ALL ON FUNCTION "purge_audit_logs"(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "purge_audit_logs"(timestamptz) TO "arksen_system";
