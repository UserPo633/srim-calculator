import {randomInt} from 'node:crypto';
function weightedPick(list){let sum=list.reduce((a,x)=>a+x.w,0);if(sum<=0)return list[randomInt(list.length)].id;let r=randomInt(1_000_000)/1_000_000*sum;for(const x of list){r-=x.w;if(r<=0)return x.id;}return list[list.length-1].id;}
export async function installRaritySync(ledger){
 const sync=async()=>{ledger._opsRarity=await ledger.settings();};
 await sync();
 ledger.customDraw=()=>{const p=ledger._opsPolicy||{common:[],rare:[],epic:[]},s=ledger._opsRarity;return Array.from({length:3},()=>{const r=randomInt(1_000_000)/10_000,rarity=r<s.commonPct?'common':r<s.commonPct+s.rarePct?'rare':'epic';return weightedPick(p[rarity]);});};
 const original=ledger.adminUpdateSettings.bind(ledger);
 ledger.adminUpdateSettings=async input=>{const out=await original(input);await sync();return out;};
}
