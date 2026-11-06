-- Uma única pausa de SLA em aberto por chamado, garantida pelo banco.
-- Antes de criar o índice, encerra as pausas abertas duplicadas (mantém a mais recente),
-- que podiam surgir de duas requisições simultâneas de pausa.
UPDATE pausas_sla p
SET data_retomada = p.data_pausa,
    tempo_pausado_seg = 0
WHERE p.data_retomada IS NULL
  AND EXISTS (
    SELECT 1
    FROM pausas_sla q
    WHERE q.id_cliente = p.id_cliente
      AND q.id_chamado = p.id_chamado
      AND q.data_retomada IS NULL
      AND q.id > p.id
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_pausa_aberta_por_chamado
    ON pausas_sla (id_cliente, id_chamado)
    WHERE data_retomada IS NULL;
