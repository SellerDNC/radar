# Migrations — Radar ML D1

## Como aplicar

### Via MCP (Cloudflare):
```
d1_database_query(database_id, sql=<conteúdo do arquivo>)
```

### Via Wrangler:
```bash
wrangler d1 execute radar-db --file=migrations/001_initial.sql
wrangler d1 execute radar-db --file=migrations/002_add_status_tokens.sql
```

## Histórico

| Arquivo | Data | Descrição |
|---------|------|-----------|
| 001_initial.sql | 2026-03 | Schema completo inicial |
| 002_add_status_tokens.sql | 2026-04 | Status de pesquisa + tracking de tokens e custo |

## Próximas migrations planejadas (Fase 2)

- `003_add_rate_limit_table.sql` — tabela para rate limiting
- `004_supabase_user_id.sql` — migrar tenant_id para UUID Supabase
- `005_data_retention.sql` — política de retenção (soft delete)
