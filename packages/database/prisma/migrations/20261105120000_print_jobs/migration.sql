-- CreateTable
CREATE TABLE "print_jobs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "file_sha256" TEXT NOT NULL,
    "page_count" INTEGER NOT NULL,
    "color_pages" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "dpi" INTEGER NOT NULL,
    "average_cyan" DECIMAL(6,3) NOT NULL,
    "average_magenta" DECIMAL(6,3) NOT NULL,
    "average_yellow" DECIMAL(6,3) NOT NULL,
    "average_black" DECIMAL(6,3) NOT NULL,
    "printer_id" UUID,
    "copies" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" TEXT,
    "created_by_email" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "print_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "print_job_pages" (
    "job_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "width_mm" DECIMAL(7,1) NOT NULL,
    "height_mm" DECIMAL(7,1) NOT NULL,
    "format" TEXT NOT NULL,
    "orientation" TEXT NOT NULL,
    "area_factor" DECIMAL(8,4) NOT NULL,
    "coverage_cyan" DECIMAL(6,3) NOT NULL,
    "coverage_magenta" DECIMAL(6,3) NOT NULL,
    "coverage_yellow" DECIMAL(6,3) NOT NULL,
    "coverage_black" DECIMAL(6,3) NOT NULL,
    "coverage_gray" DECIMAL(6,3) NOT NULL,
    "is_color" BOOLEAN NOT NULL,

    CONSTRAINT "print_job_pages_pkey" PRIMARY KEY ("job_id","number")
);

-- CreateIndex
CREATE INDEX "print_jobs_tenant_id_created_at_idx" ON "print_jobs"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "print_jobs_id_tenant_id_key" ON "print_jobs"("id", "tenant_id");

-- AddForeignKey
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_printer_id_fkey" FOREIGN KEY ("printer_id") REFERENCES "printers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_job_pages" ADD CONSTRAINT "print_job_pages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_job_pages" ADD CONSTRAINT "print_job_pages_job_id_tenant_id_fkey" FOREIGN KEY ("job_id", "tenant_id") REFERENCES "print_jobs"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;


-- =====================================================================
-- Contraintes de domaine et isolation (écrit à la main).
-- =====================================================================

ALTER TABLE "print_jobs"
    ADD CONSTRAINT "print_jobs_counts" CHECK (
        "page_count" > 0 AND "color_pages" BETWEEN 0 AND "page_count"
        AND "copies" BETWEEN 1 AND 1000000 AND "file_size" >= 0),
    ADD CONSTRAINT "print_jobs_sha256" CHECK ("file_sha256" ~ '^[0-9a-f]{64}$');

ALTER TABLE "print_job_pages"
    ADD CONSTRAINT "print_job_pages_coverage_range" CHECK (
        "coverage_cyan" BETWEEN 0 AND 100 AND "coverage_magenta" BETWEEN 0 AND 100
        AND "coverage_yellow" BETWEEN 0 AND 100 AND "coverage_black" BETWEEN 0 AND 100
        AND "coverage_gray" BETWEEN 0 AND 100),
    ADD CONSTRAINT "print_job_pages_size_positive"
        CHECK ("width_mm" > 0 AND "height_mm" > 0 AND "area_factor" > 0);

-- La machine prévue d'un travail appartient à la même entreprise.
CREATE FUNCTION "print_jobs_printer_scope"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."printer_id" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "printers" WHERE "id" = NEW."printer_id" AND "tenant_id" = NEW."tenant_id"
    ) THEN
        RAISE EXCEPTION 'Machine introuvable pour cette entreprise'
            USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "print_jobs_printer_scope_check"
    BEFORE INSERT OR UPDATE OF "printer_id", "tenant_id" ON "print_jobs"
    FOR EACH ROW EXECUTE FUNCTION "print_jobs_printer_scope"();

ALTER TABLE "print_jobs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "print_jobs"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "print_job_pages" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "print_job_pages"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
