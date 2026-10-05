export function describeBar(tabCount: number): string {
  return `bar for ${tabCount} tab${tabCount === 1 ? "" : "s"}`;
}
