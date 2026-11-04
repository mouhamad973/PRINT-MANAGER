import { describe, expect, it } from 'vitest';
import { CSV_TEMPLATE, parseDate, parseMeterCsv } from './csv';

describe('parseMeterCsv', () => {
  it('lit le modèle fourni à l’utilisateur', () => {
    const { rows, errors } = parseMeterCsv(CSV_TEMPLATE);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      serialNumber: 'SN-0001',
      blackCount: 125000,
      colorCount: 48000,
      isReset: false,
    });
    expect(rows[1]).toMatchObject({ serialNumber: 'SN-0002', colorCount: null });
  });

  it('accepte les en-têtes accentués, la virgule et les guillemets', () => {
    const { rows } = parseMeterCsv(
      '﻿Numéro de série,Date,Noir et blanc,Couleur,Remise à zéro\n"SN,1",2026-10-01 07:05,12,3,oui\n',
    );
    expect(rows).toEqual([
      expect.objectContaining({
        serialNumber: 'SN,1',
        blackCount: 12,
        colorCount: 3,
        isReset: true,
      }),
    ]);
  });

  it('signale chaque ligne illisible avec son numéro', () => {
    const { rows, errors } = parseMeterCsv(
      'numero_serie;date;noir\nSN-1;31/02/2026;10\nSN-2;01/10/2026;1,5\n;01/10/2026;3\nSN-4;01/10/2026;4\n',
    );
    expect(rows.map((row) => row.serialNumber)).toEqual(['SN-4']);
    expect(errors).toEqual([
      { line: 2, message: 'date illisible « 31/02/2026 »' },
      { line: 3, message: 'compteur noir illisible « 1,5 »' },
      { line: 4, message: 'numéro de série manquant' },
    ]);
  });

  it('exige les colonnes obligatoires', () => {
    expect(parseMeterCsv('serie;noir\nSN;1').errors[0]!.message).toContain('Colonnes attendues');
  });
});

describe('parseDate', () => {
  it('place une date seule à midi, heure locale', () => {
    const date = parseDate('2026-11-04')!;
    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()]).toEqual([
      2026, 10, 4, 12,
    ]);
  });

  it('lit le format français avec l’heure', () => {
    const date = parseDate('04/11/2026 08:30')!;
    expect([date.getDate(), date.getMonth(), date.getHours(), date.getMinutes()]).toEqual([
      4, 10, 8, 30,
    ]);
  });
});
