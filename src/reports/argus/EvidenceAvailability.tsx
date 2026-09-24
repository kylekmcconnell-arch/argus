import type { ReportView } from "./view";
import { useArgusReport } from "./context";
/** Coverage is a collection fact, never an alternate safety score. */
export function EvidenceAvailability({ view }: { view: Partial<Pick<ReportView, "people" | "market">> }) {
  const report = useArgusReport();
  const people = view.people?.cards ?? [];
  const holders = view.market?.holderIntelligence;
  if (!people.length && !holders) return null;
  const linked = people.filter(person => person.contacts.x || person.contacts.linkedin).length;
  const read = people.filter(person => person.sourceCoverage?.some(source => ["x", "linkedin"].includes(source.platform) && source.access === "Read successfully")).length;
  return <section className="panel space-top" aria-label="Evidence available for this decision">
    <div className="section-top"><h2>Evidence available for this decision</h2></div>
    <p>Coverage describes what was collected. It does not establish safety, identity or a successful track record.</p>
    {people.length > 0 && <div className="signal-row"><div><strong>{linked}/{people.length} people have a recorded X or LinkedIn link</strong><p>{read}/{people.length} have a successful profile-read receipt. Profile metadata does not establish complete employment or post history.</p><button type="button" className="textbtn" onClick={() => report.goTo("people")}>Review source access and investigate backgrounds →</button></div></div>}
    {holders && <div className="signal-row"><div><strong>{holders.examined}/25 holder addresses examined · {holders.status}</strong><p>{holders.matched} match the saved registry. {holders.ranking === "ranked-addresses" ? "Ranked addresses" : "Observed sample; not a global top-25 ranking"}. Captured {holders.capturedAt}. A registry match is historical attribution, not proof of current coordination.</p><button type="button" className="textbtn" onClick={() => report.goTo("market")}>Inspect holder identities and comparable observations →</button></div></div>}
  </section>;
}
