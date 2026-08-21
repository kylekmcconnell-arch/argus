import type { LeaderboardRow } from "../lib/growth";

function money(cents: number): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(cents / 100);
}

function letter(name: string): string {
  return (name.replace(/[^A-Za-z0-9]/g, "")[0] || "?").toUpperCase();
}

function accessLabel(row: { access: LeaderboardRow["access"]; rank: number }): string {
  if (row.access === "admitted") return "Live access";
  return `Queue #${row.rank}`;
}

export function ReferralLeaderboard({
  rows,
  empty,
}: {
  rows: Array<Omit<LeaderboardRow, "code"> & { code?: string }>;
  empty: string;
}) {
  return (
    <div className="panel overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line">
              {["Rank", "Referrer", "Access", "Revshare earned", "Rev share %", "Qualified", "Paid", "Credits", "Cash"].map((label) => (
                <th key={label} className="eyebrow whitespace-nowrap px-3 py-2.5 font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-[12.5px] text-ink-faint">{empty}</td>
              </tr>
            ) : rows.map((row) => (
              <tr
                key={`${row.rank}-${row.publicName}`}
                className={`border-b border-line last:border-0 ${row.isCurrentUser ? "bg-signal/5" : ""}`}
              >
                <td className="mono px-3 py-3 text-[12.5px] text-ink-faint">#{row.rank}</td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-panel-2 text-[12.5px] font-medium text-signal-lift"
                      aria-hidden
                    >
                      {letter(row.publicName)}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-[13.5px] font-medium text-ink">
                        {row.publicName}{row.isCurrentUser ? " · you" : ""}
                      </div>
                      <div className="mt-0.5 text-[11px] text-ink-faint">{row.qualifiedReferrals} qualified referrals</div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3">
                  <span className={`chip ${row.access === "admitted" ? "tint-pass" : "tint-signal"}`}>
                    {accessLabel(row)}
                  </span>
                </td>
                <td className="mono px-3 py-3 text-[15px] font-semibold text-pass">{money(row.revshareEarnedCents)}</td>
                <td className="px-3 py-3">
                  <span className="chip tint-signal">{row.revsharePercent}%</span>
                </td>
                <td className="mono px-3 py-3 text-[13.5px] text-ink">{row.qualifiedReferrals}</td>
                <td className="mono px-3 py-3 text-[13.5px] font-medium text-sourced">{row.paidReferrals}</td>
                <td className="mono px-3 py-3 text-[13.5px] font-medium text-signal-lift">{money(row.creditEarnedCents)}</td>
                <td className="mono px-3 py-3 text-[13.5px] font-medium text-caution">{money(row.cashEarnedCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
