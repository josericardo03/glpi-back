import { addBusinessMinutes, businessMinutesBetween } from './business-time.js';

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
