CREATE INDEX IF NOT EXISTS idx_chamados_cliente_abertura ON chamados (id_cliente, data_abertura DESC);
CREATE INDEX IF NOT EXISTS idx_chamados_cliente_resolucao ON chamados (id_cliente, data_resolucao);
CREATE INDEX IF NOT EXISTS idx_chamados_cliente_status_abertura ON chamados (id_cliente, status, data_abertura DESC);
CREATE INDEX IF NOT EXISTS idx_notif_usuario_lida ON notificacoes (id_cliente, id_usuario, lida, data_criacao DESC);
CREATE INDEX IF NOT EXISTS idx_aprov_status_data ON requisicoes_aprovacao (id_cliente, status, data_solicitacao);
CREATE INDEX IF NOT EXISTS idx_artigos_kb_status ON artigos_kb (id_cliente, status);
CREATE INDEX IF NOT EXISTS idx_rel_ativos_destino ON relacionamentos_ativos (id_cliente, id_ativo_destino);
