// Synthetic control-flow probe only. No browser launch or performance measurement.
import { registerHooks } from 'node:module';
const source = `
const mode = process.env.PROBE_MODE || 'valid';
let pages = 0;
export const chromium = { async launch() {
 if(mode==='launch') throw new Error('SYNTHETIC launch failure');
 return {
 version() { return 'SYNTHETIC-NO-BROWSER'; },
 async close() { if(mode==='browser-close') throw new Error('SYNTHETIC browser.close'); },
 async newPage() {
   pages++;
   if(mode==='new-page') throw new Error('SYNTHETIC newPage');
   let timing=0, heap=0;
   return {
    async goto(){}, async fill(){}, async waitForTimeout(){},
    async close(){if(mode==='page-close')throw new Error('SYNTHETIC page.close');},
    async evaluate(fn,arg){
     if(Array.isArray(arg)) { timing++; if(mode==='partial-timing'&&timing===2)throw new Error('SYNTHETIC second timing'); return 5; }
     if(String(fn).includes('performance.memory')||String(fn).includes('usedJSHeapSize')) { heap++; if(mode==='destroy-memory'&&heap===3)throw new Error('SYNTHETIC after destroy'); if(mode==='partial-memory'&&heap===4)throw new Error('SYNTHETIC second memory'); if(mode==='no-memory')return -1; return [100,102,101][(heap-1)%3]; }
    }
   };
 }
 };
}};
`;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'playwright')
      return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true };
    return next(specifier, context);
  },
});
