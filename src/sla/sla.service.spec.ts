import { escolherPolitica } from './sla.service.js';

const politicas = [
  { id: 2, prioridade_alvo: 'CRITICA', tipo_chamado_alvo: 'INCIDENTE' },
  { id: 5, prioridade_alvo: 'ALTA', tipo_chamado_alvo: 'AMBOS' },
];

describe('escolherPolitica', () => {
  it('prefere a política da mesma prioridade e do mesmo tipo', () => {
    expect(escolherPolitica(politicas, 'INCIDENTE', 'CRITICA')?.id).toBe(2);
  });

  it('usa AMBOS da mesma prioridade quando o tipo não tem política própria', () => {
    expect(escolherPolitica(politicas, 'REQUISICAO', 'ALTA')?.id).toBe(5);
  });

  it('cai para outra prioridade ativa quando a combinação não existe', () => {
    expect(escolherPolitica(politicas, 'REQUISICAO', 'BAIXA')?.id).toBe(5);
  });

  it('não escolhe nada quando o tenant não tem política ativa', () => {
    expect(escolherPolitica([], 'INCIDENTE', 'ALTA')).toBeUndefined();
  });
});
