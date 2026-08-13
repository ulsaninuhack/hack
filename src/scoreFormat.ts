const SCORE_FORMATTER = new Intl.NumberFormat('ko-KR', {
  maximumFractionDigits: 1,
})

export function formatScore(value: number | null | undefined, fallback = '–'): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? SCORE_FORMATTER.format(value)
    : fallback
}
