-- ============================================================
-- DIAGNÓSTICO COMPLETO — SOMENTE LEITURA (nenhum dado alterado)
-- Executar na VPS: psql $DATABASE_URL -f diagnostico-banco-completo.sql
-- ============================================================

\echo '=== 1. TODAS AS TABELAS DO BANCO ==='
SELECT table_name
FROM   information_schema.tables
WHERE  table_schema = 'public'
  AND  table_type   = 'BASE TABLE'
ORDER  BY table_name;

\echo ''
\echo '=== 2. TODOS OS ENUMS E SEUS VALORES ==='
SELECT t.typname AS enum_name,
       e.enumlabel AS valor,
       e.enumsortorder AS ordem
FROM   pg_type t
JOIN   pg_enum e ON e.enumtypid = t.oid
WHERE  t.typtype = 'e'
ORDER  BY t.typname, e.enumsortorder;

\echo ''
\echo '=== 3. COLUNAS DE UnidadeFisica ==='
SELECT column_name, data_type, is_nullable, column_default
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'UnidadeFisica'
ORDER  BY ordinal_position;

\echo ''
\echo '=== 4. COLUNAS DE LogAuditoria ==='
SELECT column_name, data_type, is_nullable, column_default
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'LogAuditoria'
ORDER  BY ordinal_position;

\echo ''
\echo '=== 5. COLUNAS DE Venda ==='
SELECT column_name, data_type, is_nullable, column_default
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'Venda'
ORDER  BY ordinal_position;

\echo ''
\echo '=== 6. COLUNAS DE Lead (existe?) ==='
SELECT column_name, data_type, is_nullable
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'Lead'
ORDER  BY ordinal_position;

\echo ''
\echo '=== 7. COLUNAS DE LeadInteracao (existe?) ==='
SELECT column_name, data_type, is_nullable
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'LeadInteracao'
ORDER  BY ordinal_position;

\echo ''
\echo '=== 8. COLUNAS DE Produto ==='
SELECT column_name, data_type, is_nullable, column_default
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'Produto'
ORDER  BY ordinal_position;

\echo ''
\echo '=== 9. COLUNAS DE Estoque ==='
SELECT column_name, data_type, is_nullable, column_default
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'Estoque'
ORDER  BY ordinal_position;

\echo ''
\echo '=== 10. COLUNAS DE User ==='
SELECT column_name, data_type, is_nullable, column_default
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'User'
ORDER  BY ordinal_position;

\echo ''
\echo '=== 11. COLUNAS DE ContaPagar ==='
SELECT column_name, data_type, is_nullable, column_default
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'ContaPagar'
ORDER  BY ordinal_position;

\echo ''
\echo '=== 12. COLUNAS DE PedidoCompra ==='
SELECT column_name, data_type, is_nullable, column_default
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'PedidoCompra'
ORDER  BY ordinal_position;

\echo ''
\echo '=== 13. FOREIGN KEYS em UnidadeFisica ==='
SELECT kcu.column_name,
       ccu.table_name  AS tabela_referenciada,
       ccu.column_name AS coluna_referenciada,
       rc.constraint_name
FROM   information_schema.table_constraints        AS tc
JOIN   information_schema.key_column_usage         AS kcu USING (constraint_name, table_schema)
JOIN   information_schema.constraint_column_usage  AS ccu USING (constraint_name, table_schema)
JOIN   information_schema.referential_constraints  AS rc  USING (constraint_name)
WHERE  tc.constraint_type = 'FOREIGN KEY'
  AND  tc.table_name      = 'UnidadeFisica';

\echo ''
\echo '=== 14. ENUM "Role" — valores reais no banco ==='
SELECT e.enumlabel AS valor
FROM   pg_type t
JOIN   pg_enum e ON e.enumtypid = t.oid
WHERE  t.typname = 'Role'
ORDER  BY e.enumsortorder;

\echo ''
\echo '=== 15. ENUM "FormaPagamento" — valores reais no banco ==='
SELECT e.enumlabel AS valor
FROM   pg_type t
JOIN   pg_enum e ON e.enumtypid = t.oid
WHERE  t.typname = 'FormaPagamento'
ORDER  BY e.enumsortorder;

\echo ''
\echo '=== 16. ENUM "StatusUnidade" — valores reais no banco ==='
SELECT e.enumlabel AS valor
FROM   pg_type t
JOIN   pg_enum e ON e.enumtypid = t.oid
WHERE  t.typname = 'StatusUnidade'
ORDER  BY e.enumsortorder;

\echo ''
\echo '=== 17. TODOS OS ENUMS EXISTENTES NO BANCO (nomes) ==='
SELECT DISTINCT t.typname AS enum_name
FROM   pg_type t
JOIN   pg_enum e ON e.enumtypid = t.oid
WHERE  t.typtype = 'e'
ORDER  BY t.typname;

\echo ''
\echo '=== 18. CONTAGEM DE LINHAS NAS TABELAS CRÍTICAS ==='
SELECT 'UnidadeFisica' AS tabela, COUNT(*) FROM "UnidadeFisica"
UNION ALL
SELECT 'Estoque',       COUNT(*) FROM "Estoque"
UNION ALL
SELECT 'Venda',         COUNT(*) FROM "Venda"
UNION ALL
SELECT 'Lead' ,         COUNT(*) FROM "Lead"
UNION ALL
SELECT 'LogAuditoria',  COUNT(*) FROM "LogAuditoria";

\echo ''
\echo '=== 19. CONSTRAINT UNIQUE em Estoque ==='
SELECT constraint_name, column_name
FROM   information_schema.constraint_column_usage
WHERE  table_name = 'Estoque';

\echo ''
\echo '=== DIAGNÓSTICO CONCLUÍDO ==='
