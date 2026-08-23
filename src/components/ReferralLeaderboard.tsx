import type { LeaderboardRow } from "../lib/growth";
import { profilePhotoForName } from "../lib/profilePhotos";
import { Avatar } from "./Avatar";

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function money(cents: number): string {
  return USD.format(Math.max(0, cents) / 100);
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
  bonusPerQualifiedReferral = 2,
}: {
  rows: Array<Omit<LeaderboardRow, "code"> & { code?: string }>;
  empty: string;
  bonusPerQualifiedReferral?: number;
}) {
  return (
    <div className="panel overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line">
              {["Rank", "Referrer", "Qualified", "Investigation credits", "Cash earned", "Access", "Referral code"].map((label) => (
                <th key={label} className="eyebrow whitespace-nowrap px-3 py-2.5 font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-[12.5px] text-ink-faint">{empty}</td>
              </tr>
            ) : rows.map((row) => (
              <tr
                key={`${row.rank}-${row.publicName}`}
                className={`border-b border-line last:border-0 ${row.isCurrentUser ? "bg-signal/5" : ""}`}
              >
                <td className="mono px-3 py-3 text-[12.5px] text-ink-faint">#{row.rank}</td>
                <td className="px-3 py-4">
                  <div className="flex items-center gap-2.5">
                    <Avatar
                      src={profilePhotoForName(row.publicName)}
                      letter={letter(row.publicName)}
                      size={40}
                      rounded="rounded-full"
                      letterClass="text-[12.5px] font-medium"
                    />
                    <div className="min-w-0">
                      <div className="truncate text-[13.5px] font-medium text-ink">
                        {row.publicName}{row.isCurrentUser ? " · you" : ""}
                      </div>
                      <div className="mt-0.5 text-[11px] text-ink-faint">{row.qualifiedReferrals} qualified referrals</div>
                    </div>
                  </div>
                </td>
                <td className="mono px-3 py-3 text-[13.5px] text-ink">{row.qualifiedReferrals}</td>
                <td className="px-3 py-4">
                  <div className="mono text-[15px] font-semibold text-pass">+{row.qualifiedReferrals * bonusPerQualifiedReferral}</div>
                  {row.creditEarnedCents > 0 && <div className="mt-1 text-[10.5px] text-ink-faint">{money(row.creditEarnedCents)} reward value</div>}
                </td>
                <td className="px-3 py-4">
                  <div className="mono text-[15px] font-semibold text-ink">{money(row.cashEarnedCents)}</div>
                  <div className="mt-1 text-[10.5px] text-ink-faint">{row.paidReferrals} paid {row.paidReferrals === 1 ? "referral" : "referrals"}</div>
                </td>
                <td className="px-3 py-3">
                  <span className={`chip ${row.access === "admitted" ? "tint-pass" : "tint-signal"}`}>
                    {accessLabel(row)}
                  </span>
                </td>
                <td className="mono px-3 py-3 text-[12.5px] text-ink-dim">••••{row.codeTail ?? row.code?.slice(-4) ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
