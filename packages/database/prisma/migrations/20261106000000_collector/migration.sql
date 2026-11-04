-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "AgentEventStatus" AS ENUM ('ACCEPTED', 'REJECTED');

-- AlterTable
ALTER TABLE "printer_models" ADD COLUMN     "snmp_black_counter_oid" TEXT,
ADD COLUMN     "snmp_color_counter_oid" TEXT;

-- CreateTable
CREATE TABLE "collector_agents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "site_id" UUID,
    "name" TEXT NOT NULL,
    "status" "AgentStatus" NOT NULL DEFAULT 'PENDING',
    "enrollment_code_hash" TEXT,
    "enrollment_expires_at" TIMESTAMPTZ(3),
    "token_hash" TEXT,
    "hostname" TEXT,
    "version" TEXT,
    "platform" TEXT,
    "last_seen_at" TIMESTAMPTZ(3),
    "last_sync_at" TIMESTAMPTZ(3),
    "last_ip" TEXT,
    "enrolled_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_by_id" TEXT,
    "created_by_email" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "collector_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "printer_id" UUID,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "AgentEventStatus" NOT NULL,
    "error" TEXT,
    "payload" JSONB NOT NULL,

    CONSTRAINT "agent_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_sync_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "received" INTEGER NOT NULL,
    "accepted" INTEGER NOT NULL,
    "duplicates" INTEGER NOT NULL,
    "rejected" INTEGER NOT NULL,
    "duration_ms" INTEGER NOT NULL,

    CONSTRAINT "agent_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "printer_states" (
    "printer_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "observed_at" TIMESTAMPTZ(3) NOT NULL,
    "reachable" BOOLEAN NOT NULL,
    "error" TEXT,
    "device_status" TEXT,
    "printer_status" TEXT,
    "alerts" TEXT[],
    "supplies" JSONB NOT NULL,
    "total_count" INTEGER,
    "serial_number" TEXT,
    "description" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "printer_states_pkey" PRIMARY KEY ("printer_id")
);

-- CreateTable
CREATE TABLE "discovered_devices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "ip_address" TEXT NOT NULL,
    "serial_number" TEXT,
    "sys_name" TEXT,
    "description" TEXT,
    "mac_address" TEXT,
    "printer_id" UUID,
    "ignored" BOOLEAN NOT NULL DEFAULT false,
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "discovered_devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "collector_agents_enrollment_code_hash_key" ON "collector_agents"("enrollment_code_hash");

-- CreateIndex
CREATE UNIQUE INDEX "collector_agents_token_hash_key" ON "collector_agents"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "collector_agents_tenant_id_name_key" ON "collector_agents"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "collector_agents_id_tenant_id_key" ON "collector_agents"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "agent_events_tenant_id_received_at_idx" ON "agent_events"("tenant_id", "received_at" DESC);

-- CreateIndex
CREATE INDEX "agent_events_agent_id_received_at_idx" ON "agent_events"("agent_id", "received_at" DESC);

-- CreateIndex
CREATE INDEX "agent_events_tenant_id_status_received_at_idx" ON "agent_events"("tenant_id", "status", "received_at" DESC);

-- CreateIndex
CREATE INDEX "agent_sync_logs_tenant_id_received_at_idx" ON "agent_sync_logs"("tenant_id", "received_at" DESC);

-- CreateIndex
CREATE INDEX "printer_states_tenant_id_idx" ON "printer_states"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "printer_states_printer_id_tenant_id_key" ON "printer_states"("printer_id", "tenant_id");

-- CreateIndex
CREATE INDEX "discovered_devices_tenant_id_last_seen_at_idx" ON "discovered_devices"("tenant_id", "last_seen_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "discovered_devices_tenant_id_ip_address_key" ON "discovered_devices"("tenant_id", "ip_address");

-- AddForeignKey
ALTER TABLE "collector_agents" ADD CONSTRAINT "collector_agents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collector_agents" ADD CONSTRAINT "collector_agents_site_id_tenant_id_fkey" FOREIGN KEY ("site_id", "tenant_id") REFERENCES "sites"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_agent_id_tenant_id_fkey" FOREIGN KEY ("agent_id", "tenant_id") REFERENCES "collector_agents"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_sync_logs" ADD CONSTRAINT "agent_sync_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_sync_logs" ADD CONSTRAINT "agent_sync_logs_agent_id_tenant_id_fkey" FOREIGN KEY ("agent_id", "tenant_id") REFERENCES "collector_agents"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "printer_states" ADD CONSTRAINT "printer_states_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "printer_states" ADD CONSTRAINT "printer_states_printer_id_tenant_id_fkey" FOREIGN KEY ("printer_id", "tenant_id") REFERENCES "printers"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "printer_states" ADD CONSTRAINT "printer_states_agent_id_tenant_id_fkey" FOREIGN KEY ("agent_id", "tenant_id") REFERENCES "collector_agents"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovered_devices" ADD CONSTRAINT "discovered_devices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovered_devices" ADD CONSTRAINT "discovered_devices_agent_id_tenant_id_fkey" FOREIGN KEY ("agent_id", "tenant_id") REFERENCES "collector_agents"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovered_devices" ADD CONSTRAINT "discovered_devices_printer_id_tenant_id_fkey" FOREIGN KEY ("printer_id", "tenant_id") REFERENCES "printers"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =====================================================================
-- Contraintes de domaine et isolation (écrit à la main).
-- =====================================================================

ALTER TABLE "printer_models"
    ADD CONSTRAINT "printer_models_counter_oids" CHECK (
        ("snmp_black_counter_oid" IS NULL OR "snmp_black_counter_oid" ~ '^[0-2](\.(0|[1-9][0-9]*)){5,}$')
        AND ("snmp_color_counter_oid" IS NULL OR "snmp_color_counter_oid" ~ '^[0-2](\.(0|[1-9][0-9]*)){5,}$')
    );

-- Un agent enregistré a toujours un jeton ; un agent révoqué n'en a plus.
ALTER TABLE "collector_agents"
    ADD CONSTRAINT "collector_agents_token_state" CHECK (
        ("status" = 'ACTIVE' AND "token_hash" IS NOT NULL)
        OR ("status" = 'PENDING' AND "token_hash" IS NULL)
        OR ("status" = 'REVOKED' AND "token_hash" IS NULL AND "enrollment_code_hash" IS NULL)
    ),
    ADD CONSTRAINT "collector_agents_hashes" CHECK (
        ("token_hash" IS NULL OR "token_hash" ~ '^[0-9a-f]{64}$')
        AND ("enrollment_code_hash" IS NULL OR "enrollment_code_hash" ~ '^[0-9a-f]{64}$')
    );

-- Le type n'est pas contraint : un événement d'un type inconnu est journalisé tel quel, rejeté.
ALTER TABLE "agent_events"
    ADD CONSTRAINT "agent_events_type_length" CHECK (char_length("type") BETWEEN 1 AND 60),
    ADD CONSTRAINT "agent_events_rejection" CHECK (("status" = 'REJECTED') = ("error" IS NOT NULL));

ALTER TABLE "agent_sync_logs"
    ADD CONSTRAINT "agent_sync_logs_counts" CHECK (
        "accepted" >= 0 AND "duplicates" >= 0 AND "rejected" >= 0 AND "duration_ms" >= 0
        AND "received" = "accepted" + "duplicates" + "rejected"
    );

ALTER TABLE "collector_agents" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "collector_agents"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "agent_events" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "agent_events"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "agent_sync_logs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "agent_sync_logs"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "printer_states" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "printer_states"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "discovered_devices" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "discovered_devices"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
