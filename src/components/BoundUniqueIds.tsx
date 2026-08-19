import { ProvenanceTag } from "./ProvenanceTag";
import { uniqueIdHeading, type TokenUniqueIdRow } from "../lib/tokenNativeSpine";

/** Bound launched-product unique-ids. Labels and values are recorded only. */
export function BoundUniqueIds({
  rows,
  id = "token-unique-ids",
}: {
  rows: TokenUniqueIdRow[];
  id?: string;
}) {
  if (!rows.length) return null;
  return (
    <section id={id} className="af-doc mt-8 scroll-mt-28" aria-label="Bound unique-ids">
      <p className="af-sec-label">Bound unique-ids</p>
      <h2 className="af-h2 mt-3">{uniqueIdHeading(rows.length)}</h2>
      <dl className="af-kv">
        {rows.map((row) => (
          <div key={row.kind} className="af-kv-row">
            <dt className="af-kv-k">{row.label}</dt>
            <dd className="af-kv-v flex min-w-0 flex-col items-end gap-1">
              {row.href ? (
                <a href={row.href} target="_blank" rel="noreferrer" className="link-ext break-all">
                  {row.value}
                </a>
              ) : (
                <span className="break-all">{row.value}</span>
              )}
              <ProvenanceTag state={row.provenance} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
