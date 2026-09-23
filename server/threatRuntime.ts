import { AsyncLocalStorage } from "node:async_hooks";
import { installThreatNetContext, type ThreatNetContext } from "../src/threat/net";
export * from "../src/threat/serverScan";

const network = new AsyncLocalStorage<ThreatNetContext>();
installThreatNetContext(() => network.getStore());

/** A warm Vercel instance may serve several organizations concurrently. */
export function withThreatNet<T>(context: ThreatNetContext, run: () => Promise<T>): Promise<T> {
  return network.run(context, run);
}
