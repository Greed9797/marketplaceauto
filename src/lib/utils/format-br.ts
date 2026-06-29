const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const integerFormatter = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 0,
});

const percentFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function formatCurrencyBR(value: number) {
  return currencyFormatter.format(value).replace(/\u00a0/g, " ");
}

export function formatIntegerBR(value: number) {
  return integerFormatter.format(value);
}

export function formatPercentBR(value: number) {
  return `${percentFormatter.format(value)}%`;
}

export function formatRoasBR(value: number) {
  return `${value.toFixed(2)}x`;
}
