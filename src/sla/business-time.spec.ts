import { addBusinessMinutes, businessMinutesBetween, FUSOS_SUPORTADOS, offsetDoFuso } from './business-time.js';

describe('fusos horários', () => {
  it.each([
    ['America/Cuiaba', -240],
    ['America/Sao_Paulo', -180],
    ['America/Porto_Velho', -240],
    ['America/Rio_Branco', -300],
    ['America/Belem', -180],
    ['America/Fortaleza', -180],
    ['America/Recife', -180],
    ['America/Noronha', -120],
    ['UTC', 0],
  ])('%s tem offset %i min', (fuso, offset) => {
    expect(FUSOS_SUPORTADOS).toContain(fuso);
    expect(offsetDoFuso(fuso)).toBe(offset);
  });

  it('o horário de Rio Branco desloca o expediente em relação a Cuiabá', () => {
    // 08:00 em Rio Branco (UTC-5) = 13:00 UTC; em Cuiabá (UTC-4) o expediente abriria às 12:00 UTC.
    const segunda = new Date('2026-09-21T10:00:00.000Z');
    const fim = addBusinessMinutes(segunda, 60, [], [], offsetDoFuso('America/Rio_Branco'));
    expect(fim.toISOString()).toBe('2026-09-21T14:00:00.000Z');
  });
});

describe('grade útil', () => {
  const cuiaba = -240;

  it('soma minutos dentro do expediente', () => {
    const inicio = new Date('2026-09-21T14:00:00.000Z');
    const fim = addBusinessMinutes(inicio, 60, [], [], cuiaba);
    expect(fim.toISOString()).toBe('2026-09-21T15:00:00.000Z');
  });

  it('pula o fim de semana', () => {
    const sexta = new Date('2026-09-25T21:30:00.000Z');
    const fim = addBusinessMinutes(sexta, 60, [], [], cuiaba);
    expect(fim.toISOString()).toBe('2026-09-28T12:30:00.000Z');
  });

  it('conta só o tempo útil de uma pausa', () => {
    const inicio = new Date('2026-09-21T14:00:00.000Z');
    const fim = new Date('2026-09-21T16:30:00.000Z');
    expect(businessMinutesBetween(inicio, fim, [], [], cuiaba)).toBe(150);
  });
});
