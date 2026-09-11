import { expect, it } from 'vitest';
import { launchFindingDetail } from './launchEvidencePresentation';
it('corrects known legacy overclaims without changing unrelated saved wording', () => {
  expect(launchFindingDetail("The token's immutable reference matches.")).toContain('reported factory address');
  expect(launchFindingDetail('This proves those observed exits settled, not that every wallet or future trade will succeed.')).toContain('Only the referenced transaction receipt was checked');
  expect(launchFindingDetail('No successful receipt was found.')).toBe('No successful receipt was found.');
});
