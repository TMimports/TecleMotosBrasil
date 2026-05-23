-- ─────────────────────────────────────────────────────────────────────────────
-- INTEGRAÇÃO BANCÁRIA - SCRIPT SEGURO E IDEMPOTENTE
-- ─────────────────────────────────────────────────────────────────────────────
-- Aplicar manualmente na VPS quando autorizado:
--   psql -U postgres -d tecle_erp -f scripts/integracao-bancaria-seguro.sql
--
-- NUNCA usar:
--   - prisma db push
--   - prisma migrate
--
-- Este script:
--   ✓ Usa CREATE TABLE IF NOT EXISTS (idempotente)
--   ✓ Usa CREATE TYPE com DO block (idempotente)
--   ✓ Usa ADD COLUMN IF NOT EXISTS para colunas opcionais (PostgreSQL 9.6+)
--   ✓ NÃO apaga dados existentes
--   ✓ Pode ser rodado várias vezes sem efeito colateral
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── ENUMS ────────────────────────────────────────────────────────────────────

DO $$ BEGIN
    CREATE TYPE "ProvedorIntegracao" AS ENUM (
        'PICPAY',
        'OPEN_FINANCE',
        'CNAB',
        'WEBHOOK_GENERICO'
    );
EXCEPTION
    WHEN duplicate_object THEN
        RAISE NOTICE 'Tipo "ProvedorIntegracao" já existe — ignorando.';
END $$;

DO $$ BEGIN
    CREATE TYPE "AmbienteIntegracao" AS ENUM ('SANDBOX', 'PRODUCAO');
EXCEPTION
    WHEN duplicate_object THEN
        RAISE NOTICE 'Tipo "AmbienteIntegracao" já existe — ignorando.';
END $$;

DO $$ BEGIN
    CREATE TYPE "StatusIntegracaoBancaria" AS ENUM (
        'PENDENTE',
        'ATIVA',
        'EXPIRADA',
        'ERRO',
        'DESATIVADA'
    );
EXCEPTION
    WHEN duplicate_object THEN
        RAISE NOTICE 'Tipo "StatusIntegracaoBancaria" já existe — ignorando.';
END $$;

DO $$ BEGIN
    CREATE TYPE "StatusCobrancaPicPay" AS ENUM (
        'PENDENTE',
        'CRIADA',
        'PAGA',
        'EXPIRADA',
        'CANCELADA',
        'ESTORNADA',
        'ERRO'
    );
EXCEPTION
    WHEN duplicate_object THEN
        RAISE NOTICE 'Tipo "StatusCobrancaPicPay" já existe — ignorando.';
END $$;

-- ── TABELA: IntegracaoBancaria ───────────────────────────────────────────────
-- 1:1 com ContaBancaria. Guarda credenciais criptografadas em AES-256-GCM.

CREATE TABLE IF NOT EXISTS "IntegracaoBancaria" (
    "id" SERIAL PRIMARY KEY,
    "contaBancariaId" INTEGER NOT NULL UNIQUE,
    "provedor" "ProvedorIntegracao" NOT NULL,
    "ambiente" "AmbienteIntegracao" NOT NULL DEFAULT 'SANDBOX',
    "status" "StatusIntegracaoBancaria" NOT NULL DEFAULT 'PENDENTE',
    "apiTokenCriptografado" TEXT,
    "apiSecretCriptografado" TEXT,
    "webhookSecretCriptografado" TEXT,
    "sellerIdCriptografado" TEXT,
    "chavePixRecebimento" TEXT,
    "accessTokenCriptografado" TEXT,
    "refreshTokenCriptografado" TEXT,
    "tokenExpiresAt" TIMESTAMP,
    "baseUrl" TEXT,
    "ipWhitelist" TEXT,
    "ultimaSincronizacao" TIMESTAMP,
    "proximaSincronizacao" TIMESTAMP,
    "ultimoErro" TEXT,
    "ativa" BOOLEAN NOT NULL DEFAULT FALSE,
    "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
    "createdById" INTEGER,
    CONSTRAINT "IntegracaoBancaria_contaBancariaId_fkey"
        FOREIGN KEY ("contaBancariaId") REFERENCES "ContaBancaria"("id") ON DELETE CASCADE,
    CONSTRAINT "IntegracaoBancaria_createdById_fkey"
        FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL
);

-- ── TABELA: WebhookBancarioLog ───────────────────────────────────────────────
-- Audita TODA chamada de webhook recebida (válida ou inválida).
-- Permite forense em caso de fraude, replay attack ou erro de processamento.

CREATE TABLE IF NOT EXISTS "WebhookBancarioLog" (
    "id" SERIAL PRIMARY KEY,
    "integracaoId" INTEGER NOT NULL,
    "recebidoEm" TIMESTAMP NOT NULL DEFAULT NOW(),
    "ipOrigem" TEXT,
    "assinaturaHeader" TEXT,
    "assinaturaValida" BOOLEAN NOT NULL DEFAULT FALSE,
    "payloadJson" TEXT NOT NULL,
    "evento" TEXT,
    "referenceId" TEXT,
    "processado" BOOLEAN NOT NULL DEFAULT FALSE,
    "processadoEm" TIMESTAMP,
    "erro" TEXT,
    CONSTRAINT "WebhookBancarioLog_integracaoId_fkey"
        FOREIGN KEY ("integracaoId") REFERENCES "IntegracaoBancaria"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "WebhookBancarioLog_integracaoId_recebidoEm_idx"
    ON "WebhookBancarioLog" ("integracaoId", "recebidoEm");

CREATE INDEX IF NOT EXISTS "WebhookBancarioLog_referenceId_idx"
    ON "WebhookBancarioLog" ("referenceId");

-- ── TABELA: CobrancaPicPay ───────────────────────────────────────────────────
-- Cobranças PIX/PicPay geradas pelo ERP. referenceId UUIDv4 único = idempotência.

CREATE TABLE IF NOT EXISTS "CobrancaPicPay" (
    "id" SERIAL PRIMARY KEY,
    "integracaoId" INTEGER NOT NULL,
    "referenceId" TEXT NOT NULL UNIQUE,
    "vendaId" INTEGER,
    "contaReceberId" INTEGER,
    "valor" DECIMAL(10,2) NOT NULL,
    "expiresAt" TIMESTAMP,
    "status" "StatusCobrancaPicPay" NOT NULL DEFAULT 'PENDENTE',
    "qrCodeUrl" TEXT,
    "qrCodePayload" TEXT,
    "paymentUrl" TEXT,
    "pagoEm" TIMESTAMP,
    "cancelladoEm" TIMESTAMP,
    "authorizationId" TEXT,
    "observacoes" TEXT,
    "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
    "createdById" INTEGER,
    CONSTRAINT "CobrancaPicPay_integracaoId_fkey"
        FOREIGN KEY ("integracaoId") REFERENCES "IntegracaoBancaria"("id") ON DELETE CASCADE,
    CONSTRAINT "CobrancaPicPay_vendaId_fkey"
        FOREIGN KEY ("vendaId") REFERENCES "Venda"("id") ON DELETE SET NULL,
    CONSTRAINT "CobrancaPicPay_contaReceberId_fkey"
        FOREIGN KEY ("contaReceberId") REFERENCES "ContaReceber"("id") ON DELETE SET NULL,
    CONSTRAINT "CobrancaPicPay_createdById_fkey"
        FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "CobrancaPicPay_status_idx" ON "CobrancaPicPay" ("status");
CREATE INDEX IF NOT EXISTS "CobrancaPicPay_vendaId_idx" ON "CobrancaPicPay" ("vendaId");

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICAÇÃO PÓS-APLICAÇÃO
-- ─────────────────────────────────────────────────────────────────────────────

-- Confere se as tabelas existem:
-- SELECT tablename FROM pg_tables WHERE schemaname='public'
--   AND tablename IN ('IntegracaoBancaria', 'WebhookBancarioLog', 'CobrancaPicPay');

-- Confere se os enums existem:
-- SELECT typname FROM pg_type WHERE typname IN
--   ('ProvedorIntegracao', 'AmbienteIntegracao', 'StatusIntegracaoBancaria', 'StatusCobrancaPicPay');

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (somente em emergência)
-- ─────────────────────────────────────────────────────────────────────────────
-- ATENÇÃO: Isso APAGA todos os dados das 3 tabelas. Use só se necessário.
--
-- BEGIN;
-- DROP TABLE IF EXISTS "CobrancaPicPay" CASCADE;
-- DROP TABLE IF EXISTS "WebhookBancarioLog" CASCADE;
-- DROP TABLE IF EXISTS "IntegracaoBancaria" CASCADE;
-- DROP TYPE IF EXISTS "StatusCobrancaPicPay";
-- DROP TYPE IF EXISTS "StatusIntegracaoBancaria";
-- DROP TYPE IF EXISTS "AmbienteIntegracao";
-- DROP TYPE IF EXISTS "ProvedorIntegracao";
-- COMMIT;
