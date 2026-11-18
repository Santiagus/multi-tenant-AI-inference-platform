/**
 * Hardware acquisition (CapEx) and long-term reservation advisory.
 *
 * All figures here are ESTIMATED planning assumptions (list prices and typical
 * commitment discounts), not provider-reported quotes. Inputs come from the
 * measured economics ledger, scaled by an operator-chosen projection.
 */

export const HOURS_PER_MONTH = 730;
export const ELECTRICITY_USD_PER_KWH = 0.15;

export interface HardwareOption {
  id: string;
  name: string;
  vramGb: number;
  capexUsd: number;
  powerKw: number;
  /** Cloud on-demand/spot hourly rate of the equivalent cloud SKU (estimated). */
  cloudEquivalentHourlyUsd: number;
}

export const HARDWARE_OPTIONS: HardwareOption[] = [
  { id: 'rtx-5070-ti', name: 'RTX 5070 Ti (16GB)', vramGb: 16, capexUsd: 950, powerKw: 0.3, cloudEquivalentHourlyUsd: 0.34 },
  { id: 'rtx-5090', name: 'RTX 5090 (32GB)', vramGb: 32, capexUsd: 2200, powerKw: 0.6, cloudEquivalentHourlyUsd: 0.69 },
  { id: 'h100-80gb', name: 'H100 (80GB)', vramGb: 80, capexUsd: 28000, powerKw: 0.7, cloudEquivalentHourlyUsd: 1.99 },
];

export interface ReservationTerm {
  id: string;
  label: string;
  discountPct: number;
  termMonths: number;
}

export const RESERVATION_TERMS: ReservationTerm[] = [
  { id: '1m', label: '1-month commit', discountPct: 20, termMonths: 1 },
  { id: '1y', label: '1-year reserved', discountPct: 38, termMonths: 12 },
  { id: '3y', label: '3-year reserved', discountPct: 55, termMonths: 36 },
];

export interface AcquisitionResult {
  option: HardwareOption;
  cardsNeeded: number;
  utilizationPct: number;
  capexTotalUsd: number;
  monthlyPowerUsd: number;
  monthlySavingsUsd: number;
  /** Months until CapEx is repaid; null if hardware never pays back. */
  breakEvenMonths: number | null;
  twelveMonthNetUsd: number;
}

export interface ReservationResult {
  term: ReservationTerm;
  monthlyCostUsd: number;
  monthlySavingsUsd: number;
  twelveMonthNetUsd: number;
}

export type AdvisoryAction = 'keep_flexible' | 'reserve' | 'acquire_hardware';

export interface Advisory {
  monthlySpendUsd: number;
  acquisitions: AcquisitionResult[];
  reservations: ReservationResult[];
  bestAcquisition: AcquisitionResult | null;
  action: AdvisoryAction;
  rationale: string;
}

/** Projects monthly spend: manual override wins, else ledger spend (assumed 1 day) × multiplier × 30. */
export function projectMonthlySpendUsd(
  observedLedgerCostUsd: number,
  volumeMultiplier: number,
  manualOverrideUsd = 0
): number {
  if (manualOverrideUsd > 0) return manualOverrideUsd;
  return Math.max(0, observedLedgerCostUsd) * 30 * Math.max(0, volumeMultiplier);
}

export function evaluateAcquisition(option: HardwareOption, monthlySpendUsd: number): AcquisitionResult {
  const cardMonthlyCloud = option.cloudEquivalentHourlyUsd * HOURS_PER_MONTH;
  const cardsNeeded = monthlySpendUsd > 0 ? Math.max(1, Math.ceil(monthlySpendUsd / cardMonthlyCloud)) : 0;
  const utilization = cardsNeeded > 0 ? Math.min(1, monthlySpendUsd / (cardsNeeded * cardMonthlyCloud)) : 0;
  const monthlyPowerUsd = cardsNeeded * option.powerKw * HOURS_PER_MONTH * ELECTRICITY_USD_PER_KWH * utilization;
  const capexTotalUsd = cardsNeeded * option.capexUsd;
  const monthlySavingsUsd = monthlySpendUsd - monthlyPowerUsd;
  const breakEvenMonths =
    cardsNeeded > 0 && monthlySavingsUsd > 0 ? capexTotalUsd / monthlySavingsUsd : null;
  return {
    option,
    cardsNeeded,
    utilizationPct: utilization * 100,
    capexTotalUsd,
    monthlyPowerUsd,
    monthlySavingsUsd,
    breakEvenMonths,
    twelveMonthNetUsd: monthlySavingsUsd * 12 - capexTotalUsd,
  };
}

export function evaluateReservation(term: ReservationTerm, monthlySpendUsd: number): ReservationResult {
  const monthlyCostUsd = monthlySpendUsd * (1 - term.discountPct / 100);
  const monthlySavingsUsd = monthlySpendUsd - monthlyCostUsd;
  return { term, monthlyCostUsd, monthlySavingsUsd, twelveMonthNetUsd: monthlySavingsUsd * 12 };
}

export function computeAdvisory(monthlySpendUsd: number): Advisory {
  const acquisitions = HARDWARE_OPTIONS.map((o) => evaluateAcquisition(o, monthlySpendUsd));
  const reservations = RESERVATION_TERMS.map((t) => evaluateReservation(t, monthlySpendUsd));

  const payingBack = acquisitions.filter((a) => a.breakEvenMonths !== null);
  const bestAcquisition =
    payingBack.length > 0
      ? payingBack.reduce((best, a) => (a.twelveMonthNetUsd > best.twelveMonthNetUsd ? a : best))
      : null;

  let action: AdvisoryAction = 'keep_flexible';
  let rationale = 'Spend is too low or bursty to justify a commitment; stay on spot, serverless or Token Factory.';

  if (bestAcquisition && bestAcquisition.breakEvenMonths !== null && bestAcquisition.breakEvenMonths <= 12) {
    action = 'acquire_hardware';
    rationale = `${bestAcquisition.cardsNeeded}× ${bestAcquisition.option.name} pays back in ${bestAcquisition.breakEvenMonths.toFixed(1)} months at ${bestAcquisition.utilizationPct.toFixed(0)}% utilization (estimated).`;
  } else if (bestAcquisition && bestAcquisition.utilizationPct >= 60) {
    action = 'reserve';
    rationale = 'Sustained utilization is high but hardware payback exceeds 12 months; a 1-year reservation captures savings without CapEx (estimated).';
  }

  return { monthlySpendUsd, acquisitions, reservations, bestAcquisition, action, rationale };
}
