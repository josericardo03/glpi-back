export type Slot = { dia: number; inicio: number; fim: number };
export type Feriado = { dia: number; mes: number; ano: number | null };

export const EXPEDIENTE_PADRAO: Slot[] = [1, 2, 3, 4, 5].map((dia) => ({
  dia,
  inicio: 8 * 60,
  fim: 18 * 60,
}));

const OFFSETS: Record<string, number> = {
  'America/Cuiaba': -240,
  'America/Campo_Grande': -240,
  'America/Sao_Paulo': -180,
  'America/Manaus': -240,
  UTC: 0,
};

export function offsetDoFuso(fuso: string | null | undefined): number {
  if (!fuso) return -240;
  return OFFSETS[fuso] ?? -240;
}

type Partes = { y: number; m: number; d: number; dow: number; minute: number };

function partes(utc: Date, offsetMin: number): Partes {
  const local = new Date(utc.getTime() + offsetMin * 60_000);
  return {
    y: local.getUTCFullYear(),
    m: local.getUTCMonth() + 1,
    d: local.getUTCDate(),
    dow: local.getUTCDay(),
    minute: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
}

function emLocal(partesAlvo: Partes, offsetMin: number): Date {
  const asUtc = Date.UTC(
    partesAlvo.y,
    partesAlvo.m - 1,
    partesAlvo.d,
    Math.floor(partesAlvo.minute / 60),
    partesAlvo.minute % 60,
    0,
    0,
  );
  return new Date(asUtc - offsetMin * 60_000);
}

function meiaNoiteSeguinte(utc: Date, offsetMin: number): Date {
  const p = partes(utc, offsetMin);
  const base = new Date(Date.UTC(p.y, p.m - 1, p.d));
  base.setUTCDate(base.getUTCDate() + 1);
  return emLocal(
    {
      y: base.getUTCFullYear(),
      m: base.getUTCMonth() + 1,
      d: base.getUTCDate(),
      dow: base.getUTCDay(),
      minute: 0,
    },
    offsetMin,
  );
}

function noMinuto(utc: Date, offsetMin: number, minute: number): Date {
  const p = partes(utc, offsetMin);
  return emLocal({ ...p, minute }, offsetMin);
}

export function ehFeriado(p: Partes, feriados: Feriado[]): boolean {
  return feriados.some(
    (f) => f.dia === p.d && f.mes === p.m && (f.ano == null || f.ano === p.y),
  );
}

function slotsDoDia(intervalos: Slot[], dow: number): Slot[] {
  const base = intervalos.length > 0 ? intervalos : EXPEDIENTE_PADRAO;
  return base
    .filter((s) => s.dia === dow && s.fim > s.inicio)
    .sort((a, b) => a.inicio - b.inicio);
}

export function addBusinessMinutes(
  start: Date,
  minutes: number,
  intervalos: Slot[],
  feriados: Feriado[],
  offsetMin = -240,
): Date {
  if (minutes <= 0) return new Date(start);
  let remaining = minutes;
  let cursor = new Date(start);
  for (let guard = 0; guard < 20000 && remaining > 0; guard++) {
    const p = partes(cursor, offsetMin);
    if (ehFeriado(p, feriados)) {
      cursor = meiaNoiteSeguinte(cursor, offsetMin);
      continue;
    }
    const slots = slotsDoDia(intervalos, p.dow);
    const aberto = slots.find((s) => p.minute >= s.inicio && p.minute < s.fim);
    if (!aberto) {
      const proximo = slots.find((s) => s.inicio > p.minute);
      cursor = proximo
        ? noMinuto(cursor, offsetMin, proximo.inicio)
        : meiaNoiteSeguinte(cursor, offsetMin);
      continue;
    }
    const disponivel = aberto.fim - p.minute;
    const take = Math.min(disponivel, remaining);
    cursor = new Date(cursor.getTime() + take * 60_000);
    remaining -= take;
  }
  return cursor;
}

export function businessMinutesBetween(
  start: Date,
  end: Date,
  intervalos: Slot[],
  feriados: Feriado[],
  offsetMin = -240,
): number {
  if (end.getTime() <= start.getTime()) return 0;
  let total = 0;
  let cursor = new Date(start);
  for (let guard = 0; guard < 20000 && cursor < end; guard++) {
    const antes = cursor.getTime();
    const p = partes(cursor, offsetMin);
    if (ehFeriado(p, feriados)) {
      cursor = meiaNoiteSeguinte(cursor, offsetMin);
    } else {
      const slots = slotsDoDia(intervalos, p.dow);
      const aberto = slots.find((s) => p.minute >= s.inicio && p.minute < s.fim);
      if (!aberto) {
        const proximo = slots.find((s) => s.inicio > p.minute);
        cursor = proximo
          ? noMinuto(cursor, offsetMin, proximo.inicio)
          : meiaNoiteSeguinte(cursor, offsetMin);
      } else {
        const fimSlot = noMinuto(cursor, offsetMin, aberto.fim);
        const stop = fimSlot < end ? fimSlot : end;
        total += (stop.getTime() - cursor.getTime()) / 60_000;
        cursor = stop;
      }
    }
    if (cursor.getTime() <= antes) break;
    if (cursor > end) break;
  }
  return Math.round(total);
}
