UPDATE problemas
SET causa_raiz = NULL
WHERE causa_raiz IS NOT NULL AND btrim(causa_raiz) = '';

UPDATE problemas
SET solucao_contorno = NULL
WHERE solucao_contorno IS NOT NULL AND btrim(solucao_contorno) = '';

UPDATE mudancas m
SET status = 'AGENDADA'
FROM requisicoes_aprovacao a
WHERE a.id_mudanca = m.id
  AND a.id_cliente = m.id_cliente
  AND a.status = 'APROVADO'
  AND m.status IN ('RASCUNHO', 'AVALIACAO', 'APROVACAO');

UPDATE mudancas m
SET status = 'CANCELADA'
FROM requisicoes_aprovacao a
WHERE a.id_mudanca = m.id
  AND a.id_cliente = m.id_cliente
  AND a.status = 'REJEITADO'
  AND m.status IN ('RASCUNHO', 'AVALIACAO', 'APROVACAO');
