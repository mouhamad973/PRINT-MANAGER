-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('RECEIPT', 'ISSUE', 'INSTALLATION', 'CANCELLATION', 'ADJUSTMENT', 'TRANSFER_OUT', 'TRANSFER_IN');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateTable
CREATE TABLE "toner_stocks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "channel" "TonerChannel" NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "min_quantity" INTEGER NOT NULL DEFAULT 0,
    "lead_time_days" INTEGER NOT NULL DEFAULT 7,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "toner_stocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "stock_id" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL DEFAULT 0,
    "unit_cost" DECIMAL(14,2),
    "reference" TEXT,
    "notes" TEXT,
    "replacement_id" UUID,
    "transfer_id" UUID,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" TEXT,
    "created_by_email" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "toner_replacements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "printer_id" UUID NOT NULL,
    "channel" "TonerChannel" NOT NULL,
    "reference" TEXT,
    "yield_pages" INTEGER,
    "replaced_at" TIMESTAMPTZ(3) NOT NULL,
    "previous_level_percent" DECIMAL(5,1),
    "counter" INTEGER,
    "stock_id" UUID,
    "notes" TEXT,
    "created_by_id" TEXT,
    "created_by_email" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by_email" TEXT,

    CONSTRAINT "toner_replacements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_level_readings" (
    "printer_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "channel" "TonerChannel" NOT NULL,
    "observed_at" TIMESTAMPTZ(3) NOT NULL,
    "level_percent" DECIMAL(5,1) NOT NULL,

    CONSTRAINT "supply_level_readings_pkey" PRIMARY KEY ("printer_id","channel","observed_at")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "dedupe_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "printer_id" UUID,
    "stock_id" UUID,
    "site_id" UUID,
    "channel" "TonerChannel",
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMPTZ(3),
    "acknowledged_by_email" TEXT,
    "resolved_at" TIMESTAMPTZ(3),
    "resolution" TEXT,
    "resolved_by_email" TEXT,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "toner_stocks_tenant_id_reference_idx" ON "toner_stocks"("tenant_id", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "toner_stocks_site_id_reference_key" ON "toner_stocks"("site_id", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "toner_stocks_id_tenant_id_key" ON "toner_stocks"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "stock_movements_stock_id_occurred_at_idx" ON "stock_movements"("stock_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "stock_movements_tenant_id_type_occurred_at_idx" ON "stock_movements"("tenant_id", "type", "occurred_at");

-- CreateIndex
CREATE INDEX "toner_replacements_tenant_id_replaced_at_idx" ON "toner_replacements"("tenant_id", "replaced_at" DESC);

-- CreateIndex
CREATE INDEX "toner_replacements_printer_id_channel_replaced_at_idx" ON "toner_replacements"("printer_id", "channel", "replaced_at");

-- CreateIndex
CREATE UNIQUE INDEX "toner_replacements_id_tenant_id_key" ON "toner_replacements"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "supply_level_readings_tenant_id_observed_at_idx" ON "supply_level_readings"("tenant_id", "observed_at");

-- CreateIndex
CREATE INDEX "alerts_tenant_id_status_opened_at_idx" ON "alerts"("tenant_id", "status", "opened_at" DESC);

-- CreateIndex
CREATE INDEX "alerts_tenant_id_dedupe_key_idx" ON "alerts"("tenant_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "toner_stocks" ADD CONSTRAINT "toner_stocks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "toner_stocks" ADD CONSTRAINT "toner_stocks_site_id_tenant_id_fkey" FOREIGN KEY ("site_id", "tenant_id") REFERENCES "sites"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_stock_id_tenant_id_fkey" FOREIGN KEY ("stock_id", "tenant_id") REFERENCES "toner_stocks"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_replacement_id_tenant_id_fkey" FOREIGN KEY ("replacement_id", "tenant_id") REFERENCES "toner_replacements"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "toner_replacements" ADD CONSTRAINT "toner_replacements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "toner_replacements" ADD CONSTRAINT "toner_replacements_printer_id_tenant_id_fkey" FOREIGN KEY ("printer_id", "tenant_id") REFERENCES "printers"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "toner_replacements" ADD CONSTRAINT "toner_replacements_stock_id_tenant_id_fkey" FOREIGN KEY ("stock_id", "tenant_id") REFERENCES "toner_stocks"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_level_readings" ADD CONSTRAINT "supply_level_readings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_level_readings" ADD CONSTRAINT "supply_level_readings_printer_id_tenant_id_fkey" FOREIGN KEY ("printer_id", "tenant_id") REFERENCES "printers"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_printer_id_tenant_id_fkey" FOREIGN KEY ("printer_id", "tenant_id") REFERENCES "printers"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_stock_id_tenant_id_fkey" FOREIGN KEY ("stock_id", "tenant_id") REFERENCES "toner_stocks"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_site_id_tenant_id_fkey" FOREIGN KEY ("site_id", "tenant_id") REFERENCES "sites"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =====================================================================
-- Contraintes de domaine, registre des mouvements et isolation (écrit à la main).
-- =====================================================================

ALTER TABLE "toner_stocks"
    ADD CONSTRAINT "toner_stocks_quantity_positive" CHECK ("quantity" >= 0),
    ADD CONSTRAINT "toner_stocks_thresholds" CHECK (
        "min_quantity" BETWEEN 0 AND 100000 AND "lead_time_days" BETWEEN 0 AND 365
    ),
    ADD CONSTRAINT "toner_stocks_reference" CHECK (char_length(btrim("reference")) BETWEEN 1 AND 80);

-- Signe de chaque type de mouvement : les entrées ajoutent, les sorties retirent.
ALTER TABLE "stock_movements"
    ADD CONSTRAINT "stock_movements_sign" CHECK (
        ("type" IN ('RECEIPT', 'CANCELLATION', 'TRANSFER_IN') AND "quantity" > 0)
        OR ("type" IN ('ISSUE', 'INSTALLATION', 'TRANSFER_OUT') AND "quantity" < 0)
        OR ("type" = 'ADJUSTMENT' AND "quantity" <> 0)
    ),
    ADD CONSTRAINT "stock_movements_replacement" CHECK (
        ("type" IN ('INSTALLATION', 'CANCELLATION')) = ("replacement_id" IS NOT NULL)
    ),
    ADD CONSTRAINT "stock_movements_transfer" CHECK (
        ("type" IN ('TRANSFER_IN', 'TRANSFER_OUT')) = ("transfer_id" IS NOT NULL)
    ),
    ADD CONSTRAINT "stock_movements_unit_cost" CHECK ("unit_cost" IS NULL OR "unit_cost" >= 0);

-- Le solde suit le registre : chaque mouvement verrouille son article, calcule le nouveau
-- solde et refuse un stock négatif. Deux sorties simultanées ne peuvent pas vider deux fois.
CREATE FUNCTION "stock_movements_apply"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    current_quantity integer;
BEGIN
    SELECT "quantity" INTO current_quantity FROM "toner_stocks"
        WHERE "id" = NEW."stock_id" AND "tenant_id" = NEW."tenant_id"
        FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Article de stock introuvable pour cette entreprise'
            USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF current_quantity + NEW."quantity" < 0 THEN
        RAISE EXCEPTION 'Stock insuffisant : % en stock', current_quantity
            USING ERRCODE = 'check_violation';
    END IF;
    NEW."balance_after" := current_quantity + NEW."quantity";
    UPDATE "toner_stocks" SET "quantity" = NEW."balance_after", "updated_at" = now()
        WHERE "id" = NEW."stock_id";
    RETURN NEW;
END;
$$;
CREATE TRIGGER "stock_movements_apply_before_insert"
    BEFORE INSERT ON "stock_movements"
    FOR EACH ROW EXECUTE FUNCTION "stock_movements_apply"();

-- Registre immuable : ni modification ni suppression, même pour le rôle système.
CREATE FUNCTION "stock_movements_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Le registre des mouvements de stock ne se modifie pas'
        USING ERRCODE = 'insufficient_privilege';
END;
$$;
CREATE TRIGGER "stock_movements_immutable_check"
    BEFORE UPDATE OR DELETE ON "stock_movements"
    FOR EACH ROW EXECUTE FUNCTION "stock_movements_immutable"();

-- La quantité d'un article ne change que par le registre.
CREATE FUNCTION "toner_stocks_quantity_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."quantity" <> OLD."quantity" AND pg_trigger_depth() < 2 THEN
        RAISE EXCEPTION 'La quantité en stock ne change que par un mouvement'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "toner_stocks_quantity_guard_check"
    BEFORE UPDATE OF "quantity" ON "toner_stocks"
    FOR EACH ROW EXECUTE FUNCTION "toner_stocks_quantity_guard"();

ALTER TABLE "toner_replacements"
    ADD CONSTRAINT "toner_replacements_level" CHECK (
        "previous_level_percent" IS NULL OR "previous_level_percent" BETWEEN 0 AND 100
    ),
    ADD CONSTRAINT "toner_replacements_counts" CHECK (
        ("counter" IS NULL OR "counter" >= 0) AND ("yield_pages" IS NULL OR "yield_pages" > 0)
    ),
    ADD CONSTRAINT "toner_replacements_cancellation" CHECK (
        ("cancelled_at" IS NULL) = ("cancelled_by_email" IS NULL)
    );

ALTER TABLE "supply_level_readings"
    ADD CONSTRAINT "supply_level_readings_range" CHECK ("level_percent" BETWEEN 0 AND 100);

ALTER TABLE "alerts"
    ADD CONSTRAINT "alerts_type" CHECK (
        "type" IN ('STOCK_LOW', 'STOCK_OUT', 'STOCK_FORECAST', 'TONER_LOW', 'TONER_EMPTY')
    ),
    ADD CONSTRAINT "alerts_resolution" CHECK (
        ("status" = 'RESOLVED') = ("resolved_at" IS NOT NULL)
        AND ("resolution" IS NULL OR "resolution" IN ('auto', 'manual'))
    );

-- Une seule alerte active (ouverte ou prise en compte) par condition.
CREATE UNIQUE INDEX "alerts_active_dedupe" ON "alerts" ("tenant_id", "dedupe_key")
    WHERE "status" <> 'RESOLVED';

ALTER TABLE "toner_stocks" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "toner_stocks"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "stock_movements" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "stock_movements"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "toner_replacements" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "toner_replacements"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "supply_level_readings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "supply_level_readings"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "alerts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "alerts"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
