/** Présentation du budget : fonctions pures. Aucun chiffre sans mesure ; le plafond est celui configuré, pas une valeur codée en dur. */
export interface BudgetLine {
  readonly provider: string;
  readonly capUsd: number;
  readonly spentUsd: number;
  readonly hardStop: boolean;
  readonly enabled: boolean;
}

export type BudgetLevel = "ok" | "warning" | "exceeded" | "disabled";

export interface BudgetRow extends BudgetLine {
  readonly ratio: number | null;
  readonly level: BudgetLevel;
}

export function budgetRows(lines: readonly BudgetLine[]): BudgetRow[] {
  return lines.map((l) => {
    const ratio = l.capUsd > 0 ? l.spentUsd / l.capUsd : null;
    const level: BudgetLevel = !l.enabled ? "disabled" : ratio === null ? (l.spentUsd > 0 ? "exceeded" : "ok") : ratio >= 1 ? "exceeded" : ratio >= 0.8 ? "warning" : "ok";
    return { ...l, ratio, level };
  });
}

export const formatUsd = (n: number): string => `${n.toFixed(2)} $`;
