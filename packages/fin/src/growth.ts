/**
 * Compound Annual Growth Rate: (end / start)^(1 / years) - 1
 *
 * Invalid inputs THROW a RangeError instead of returning NaN.
 * Reason: NaN propagates silently through later calculations and an LLM agent
 * would happily report "growth was NaN%". A thrown error with a precise message
 * can be caught by the tool layer and returned to the model as an actionable
 * tool error ("start must be > 0") so it can correct its call.
 *
 * - start must be > 0 (growth from zero or a negative base is undefined)
 * - end must be >= 0 (end = 0 is a valid total loss => -1; a negative end
 *   would need a fractional power of a negative number)
 * - years must be > 0 (fractional years allowed, e.g. 2.5)
 */
export function cagr(start: number, end: number, years: number): number {
  assertFinite('start', start);
  assertFinite('end', end);
  assertFinite('years', years);
  if (start <= 0) throw new RangeError(`cagr: start must be > 0, got ${start}`);
  if (end < 0) throw new RangeError(`cagr: end must be >= 0, got ${end}`);
  if (years <= 0) throw new RangeError(`cagr: years must be > 0, got ${years}`);

  return Math.pow(end / start, 1 / years) - 1;
}

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`cagr: ${name} must be a finite number, got ${value}`);
  }
}
