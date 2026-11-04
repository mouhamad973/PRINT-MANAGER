-- CreateEnum
CREATE TYPE "TonerChannel" AS ENUM ('CYAN', 'MAGENTA', 'YELLOW', 'BLACK');

-- CreateEnum
CREATE TYPE "MeasurementMethod" AS ENUM ('WEIGHING', 'CARTRIDGES');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'XOF';

-- CreateTable
CREATE TABLE "toner_models" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "printer_model_id" UUID NOT NULL,
    "channel" "TonerChannel" NOT NULL,
    "reference" TEXT NOT NULL,
    "capacity_grams" DECIMAL(10,2) NOT NULL,
    "yield_pages" INTEGER NOT NULL,
    "reference_coverage" DECIMAL(5,2) NOT NULL DEFAULT 5,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "toner_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "toner_prices" (
    "tenant_id" UUID NOT NULL,
    "toner_model_id" UUID NOT NULL,
    "unit_price" DECIMAL(14,2) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "toner_prices_pkey" PRIMARY KEY ("tenant_id","toner_model_id")
);

-- CreateTable
CREATE TABLE "calibration_profiles" (
    "printer_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "coverage_cyan" DECIMAL(5,2) NOT NULL DEFAULT 5,
    "coverage_magenta" DECIMAL(5,2) NOT NULL DEFAULT 5,
    "coverage_yellow" DECIMAL(5,2) NOT NULL DEFAULT 5,
    "coverage_black" DECIMAL(5,2) NOT NULL DEFAULT 5,
    "paper_format" "PaperFormat" NOT NULL DEFAULT 'A4',
    "media_factor" DECIMAL(5,3) NOT NULL DEFAULT 1,
    "coefficient_cyan" DECIMAL(6,3),
    "coefficient_magenta" DECIMAL(6,3),
    "coefficient_yellow" DECIMAL(6,3),
    "coefficient_black" DECIMAL(6,3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "calibration_profiles_pkey" PRIMARY KEY ("printer_id")
);

-- CreateTable
CREATE TABLE "consumption_measurements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "printer_id" UUID NOT NULL,
    "channel" "TonerChannel" NOT NULL,
    "period_start" TIMESTAMPTZ(3) NOT NULL,
    "period_end" TIMESTAMPTZ(3) NOT NULL,
    "method" "MeasurementMethod" NOT NULL,
    "grams" DECIMAL(10,2) NOT NULL,
    "cartridges" DECIMAL(6,2),
    "notes" TEXT,
    "created_by_id" TEXT,
    "created_by_email" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consumption_measurements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "toner_models_printer_model_id_channel_key" ON "toner_models"("printer_model_id", "channel");

-- CreateIndex
CREATE INDEX "calibration_profiles_tenant_id_idx" ON "calibration_profiles"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "calibration_profiles_printer_id_tenant_id_key" ON "calibration_profiles"("printer_id", "tenant_id");

-- CreateIndex
CREATE INDEX "consumption_measurements_tenant_id_printer_id_channel_idx" ON "consumption_measurements"("tenant_id", "printer_id", "channel");

-- AddForeignKey
ALTER TABLE "toner_models" ADD CONSTRAINT "toner_models_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "toner_models" ADD CONSTRAINT "toner_models_printer_model_id_fkey" FOREIGN KEY ("printer_model_id") REFERENCES "printer_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "toner_prices" ADD CONSTRAINT "toner_prices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "toner_prices" ADD CONSTRAINT "toner_prices_toner_model_id_fkey" FOREIGN KEY ("toner_model_id") REFERENCES "toner_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calibration_profiles" ADD CONSTRAINT "calibration_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calibration_profiles" ADD CONSTRAINT "calibration_profiles_printer_id_tenant_id_fkey" FOREIGN KEY ("printer_id", "tenant_id") REFERENCES "printers"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumption_measurements" ADD CONSTRAINT "consumption_measurements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumption_measurements" ADD CONSTRAINT "consumption_measurements_printer_id_tenant_id_fkey" FOREIGN KEY ("printer_id", "tenant_id") REFERENCES "printers"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =====================================================================
-- Contraintes de domaine et isolation (écrit à la main).
-- =====================================================================

ALTER TABLE "tenants"
    ADD CONSTRAINT "tenants_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$');

ALTER TABLE "toner_models"
    ADD CONSTRAINT "toner_models_capacity_positive" CHECK ("capacity_grams" > 0),
    ADD CONSTRAINT "toner_models_yield_positive" CHECK ("yield_pages" > 0),
    ADD CONSTRAINT "toner_models_reference_coverage_range"
        CHECK ("reference_coverage" > 0 AND "reference_coverage" <= 100);

ALTER TABLE "toner_prices"
    ADD CONSTRAINT "toner_prices_unit_price_positive" CHECK ("unit_price" >= 0);

ALTER TABLE "calibration_profiles"
    ADD CONSTRAINT "calibration_profiles_coverage_range" CHECK (
        "coverage_cyan" BETWEEN 0 AND 100 AND "coverage_magenta" BETWEEN 0 AND 100
        AND "coverage_yellow" BETWEEN 0 AND 100 AND "coverage_black" BETWEEN 0 AND 100),
    ADD CONSTRAINT "calibration_profiles_media_positive" CHECK ("media_factor" > 0),
    ADD CONSTRAINT "calibration_profiles_coefficients_positive" CHECK (
        COALESCE("coefficient_cyan", 1) > 0 AND COALESCE("coefficient_magenta", 1) > 0
        AND COALESCE("coefficient_yellow", 1) > 0 AND COALESCE("coefficient_black", 1) > 0);

ALTER TABLE "consumption_measurements"
    ADD CONSTRAINT "consumption_measurements_grams_positive" CHECK ("grams" >= 0),
    ADD CONSTRAINT "consumption_measurements_period_order" CHECK ("period_end" > "period_start"),
    ADD CONSTRAINT "consumption_measurements_cartridges_positive"
        CHECK ("cartridges" IS NULL OR "cartridges" > 0);

-- Toners : comme les fiches techniques, le catalogue Arksen est lisible par toutes les entreprises
-- et modifiable par la plateforme seule.
ALTER TABLE "toner_models" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "catalog_read" ON "toner_models" FOR SELECT
    USING ("tenant_id" IS NULL OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "tenant_insert" ON "toner_models" FOR INSERT
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "tenant_update" ON "toner_models" FOR UPDATE
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "tenant_delete" ON "toner_models" FOR DELETE
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Un toner appartient au même périmètre que sa fiche technique.
CREATE FUNCTION "toner_models_scope"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    model_tenant uuid;
BEGIN
    SELECT "tenant_id" INTO model_tenant FROM "printer_models" WHERE "id" = NEW."printer_model_id";
    IF NOT FOUND OR model_tenant IS DISTINCT FROM NEW."tenant_id" THEN
        RAISE EXCEPTION 'Le toner doit appartenir au même périmètre que sa fiche technique'
            USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "toner_models_scope_check"
    BEFORE INSERT OR UPDATE OF "printer_model_id", "tenant_id" ON "toner_models"
    FOR EACH ROW EXECUTE FUNCTION "toner_models_scope"();

-- Un prix ne porte que sur un toner du catalogue ou de l'entreprise elle-même.
CREATE FUNCTION "toner_prices_scope"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    toner_tenant uuid;
BEGIN
    SELECT "tenant_id" INTO toner_tenant FROM "toner_models" WHERE "id" = NEW."toner_model_id";
    IF NOT FOUND OR (toner_tenant IS NOT NULL AND toner_tenant <> NEW."tenant_id") THEN
        RAISE EXCEPTION 'Toner introuvable pour cette entreprise'
            USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "toner_prices_scope_check"
    BEFORE INSERT OR UPDATE OF "toner_model_id", "tenant_id" ON "toner_prices"
    FOR EACH ROW EXECUTE FUNCTION "toner_prices_scope"();

ALTER TABLE "toner_prices" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "toner_prices"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "calibration_profiles" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "calibration_profiles"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "consumption_measurements" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "consumption_measurements"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
