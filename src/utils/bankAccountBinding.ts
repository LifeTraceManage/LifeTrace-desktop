/** Extract raw ICBC account identity from an immutable bank provenance marker. */
export function statementAccountFromSourceId(sourceId?: string): string {
  if (!sourceId?.startsWith("工商银行流水/")) return "";
  return sourceId.split("/")[3]?.trim() ?? "";
}
/** Never silently bind a statement to a card with conflicting identity. */
export function canBindStatementAccount(rawAccount: string, last4: string | undefined, confirmed: boolean): boolean {
  if (!rawAccount) return false;
  if (last4 && /^\d{4}$/.test(last4) && rawAccount.replace(/\D/g, "").endsWith(last4)) return true;
  return confirmed;
}
