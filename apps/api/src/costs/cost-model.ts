import type { CostBreakdown } from '@arksen/shared-types';

/** Durée moyenne d'un mois, pour proratiser les coûts fixes mensuels. */
export const DAYS_PER_MONTH = 365.25 / 12;

export interface CostInput {
  pages: number;
  colorPages: number;
  /** Coût du toner noir et des toners couleur sur la période ; nul s'il est inconnu. */
  blackToner: number | null;
  colorToner: number | null;
  /** Prix d'une feuille du papier de la machine ; nul s'il est inconnu. */
  sheetPrice: number | null;
  duplexPercent: number;
  maintenance: number;
  monthlyFixed: number | null;
  days: number;
}

/**
 * Coût d'impression d'une machine sur une période, et coût copie.
 *
 * - Toner : consommation estimée par le moteur CMJN, au prix d'achat des cartouches.
 * - Papier : feuilles = pages × (1 − recto verso / 2), au prix de la feuille.
 * - Maintenance : pièces et main-d'œuvre des interventions terminées sur la période.
 * - Coûts fixes : mensuels, au prorata des jours.
 *
 * Coût copie : une page noire porte le toner noir et sa part des coûts communs (papier,
 * maintenance, fixes) ; une page couleur y ajoute les toners cyan, magenta et jaune, répartis
 * sur les seules pages couleur.
 */
export function computeCosts(input: CostInput): CostBreakdown {
  const toner =
    input.blackToner === null || input.colorToner === null
      ? null
      : input.blackToner + input.colorToner;
  const paper =
    input.sheetPrice === null
      ? null
      : input.pages * (1 - input.duplexPercent / 200) * input.sheetPrice;
  const fixed =
    input.monthlyFixed === null ? 0 : (input.monthlyFixed * input.days) / DAYS_PER_MONTH;
  const shared = (paper ?? 0) + input.maintenance + fixed;
  const total = (toner ?? 0) + shared;
  const costPerBlackPage =
    input.pages > 0 ? ((input.blackToner ?? 0) + shared) / input.pages : null;
  return {
    pages: input.pages,
    colorPages: input.colorPages,
    blackPages: input.pages - input.colorPages,
    toner: round(toner),
    paper: round(paper),
    maintenance: round(input.maintenance)!,
    fixed: round(fixed)!,
    total: round(total)!,
    costPerPage: input.pages > 0 ? round(total / input.pages, 6) : null,
    costPerBlackPage: round(costPerBlackPage, 6),
    costPerColorPage:
      costPerBlackPage !== null && input.colorPages > 0
        ? round(costPerBlackPage + (input.colorToner ?? 0) / input.colorPages, 6)
        : null,
  };
}

/** Somme des coûts de plusieurs machines ; un coût inconnu partout reste inconnu. */
export function sumCosts(
  items: (CostBreakdown & { blackToner: number | null; colorToner: number | null })[],
): CostBreakdown {
  const pages = items.reduce((sum, item) => sum + item.pages, 0);
  const colorPages = items.reduce((sum, item) => sum + item.colorPages, 0);
  const known = <K extends keyof CostBreakdown>(key: K) => {
    const values = items.map((item) => item[key]).filter((value) => value !== null) as number[];
    return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  };
  const toner = known('toner');
  const paper = known('paper');
  const maintenance = known('maintenance') ?? 0;
  const fixed = known('fixed') ?? 0;
  const blackToner = items.reduce((sum, item) => sum + (item.blackToner ?? 0), 0);
  const colorToner = items.reduce((sum, item) => sum + (item.colorToner ?? 0), 0);
  const shared = (paper ?? 0) + maintenance + fixed;
  const total = (toner ?? 0) + shared;
  const costPerBlackPage = pages > 0 ? (blackToner + shared) / pages : null;
  return {
    pages,
    colorPages,
    blackPages: pages - colorPages,
    toner: round(toner),
    paper: round(paper),
    maintenance: round(maintenance)!,
    fixed: round(fixed)!,
    total: round(total)!,
    costPerPage: pages > 0 ? round(total / pages, 6) : null,
    costPerBlackPage: round(costPerBlackPage, 6),
    costPerColorPage:
      costPerBlackPage !== null && colorPages > 0
        ? round(costPerBlackPage + colorToner / colorPages, 6)
        : null,
  };
}

function round(value: number | null, digits = 2): number | null {
  if (value === null) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
