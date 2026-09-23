# Launch provenance evidence — issue #525

Copyable vanity suffixes, quote-token symbols and trading-venue labels now produce candidate leads. They no longer establish a launch origin, creator reward policy or protected liquidity. A server-observed creator/factory/protocol announcement or token-specific pump.fun record can establish venue attribution and takes precedence over a conflicting client fingerprint. An unrecognized DEX listing remains unknown; it is not automatically called a fair launch.

Even confirmed factory identity does not verify the ownership or withdrawal rights of the audited pool. Generic venue custody mechanics remain explanatory context, but they no longer supply a protected-LP override. Existing independently collected pool-lock evidence remains in the tokenomics pipeline. Curve state retains its token-specific/provider evidence.

Quote-asset descriptions no longer claim a price floor. A stablecoin quote is not a redemption guarantee; a volatile quote introduces an additional price dependency. Creator fee denomination remains a note, and observed claim/sale conduct remains visible on confirmed venues.

Validation: full quality battery passed 5,270 tests plus one expected failure, 7/7 canaries, 21/21 calibration cases and all type checks. Thirty focused provenance/venue tests also passed after the quote wording update. Production build regenerated the collector. Adversarial cases include suffix-only matches, conflicting factory attribution, unsupported chains, provider failure and confirmed venues without pool-custody evidence.

Remaining: attach transaction/block/provider receipts to each server attribution, independently identify each live pool position/locker and withdrawal permissions, and extend the launch-universe index. This correction does not claim those investigations ran. Rollback is a code revert; saved reports are not rewritten or rescored.
