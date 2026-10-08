export function formatTotal(values: number[]): string {
  return `Total: ${values.reduce((a, b) => a + b, 0)}`;
}
