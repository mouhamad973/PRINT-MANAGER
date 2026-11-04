-- CreateEnum
CREATE TYPE "ColorMode" AS ENUM ('COLOR', 'MONOCHROME');

-- CreateEnum
CREATE TYPE "PrintTechnology" AS ENUM ('LASER', 'LED', 'INKJET', 'OTHER');

-- CreateEnum
CREATE TYPE "PaperFormat" AS ENUM ('A4', 'A3', 'SRA3');

-- CreateEnum
CREATE TYPE "PrinterStatus" AS ENUM ('ACTIVE', 'MAINTENANCE', 'OUT_OF_SERVICE', 'RETIRED');

-- CreateEnum
CREATE TYPE "ConnectivityStatus" AS ENUM ('UNKNOWN', 'ONLINE', 'OFFLINE');

-- CreateEnum
CREATE TYPE "SnmpVersion" AS ENUM ('V1', 'V2C', 'V3');

-- CreateEnum
CREATE TYPE "SnmpSecurityLevel" AS ENUM ('NO_AUTH_NO_PRIV', 'AUTH_NO_PRIV', 'AUTH_PRIV');

-- CreateEnum
CREATE TYPE "SnmpAuthProtocol" AS ENUM ('MD5', 'SHA', 'SHA224', 'SHA256', 'SHA384', 'SHA512');

-- CreateEnum
CREATE TYPE "SnmpPrivProtocol" AS ENUM ('DES', 'AES128', 'AES192', 'AES256');

-- CreateTable
CREATE TABLE "sites" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "address" TEXT,
    "postal_code" TEXT,
    "city" TEXT,
    "country" TEXT,
    "contact_name" TEXT,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "printer_models" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "manufacturer" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color_mode" "ColorMode" NOT NULL,
    "technology" "PrintTechnology" NOT NULL DEFAULT 'LASER',
    "max_format" "PaperFormat" NOT NULL DEFAULT 'A4',
    "speed_mono_ppm" INTEGER,
    "speed_color_ppm" INTEGER,
    "duplex" BOOLEAN NOT NULL DEFAULT true,
    "monthly_duty_cycle" INTEGER,
    "recommended_volume" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "printer_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "printers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "model_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "serial_number" TEXT NOT NULL,
    "asset_tag" TEXT,
    "location" TEXT,
    "status" "PrinterStatus" NOT NULL DEFAULT 'ACTIVE',
    "connectivity" "ConnectivityStatus" NOT NULL DEFAULT 'UNKNOWN',
    "last_seen_at" TIMESTAMPTZ(3),
    "installed_at" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "printers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "printer_connections" (
    "printer_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ip_address" TEXT,
    "hostname" TEXT,
    "mac_address" TEXT,
    "snmp_version" "SnmpVersion" NOT NULL DEFAULT 'V2C',
    "snmp_port" INTEGER NOT NULL DEFAULT 161,
    "snmp_community" TEXT,
    "snmp_username" TEXT,
    "snmp_security_level" "SnmpSecurityLevel",
    "snmp_auth_protocol" "SnmpAuthProtocol",
    "snmp_auth_password" TEXT,
    "snmp_priv_protocol" "SnmpPrivProtocol",
    "snmp_priv_password" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "printer_connections_pkey" PRIMARY KEY ("printer_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sites_tenant_id_name_key" ON "sites"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "sites_id_tenant_id_key" ON "sites"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "printer_models_manufacturer_name_idx" ON "printer_models"("manufacturer", "name");

-- CreateIndex
CREATE UNIQUE INDEX "printer_models_tenant_id_manufacturer_name_key" ON "printer_models"("tenant_id", "manufacturer", "name");

-- CreateIndex
CREATE INDEX "printers_tenant_id_site_id_idx" ON "printers"("tenant_id", "site_id");

-- CreateIndex
CREATE INDEX "printers_tenant_id_status_idx" ON "printers"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "printers_model_id_idx" ON "printers"("model_id");

-- CreateIndex
CREATE UNIQUE INDEX "printers_tenant_id_serial_number_key" ON "printers"("tenant_id", "serial_number");

-- CreateIndex
CREATE UNIQUE INDEX "printers_id_tenant_id_key" ON "printers"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "printer_connections_tenant_id_idx" ON "printer_connections"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "printer_connections_printer_id_tenant_id_key" ON "printer_connections"("printer_id", "tenant_id");

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "printer_models" ADD CONSTRAINT "printer_models_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "printers" ADD CONSTRAINT "printers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "printers" ADD CONSTRAINT "printers_site_id_tenant_id_fkey" FOREIGN KEY ("site_id", "tenant_id") REFERENCES "sites"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "printers" ADD CONSTRAINT "printers_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "printer_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "printer_connections" ADD CONSTRAINT "printer_connections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "printer_connections" ADD CONSTRAINT "printer_connections_printer_id_tenant_id_fkey" FOREIGN KEY ("printer_id", "tenant_id") REFERENCES "printers"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;


-- =====================================================================
-- Isolation des données par entreprise : Row-Level Security (écrit à la main).
-- Même règle que la migration 20261103000000_auth_tenants.
-- =====================================================================

ALTER TABLE "sites" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "sites"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "printers" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "printers"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "printer_connections" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "printer_connections"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Fiches techniques : le catalogue Arksen (tenant_id nul) est lisible par toutes les entreprises,
-- mais seul le rôle de plateforme peut le modifier. Une entreprise ne lit et n'écrit que ses propres modèles.
ALTER TABLE "printer_models" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "catalog_read" ON "printer_models" FOR SELECT
    USING ("tenant_id" IS NULL OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "tenant_insert" ON "printer_models" FOR INSERT
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "tenant_update" ON "printer_models" FOR UPDATE
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "tenant_delete" ON "printer_models" FOR DELETE
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Une machine ne peut utiliser qu'un modèle du catalogue Arksen ou de sa propre entreprise.
-- Les clés étrangères composites couvrent déjà les sites et les configurations réseau.
CREATE FUNCTION "printers_model_scope"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    model_tenant uuid;
BEGIN
    SELECT "tenant_id" INTO model_tenant FROM "printer_models" WHERE "id" = NEW."model_id";
    IF NOT FOUND OR (model_tenant IS NOT NULL AND model_tenant <> NEW."tenant_id") THEN
        RAISE EXCEPTION 'Modèle d''imprimante introuvable pour cette entreprise'
            USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "printers_model_scope_check"
    BEFORE INSERT OR UPDATE OF "model_id", "tenant_id" ON "printers"
    FOR EACH ROW EXECUTE FUNCTION "printers_model_scope"();
