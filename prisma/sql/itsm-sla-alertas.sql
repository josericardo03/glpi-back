-- Alertas de SLA já enviados (um por chamado e tipo), para o varredor não repetir avisos.
CREATE TABLE IF NOT EXISTS sla_alertas (
    id_cliente INT NOT NULL,
    id_chamado INT NOT NULL,
    tipo VARCHAR(20) NOT NULL,
    data_envio TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT pk_sla_alertas PRIMARY KEY (id_cliente, id_chamado, tipo),
    CONSTRAINT ck_sla_alerta_tipo CHECK (tipo IN ('PERTO', 'VENCIDO')),
    CONSTRAINT fk_sla_alerta_chamado FOREIGN KEY (id_cliente, id_chamado)
        REFERENCES chamados (id_cliente, id) ON DELETE CASCADE
);

-- A varredura roda a cada minuto: estes índices parciais cobrem só os chamados que ainda podem vencer.
CREATE INDEX IF NOT EXISTS idx_chamados_sla_resolucao_aberto
    ON chamados (data_previsao_resolucao)
    WHERE sla_vencido = FALSE AND status IN ('NOVO', 'EM_ATENDIMENTO');

CREATE INDEX IF NOT EXISTS idx_chamados_sla_resposta_novo
    ON chamados (data_previsao_resposta)
    WHERE sla_vencido = FALSE AND status = 'NOVO';
