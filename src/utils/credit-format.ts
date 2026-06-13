const CREDIT_AMOUNT_DECIMALS = 2

const creditAmountFormatter = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 0,
  maximumFractionDigits: CREDIT_AMOUNT_DECIMALS,
})

function roundDecimal(value: number, decimals: number) {
  const [coefficient, exponent = '0'] = value.toString().split('e')
  const shifted = Math.round(Number(`${coefficient}e${Number(exponent) + decimals}`))
  const [roundedCoefficient, roundedExponent = '0'] = shifted.toString().split('e')
  return Number(`${roundedCoefficient}e${Number(roundedExponent) - decimals}`)
}

export function roundCreditAmount(value: unknown) {
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  const rounded = roundDecimal(Math.abs(number), CREDIT_AMOUNT_DECIMALS)
  const signed = number < 0 ? -rounded : rounded
  return Object.is(signed, -0) ? 0 : signed
}

export function normalizeCreditBalance(value: unknown) {
  const rounded = roundCreditAmount(value)
  return rounded === null ? null : Math.max(0, rounded)
}

export function formatCreditAmount(value: unknown, fallback = '0') {
  const rounded = roundCreditAmount(value)
  return rounded === null ? fallback : creditAmountFormatter.format(rounded)
}

export function formatSignedCreditAmount(value: unknown, fallback = '0') {
  const rounded = roundCreditAmount(value)
  if (rounded === null) return fallback
  const formatted = creditAmountFormatter.format(rounded)
  return rounded > 0 ? `+${formatted}` : formatted
}
