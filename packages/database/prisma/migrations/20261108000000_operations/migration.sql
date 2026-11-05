-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "BillingPeriod" AS ENUM ('MONTHLY', 'QUARTERLY');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InterventionType" AS ENUM ('CORRECTIVE', 'PREVENTIVE', 'INSTALLATION', 'OTHER');

-- CreateEnum
CREATE TYPE "InterventionStatus" AS ENUM ('OPEN', 'SCHEDULED', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InterventionPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- AlterTable
ALTER TABLE "alerts" ADD COLUMN     "paper_stock_id" UUID,
ADD COLUMN     "plan_id" UUID;

-- AlterTable
ALTER TABLE "print_jobs" ADD COLUMN     "paper_cost" DECIMAL(14,4),
ADD COLUMN     "printed_at" TIMESTAMPTZ(3),
ADD COLUMN     "printed_by_email" TEXT,
ADD COLUMN     "sale_price" DECIMAL(14,2),
ADD COLUMN     "toner_cost" DECIMAL(14,4);

-- CreateTable
CREATE TABLE "paper_types" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "format" "PaperFormat" NOT NULL,
    "grammage" INTEGER,
    "sheets_per_ream" INTEGER NOT NULL DEFAULT 500,
    "ream_price" DECIMAL(14,2),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "paper_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paper_stocks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "paper_type_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "min_quantity" INTEGER NOT NULL DEFAULT 0,
    "lead_time_days" INTEGER NOT NULL DEFAULT 7,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "paper_stocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paper_movements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "stock_id" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL DEFAULT 0,
    "unit_cost" DECIMAL(14,2),
    "reference" TEXT,
    "notes" TEXT,
    "transfer_id" UUID,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" TEXT,
    "created_by_email" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paper_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "printer_cost_settings" (
    "printer_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "paper_type_id" UUID,
    "duplex_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "monthly_fixed_cost" DECIMAL(14,2),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "printer_cost_settings_pkey" PRIMARY KEY ("printer_id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "customer_contact" TEXT,
    "status" "ContractStatus" NOT NULL DEFAULT 'ACTIVE',
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "billing_period" "BillingPeriod" NOT NULL DEFAULT 'MONTHLY',
    "fixed_fee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "included_black_pages" INTEGER NOT NULL DEFAULT 0,
    "included_color_pages" INTEGER NOT NULL DEFAULT 0,
    "black_page_price" DECIMAL(14,4) NOT NULL,
    "color_page_price" DECIMAL(14,4) NOT NULL,
    "notes" TEXT,
    "created_by_id" TEXT,
    "created_by_email" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_printers" (
    "contract_id" UUID NOT NULL,
    "printer_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "added_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_printers_pkey" PRIMARY KEY ("contract_id","printer_id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "number" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "black_pages" INTEGER NOT NULL,
    "color_pages" INTEGER NOT NULL,
    "included_black_pages" INTEGER NOT NULL,
    "included_color_pages" INTEGER NOT NULL,
    "extra_black_pages" INTEGER NOT NULL,
    "extra_color_pages" INTEGER NOT NULL,
    "fixed_fee" DECIMAL(14,2) NOT NULL,
    "black_page_price" DECIMAL(14,4) NOT NULL,
    "color_page_price" DECIMAL(14,4) NOT NULL,
    "extra_black_amount" DECIMAL(14,2) NOT NULL,
    "extra_color_amount" DECIMAL(14,2) NOT NULL,
    "total_amount" DECIMAL(14,2) NOT NULL,
    "cost" DECIMAL(14,2),
    "currency" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "issued_at" TIMESTAMPTZ(3),
    "created_by_id" TEXT,
    "created_by_email" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_sequences" (
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "tenant_sequences_pkey" PRIMARY KEY ("tenant_id","name")
);

-- CreateTable
CREATE TABLE "interventions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "printer_id" UUID NOT NULL,
    "type" "InterventionType" NOT NULL DEFAULT 'CORRECTIVE',
    "status" "InterventionStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "InterventionPriority" NOT NULL DEFAULT 'NORMAL',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "reported_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reported_by_id" TEXT,
    "reported_by_email" TEXT,
    "scheduled_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "assignee_id" TEXT,
    "assignee_name" TEXT,
    "counter" INTEGER,
    "labor_minutes" INTEGER,
    "labor_cost" DECIMAL(14,2),
    "parts_cost" DECIMAL(14,2),
    "resolution" TEXT,
    "plan_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "interventions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_plans" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "printer_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "interval_pages" INTEGER,
    "interval_days" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "start_counter" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "maintenance_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "paper_types_tenant_id_name_key" ON "paper_types"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "paper_types_id_tenant_id_key" ON "paper_types"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "paper_stocks_site_id_paper_type_id_key" ON "paper_stocks"("site_id", "paper_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "paper_stocks_id_tenant_id_key" ON "paper_stocks"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "paper_movements_stock_id_occurred_at_idx" ON "paper_movements"("stock_id", "occurred_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "printer_cost_settings_printer_id_tenant_id_key" ON "printer_cost_settings"("printer_id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_tenant_id_reference_key" ON "contracts"("tenant_id", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_id_tenant_id_key" ON "contracts"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "contract_printers_printer_id_key" ON "contract_printers"("printer_id");

-- CreateIndex
CREATE UNIQUE INDEX "contract_printers_printer_id_tenant_id_key" ON "contract_printers"("printer_id", "tenant_id");

-- CreateIndex
CREATE INDEX "invoices_contract_id_period_start_idx" ON "invoices"("contract_id", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenant_id_number_key" ON "invoices"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "interventions_tenant_id_status_reported_at_idx" ON "interventions"("tenant_id", "status", "reported_at" DESC);

-- CreateIndex
CREATE INDEX "interventions_printer_id_completed_at_idx" ON "interventions"("printer_id", "completed_at");

-- CreateIndex
CREATE UNIQUE INDEX "interventions_tenant_id_number_key" ON "interventions"("tenant_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_plans_printer_id_name_key" ON "maintenance_plans"("printer_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_plans_id_tenant_id_key" ON "maintenance_plans"("id", "tenant_id");

-- AddForeignKey
ALTER TABLE "paper_types" ADD CONSTRAINT "paper_types_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_stocks" ADD CONSTRAINT "paper_stocks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_stocks" ADD CONSTRAINT "paper_stocks_site_id_tenant_id_fkey" FOREIGN KEY ("site_id", "tenant_id") REFERENCES "sites"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_stocks" ADD CONSTRAINT "paper_stocks_paper_type_id_tenant_id_fkey" FOREIGN KEY ("paper_type_id", "tenant_id") REFERENCES "paper_types"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_movements" ADD CONSTRAINT "paper_movements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_movements" ADD CONSTRAINT "paper_movements_stock_id_tenant_id_fkey" FOREIGN KEY ("stock_id", "tenant_id") REFERENCES "paper_stocks"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "printer_cost_settings" ADD CONSTRAINT "printer_cost_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "printer_cost_settings" ADD CONSTRAINT "printer_cost_settings_printer_id_tenant_id_fkey" FOREIGN KEY ("printer_id", "tenant_id") REFERENCES "printers"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "printer_cost_settings" ADD CONSTRAINT "printer_cost_settings_paper_type_id_tenant_id_fkey" FOREIGN KEY ("paper_type_id", "tenant_id") REFERENCES "paper_types"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_printers" ADD CONSTRAINT "contract_printers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_printers" ADD CONSTRAINT "contract_printers_contract_id_tenant_id_fkey" FOREIGN KEY ("contract_id", "tenant_id") REFERENCES "contracts"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_printers" ADD CONSTRAINT "contract_printers_printer_id_tenant_id_fkey" FOREIGN KEY ("printer_id", "tenant_id") REFERENCES "printers"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contract_id_tenant_id_fkey" FOREIGN KEY ("contract_id", "tenant_id") REFERENCES "contracts"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_sequences" ADD CONSTRAINT "tenant_sequences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_printer_id_tenant_id_fkey" FOREIGN KEY ("printer_id", "tenant_id") REFERENCES "printers"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_plan_id_tenant_id_fkey" FOREIGN KEY ("plan_id", "tenant_id") REFERENCES "maintenance_plans"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_printer_id_tenant_id_fkey" FOREIGN KEY ("printer_id", "tenant_id") REFERENCES "printers"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =====================================================================
-- Contraintes de domaine, registres et isolation (écrit à la main).
-- =====================================================================

ALTER TABLE "paper_types"
    ADD CONSTRAINT "paper_types_values" CHECK (
        "sheets_per_ream" BETWEEN 1 AND 10000
        AND ("grammage" IS NULL OR "grammage" BETWEEN 1 AND 500)
        AND ("ream_price" IS NULL OR "ream_price" >= 0)
    );

ALTER TABLE "paper_stocks"
    ADD CONSTRAINT "paper_stocks_quantity_positive" CHECK ("quantity" >= 0),
    ADD CONSTRAINT "paper_stocks_thresholds" CHECK (
        "min_quantity" BETWEEN 0 AND 100000 AND "lead_time_days" BETWEEN 0 AND 365
    );

-- Le papier n'est ni installé ni annulé : entrées, sorties, inventaires et transferts seulement.
ALTER TABLE "paper_movements"
    ADD CONSTRAINT "paper_movements_sign" CHECK (
        ("type" IN ('RECEIPT', 'TRANSFER_IN') AND "quantity" > 0)
        OR ("type" IN ('ISSUE', 'TRANSFER_OUT') AND "quantity" < 0)
        OR ("type" = 'ADJUSTMENT' AND "quantity" <> 0)
    ),
    ADD CONSTRAINT "paper_movements_transfer" CHECK (
        ("type" IN ('TRANSFER_IN', 'TRANSFER_OUT')) = ("transfer_id" IS NOT NULL)
    ),
    ADD CONSTRAINT "paper_movements_unit_cost" CHECK ("unit_cost" IS NULL OR "unit_cost" >= 0);

-- Même registre que les toners : solde calculé sous verrou, jamais négatif.
CREATE FUNCTION "paper_movements_apply"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    current_quantity integer;
BEGIN
    SELECT "quantity" INTO current_quantity FROM "paper_stocks"
        WHERE "id" = NEW."stock_id" AND "tenant_id" = NEW."tenant_id"
        FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Stock de papier introuvable pour cette entreprise'
            USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF current_quantity + NEW."quantity" < 0 THEN
        RAISE EXCEPTION 'Stock insuffisant : % en stock', current_quantity
            USING ERRCODE = 'check_violation';
    END IF;
    NEW."balance_after" := current_quantity + NEW."quantity";
    UPDATE "paper_stocks" SET "quantity" = NEW."balance_after", "updated_at" = now()
        WHERE "id" = NEW."stock_id";
    RETURN NEW;
END;
$$;
CREATE TRIGGER "paper_movements_apply_before_insert"
    BEFORE INSERT ON "paper_movements"
    FOR EACH ROW EXECUTE FUNCTION "paper_movements_apply"();

-- Les fonctions d'immuabilité et de garde des toners servent aussi au papier.
CREATE TRIGGER "paper_movements_immutable_check"
    BEFORE UPDATE OR DELETE ON "paper_movements"
    FOR EACH ROW EXECUTE FUNCTION "stock_movements_immutable"();

CREATE TRIGGER "paper_stocks_quantity_guard_check"
    BEFORE UPDATE OF "quantity" ON "paper_stocks"
    FOR EACH ROW EXECUTE FUNCTION "toner_stocks_quantity_guard"();

ALTER TABLE "printer_cost_settings"
    ADD CONSTRAINT "printer_cost_settings_values" CHECK (
        "duplex_percent" BETWEEN 0 AND 100
        AND ("monthly_fixed_cost" IS NULL OR "monthly_fixed_cost" >= 0)
    );

ALTER TABLE "contracts"
    ADD CONSTRAINT "contracts_values" CHECK (
        "fixed_fee" >= 0 AND "black_page_price" >= 0 AND "color_page_price" >= 0
        AND "included_black_pages" >= 0 AND "included_color_pages" >= 0
        AND char_length(btrim("reference")) BETWEEN 1 AND 40
    ),
    ADD CONSTRAINT "contracts_dates" CHECK ("end_date" IS NULL OR "end_date" >= "start_date");

-- Un relevé est cohérent : pages supplémentaires et total découlent des pages relevées.
ALTER TABLE "invoices"
    ADD CONSTRAINT "invoices_period" CHECK ("period_end" >= "period_start"),
    ADD CONSTRAINT "invoices_pages" CHECK (
        "black_pages" >= 0 AND "color_pages" >= 0
        AND "extra_black_pages" = GREATEST("black_pages" - "included_black_pages", 0)
        AND "extra_color_pages" = GREATEST("color_pages" - "included_color_pages", 0)
    ),
    ADD CONSTRAINT "invoices_total" CHECK (
        "total_amount" = "fixed_fee" + "extra_black_amount" + "extra_color_amount"
    ),
    ADD CONSTRAINT "invoices_number" CHECK (
        ("status" = 'DRAFT') = ("number" IS NULL)
        AND ("status" = 'DRAFT') = ("issued_at" IS NULL)
    );

-- Un relevé émis ne change plus, sauf pour être annulé ; il ne se supprime pas.
CREATE FUNCTION "invoices_frozen"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD."status" <> 'DRAFT' THEN
            RAISE EXCEPTION 'Un relevé émis ne se supprime pas : annulez-le'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
        RETURN OLD;
    END IF;
    IF OLD."status" = 'CANCELLED'
       OR (OLD."status" = 'ISSUED' AND (
            NEW."status" <> 'CANCELLED'
            OR (to_jsonb(NEW) - 'status' - 'updated_at') <> (to_jsonb(OLD) - 'status' - 'updated_at')
       )) THEN
        RAISE EXCEPTION 'Un relevé émis ne se modifie pas : annulez-le'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "invoices_frozen_check"
    BEFORE UPDATE OR DELETE ON "invoices"
    FOR EACH ROW EXECUTE FUNCTION "invoices_frozen"();

ALTER TABLE "tenant_sequences"
    ADD CONSTRAINT "tenant_sequences_value" CHECK ("value" >= 0);

ALTER TABLE "interventions"
    ADD CONSTRAINT "interventions_values" CHECK (
        "number" > 0
        AND ("counter" IS NULL OR "counter" >= 0)
        AND ("labor_minutes" IS NULL OR "labor_minutes" > 0)
        AND ("labor_cost" IS NULL OR "labor_cost" >= 0)
        AND ("parts_cost" IS NULL OR "parts_cost" >= 0)
    ),
    ADD CONSTRAINT "interventions_done" CHECK (("status" = 'DONE') = ("completed_at" IS NOT NULL));

ALTER TABLE "maintenance_plans"
    ADD CONSTRAINT "maintenance_plans_interval" CHECK (
        ("interval_pages" IS NOT NULL OR "interval_days" IS NOT NULL)
        AND ("interval_pages" IS NULL OR "interval_pages" > 0)
        AND ("interval_days" IS NULL OR "interval_days" > 0)
    );

-- Une intervention liée à un plan concerne la machine de ce plan.
CREATE FUNCTION "interventions_plan_scope"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."plan_id" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "maintenance_plans"
        WHERE "id" = NEW."plan_id" AND "printer_id" = NEW."printer_id"
    ) THEN
        RAISE EXCEPTION 'Ce plan de maintenance concerne une autre machine'
            USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "interventions_plan_scope_check"
    BEFORE INSERT OR UPDATE OF "plan_id", "printer_id" ON "interventions"
    FOR EACH ROW EXECUTE FUNCTION "interventions_plan_scope"();

ALTER TABLE "print_jobs"
    ADD CONSTRAINT "print_jobs_printed_amounts" CHECK (
        ("toner_cost" IS NULL OR "toner_cost" >= 0)
        AND ("paper_cost" IS NULL OR "paper_cost" >= 0)
        AND ("sale_price" IS NULL OR "sale_price" >= 0)
    );

-- Nouveaux types d'alerte : papier et maintenance préventive.
ALTER TABLE "alerts" DROP CONSTRAINT "alerts_type";
ALTER TABLE "alerts"
    ADD CONSTRAINT "alerts_type" CHECK (
        "type" IN ('STOCK_LOW', 'STOCK_OUT', 'STOCK_FORECAST', 'TONER_LOW', 'TONER_EMPTY',
                   'PAPER_LOW', 'PAPER_OUT', 'MAINTENANCE_DUE', 'MAINTENANCE_OVERDUE')
    );

ALTER TABLE "paper_types" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "paper_types"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "paper_stocks" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "paper_stocks"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "paper_movements" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "paper_movements"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "printer_cost_settings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "printer_cost_settings"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "contracts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "contracts"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "contract_printers" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "contract_printers"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "invoices"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "tenant_sequences" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "tenant_sequences"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "interventions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "interventions"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "maintenance_plans" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "maintenance_plans"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
