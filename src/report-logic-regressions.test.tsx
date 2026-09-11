import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { analyzeContent } from './collect/recon';
import { scoreProject } from './collect/projectverdict';
import { normalizeSubjectRef } from './lib/subjectRef';
import { KyleIntelligenceDecisionCanvas } from './reports/kyle/KyleIntelligenceDecisionCanvas';
const recon = (content: string) => analyzeContent({url:'https://example.com',status:'rendered',content,title:'Example',stages:[],coverageNote:'Retrieved'});
const props = { scoreLabel:"Score",checkScopeLabel:"Checks", subjectName:'Example',verdictLabel:'PASS',score:90,favorable:true,supports:[],concerns:[],nextSteps:[],verified:[],coveragePercent:100,successful:6,applicable:6,evidenceHref:'#evidence' as const,methodologyHref:'#method' as const };
describe('Report evidence accuracy regressions',()=>{
 it('does not penalize a negated promise',()=>{const r=scoreProject(recon('We build software. Returns are not guaranteed. Investing is not risk-free.'));expect(r.capApplied).not.toBe('manipulation_language');});
 it('keeps a numeric claim unverified',()=>{const r=scoreProject(recon('We build software serving 100,000 users.'));expect(r.hype.fabricatedMetrics).toEqual([]);expect(r.hype.unverifiedMetrics).toContain('100,000 users');expect(r.reasons.some(x=>x.tone==='bad')).toBe(false);});
 it('keeps absent citation counts unknown',()=>{const html=renderToStaticMarkup(<KyleIntelligenceDecisionCanvas {...props} composition={[{axis:'T1',label:'Liquidity',score:19,weight:24,rationale:'Measured pool liquidity'}]}/>);expect(html).toContain('saved supporting references');expect(html).toContain('Not recorded');});
 it('does not upgrade support counts to verified facts',()=>{const html=renderToStaticMarkup(<KyleIntelligenceDecisionCanvas {...props} successful={5} nextSteps={[{label:'Verify identity'}]} composition={[{axis:'F1',label:'Identity',score:3,weight:20,rationale:'Self-claimed name only',supportCount:1}]}/>);expect(html).not.toContain('strongest verified');expect(html).toContain('Identity has the most recorded supporting evidence');});
 it('routes founder identity questions to identity',()=>{const html=renderToStaticMarkup(<KyleIntelligenceDecisionCanvas {...props} successful={5} nextSteps={[{label:'Audit the founder identity'}]}/>);expect(html).toContain('independent team and identity confirmation');});
 it('preserves chain-prefixed base58',()=>{const mint='So11111111111111111111111111111111111111112';expect(normalizeSubjectRef(mint)).toBe(mint);expect(normalizeSubjectRef('solana:'+mint)).toBe('solana:'+mint);});
});
