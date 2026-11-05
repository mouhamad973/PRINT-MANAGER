/** Conditions d'un contrat au coût copie. */
export interface BillingTerms {
  fixedFee: number;
  includedBlackPages: number;
  includedColorPages: number;
  blackPagePrice: number;
  colorPagePrice: number;
}

export interface BillingResult {
  blackPages: number;
  colorPages: number;
  extraBlackPages: number;
  extraColorPages: number;
  extraBlackAmount: number;
  extraColorAmount: number;
  totalAmount: number;
}

/**
 * Montant d'un relevé : le forfait, plus les pages au-delà des pages incluses, au prix de la
 * page. Les pages sont arrondies à l'unité, les montants au centime.
 */
export function bill(terms: BillingTerms, blackPages: number, colorPages: number): BillingResult {
  const black = Math.round(blackPages);
  const color = Math.round(colorPages);
  const extraBlackPages = Math.max(black - terms.includedBlackPages, 0);
  const extraColorPages = Math.max(color - terms.includedColorPages, 0);
  const extraBlackAmount = cents(extraBlackPages * terms.blackPagePrice);
  const extraColorAmount = cents(extraColorPages * terms.colorPagePrice);
  return {
    blackPages: black,
    colorPages: color,
    extraBlackPages,
    extraColorPages,
    extraBlackAmount,
    extraColorAmount,
    totalAmount: cents(terms.fixedFee + extraBlackAmount + extraColorAmount),
  };
}

/** Numéro d'un relevé émis : REL-2026-0001, une suite par année et par entreprise. */
export function invoiceNumber(year: number, sequence: number): string {
  return `REL-${year}-${String(sequence).padStart(4, '0')}`;
}

function cents(value: number): number {
  return Math.round(value * 100) / 100;
}
