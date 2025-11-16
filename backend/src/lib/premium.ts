/**
 * Premium Subscription Helper
 * 
 * Calculates premium expiration dates based on subscription plan.
 */

export type PremiumPlan = 'weekly' | 'monthly' | 'yearly';

/**
 * Calculate premium_until date based on plan
 * @param plan - Subscription plan type
 * @returns ISO8601 timestamp string for premium expiration
 */
export function calculatePremiumUntil(plan: PremiumPlan): string {
  const now = new Date();
  const expirationDate = new Date(now);
  
  switch (plan) {
    case 'weekly':
      expirationDate.setDate(now.getDate() + 7);
      break;
    case 'monthly':
      expirationDate.setDate(now.getDate() + 30);
      break;
    case 'yearly':
      expirationDate.setDate(now.getDate() + 365);
      break;
    default:
      // Default to weekly if unknown plan
      expirationDate.setDate(now.getDate() + 7);
  }
  
  return expirationDate.toISOString();
}

/**
 * Check if premium is still active
 * @param premiumUntil - ISO8601 timestamp string
 * @returns true if premium is active, false otherwise
 */
export function isPremiumActive(premiumUntil: string | null): boolean {
  if (!premiumUntil) return false;
  const expirationDate = new Date(premiumUntil);
  const now = new Date();
  return expirationDate > now;
}

/**
 * Get plan price in Pi
 * @param plan - Subscription plan type
 * @returns Price in Pi currency
 */
export function getPlanPrice(plan: PremiumPlan): number {
  const prices = {
    weekly: 1,
    monthly: 3.14,
    yearly: 31.4,
  };
  return prices[plan] || prices.weekly;
}
