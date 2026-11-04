-- CreateEnum
CREATE TYPE "MeterSource" AS ENUM ('MANUAL', 'IMPORT', 'AGENT');

-- CreateTable
CREATE TABLE "meter_readings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "printer_id" UUID NOT NULL,
    "read_at" TIMESTAMPTZ(3) NOT NULL,
    "black_count" INTEGER NOT NULL,
    "color_count" INTEGER,
    "total_count" INTEGER NOT NULL,
    "is_reset" BOOLEAN NOT NULL DEFAULT false,
    "source" "MeterSource" NOT NULL DEFAULT 'MANUAL',
    "external_id" UUID,
    "notes" TEXT,
    "created_by_id" TEXT,
    "created_by_email" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meter_readings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meter_readings_tenant_id_read_at_idx" ON "meter_readings"("tenant_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "meter_readings_printer_id_read_at_key" ON "meter_readings"("printer_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "meter_readings_tenant_id_external_id_key" ON "meter_readings"("tenant_id", "external_id");

-- AddForeignKey
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_printer_id_tenant_id_fkey" FOREIGN KEY ("printer_id", "tenant_id") REFERENCES "printers"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =====================================================================
-- Cohérence des compteurs et isolation (écrit à la main).
-- =====================================================================

ALTER TABLE "meter_readings"
    ADD CONSTRAINT "meter_readings_counts_positive"
        CHECK ("black_count" >= 0 AND ("color_count" IS NULL OR "color_count" >= 0)),
    ADD CONSTRAINT "meter_readings_total_consistent"
        CHECK ("total_count" = "black_count" + COALESCE("color_count", 0));

ALTER TABLE "meter_readings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "meter_readings"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
