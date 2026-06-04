/**
 * Live currency conversion using the free Frankfurter API (European Central Bank data).
 * https://www.frankfurter.app/
 * No API key required, updated daily.
 */

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const rateCache = new Map(); // key: `${from}`, value: { rates, fetchedAt }

/**
 * Fetches all exchange rates for a given base currency.
 * Results are cached for 30 minutes to avoid hammering the API.
 * @param {string} baseCurrency - ISO 4217 currency code (e.g. "USD")
 * @returns {Promise<Object>} Map of currency code → rate relative to base
 */
export async function fetchExchangeRates(baseCurrency) {
  const cached = rateCache.get(baseCurrency);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.rates;
  }

  // Try Frankfurter API first
  try {
    const res = await fetch(
      `https://api.frankfurter.app/latest?from=${baseCurrency}`,
      { next: { revalidate: 1800 } }
    );
    if (res.ok) {
      const data = await res.json();
      const rates = { ...data.rates, [baseCurrency]: 1.0 };
      rateCache.set(baseCurrency, { rates, fetchedAt: Date.now() });
      return rates;
    }
  } catch (err) {
    console.warn("[currencyConverter] Frankfurter API failed, trying fallback:", err.message);
  }

  // Fallback to ExchangeRate-API
  try {
    const res = await fetch(
      `https://open.er-api.com/v6/latest/${baseCurrency}`,
      { next: { revalidate: 1800 } }
    );
    if (res.ok) {
      const data = await res.json();
      if (data.result === "success" && data.rates) {
        const rates = { ...data.rates, [baseCurrency]: 1.0 };
        rateCache.set(baseCurrency, { rates, fetchedAt: Date.now() });
        return rates;
      }
    }
  } catch (err) {
    console.warn("[currencyConverter] Fallback ExchangeRate-API also failed:", err.message);
  }

  return null;
}

/**
 * Convert a numeric value from one currency to another using live rates.
 * @param {number} amount
 * @param {string} from - source currency code
 * @param {string} to - target currency code
 * @param {Object} rates - rates map from fetchExchangeRates(from)
 * @returns {number} converted amount, rounded to 2 decimal places
 */
export function convertAmount(amount, from, to, rates) {
  if (!rates || from === to || !rates[to]) return amount;
  return Math.round(amount * rates[to] * 100) / 100;
}

/**
 * Converts all monetary fields inside a cost draft from one currency to another.
 * @param {Object} draft - the current cost draft state
 * @param {string} fromCurrency
 * @param {string} toCurrency
 * @param {Object} rates - from fetchExchangeRates(fromCurrency)
 * @returns {Object} new draft with all monetary values converted
 */
export function convertDraftCurrency(draft, fromCurrency, toCurrency, rates) {
  if (!rates || fromCurrency === toCurrency) return draft;

  const conv = (val) => {
    const num = Number(val);
    if (!val || isNaN(num) || num === 0) return val;
    return String(convertAmount(num, fromCurrency, toCurrency, rates));
  };

  const convertMember = (member) => {
    // Converting BACK to INR → restore the exact original INR rate to avoid paisa drift
    if (toCurrency === "INR" && member.base_inr_rate) {
      return {
        ...member,
        hourly_rate: member.base_inr_rate,
      };
    }

    const converted = { ...member, hourly_rate: conv(member.hourly_rate) };

    // Snapshot the base INR rate when converting FROM INR so round-trips stay clean
    if (fromCurrency === "INR" && member.hourly_rate && !member.base_inr_rate) {
      converted.base_inr_rate = String(member.hourly_rate);
    }

    return converted;
  };

  return {
    ...draft,
    currency: toCurrency,
    members: draft.members.map(convertMember),
    miscellaneous_costs: (draft.miscellaneous_costs || []).map((item) => ({
      ...item,
      amount: conv(item.amount),
    })),
  };
}
