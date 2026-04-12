-- Radar ML — Migration 002: Status de pesquisas e tracking de tokens
-- Aplicada em: Abril 2026

ALTER TABLE searches ADD COLUMN status TEXT DEFAULT 'pendente';
ALTER TABLE searches ADD COLUMN tokens_in INTEGER DEFAULT 0;
ALTER TABLE searches ADD COLUMN tokens_out INTEGER DEFAULT 0;
ALTER TABLE searches ADD COLUMN cost_usd REAL DEFAULT 0;
