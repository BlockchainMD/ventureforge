/** Parse a server timestamp as UTC (server returns naive ISO strings without Z). */
export function parseUTC(timestamp: string): Date {
  if (timestamp.endsWith("Z") || timestamp.includes("+")) return new Date(timestamp);
  return new Date(timestamp + "Z");
}
