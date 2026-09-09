import {randomInt,randomUUID} from 'node:crypto';
import {ServiceError} from './ledger.mjs';

const num=v=>Number(v);
export const cardIds=Array.from({length:96},(_,i)=>`E${String(i+1).padStart(3,'0')}`);
export function isCardId(id){return typeof id==='string'&&/^E0(?:0[1-9]|[1-8][0-9]|9[0-6])$/.test(id);}
export function rarityOf(id){const n=Number(id.slice(1));return ['common','rare','epic'][(n-1)%3];}
const rarityPct=(settings,rarity)=>rarity==='common'?settings.commonPct:rarity==='rare'?settings.rarePct:settings.epicPct;
const ts=(v,label)=>{const n=typeof v==='number'?v:Date.parse(v);if(!Number.isFinite(n))throw new ServiceError(`${label} 시간을 확인해 주세요.`);return n;};

export async function initCardOps(pool){
 await pool.query(`
  CREATE TABLE IF NOT EXISTS card_weights(
   card_id TEXT PRIMARY KEY,
   weight NUMERIC(12,4) NOT NULL CHECK(weight>=0 AND weight<=1000),
   updated_at BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS pickup_events(
   id TEXT PRIMARY KEY,
   name TEXT NOT NULL,
   card_id TEXT NOT NULL,
   multiplier NUMERIC(10,4) NOT NULL CHECK(multiplier>0 AND multiplier<=100),
   start_at BIGINT NOT NULL,
   end_at BIGINT NOT NULL,
   enabled BOOLEAN NOT NULL DEFAULT TRUE,
   created_at BIGINT NOT NULL,
   updated_at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS pickup_events_window_idx ON pickup_events(enabled,start_at,end_at);
  CREATE INDEX IF NOT EXISTS pickup_events_card_idx ON pickup_events(card_id);
 `);
}

async function policy(poolOrClient,settings,now){
 const [weights,pickups]=await Promise.all([
  poolOrClient.query('SELECT card_id,weight FROM card_weights'),
  poolOrClient.query('SELECT id,name,card_id,multiplier,end_at FROM pickup_events WHERE enabled=TRUE AND start_at<=$1 AND end_at>=$1',[now])
 ]);
 const wm=new Map(weights.rows.map(r=>[r.card_id,num(r.weight)]));
 const pm=new Map();
 for(const p of pickups.rows){
  const old=pm.get(p.card_id)??{multiplier:1,names:[]};
  old.multiplier=Math.min(1000,old.multiplier*num(p.multiplier));old.names.push(p.name);pm.set(p.card_id,old);
 }
 const cards=cardIds.map(id=>{const rarity=rarityOf(id),baseWeight=wm.get(id)??1,p=pm.get(id)??{multiplier:1,names:[]};return {id,rarity,baseWeight,pickupMultiplier:p.multiplier,effectiveWeight:baseWeight*p.multiplier,pickupNames:p.names};});
 for(const rarity of ['common','rare','epic']){
  const group=cards.filter(x=>x.rarity===rarity),sum=group.reduce((a,x)=>a+x.effectiveWeight,0);
  for(const x of group){const within=sum>0?x.effectiveWeight/sum:1/group.length;x.withinRarityPct=within*100;x.expectedPct=rarityPct(settings,rarity)*within;}
 }
 return cards;
}
function chooseWeighted(group){
 let total=group.reduce((a,x)=>a+x.effectiveWeight,0);
 if(total<=0){return group[randomInt(group.length)].id;}
 let target=(randomInt(1_000_000)/1_000_000)*total;
 for(const x of group){target-=x.effectiveWeight;if(target<=0)return x.id;}
 return group[group.length-1].id;
}
export async function drawWeightedPack(client,settings,now){
 const cards=await policy(client,settings,now),groups={common:[],rare:[],epic:[]};for(const c of cards)groups[c.rarity].push(c);
 return Array.from({length:3},()=>{const roll=randomInt(1_000_000)/10_000,rarity=roll<settings.commonPct?'common':roll<settings.commonPct+settings.rarePct?'rare':'epic';return chooseWeighted(groups[rarity]);});
}
export async function listCards(pool,settings,now){return policy(pool,settings,now);}
export async function updateCardWeight(pool,id,weight,now){
 if(!isCardId(id))throw new ServiceError('카드 ID를 확인해 주세요.');weight=Number(weight);if(!Number.isFinite(weight)||weight<0||weight>1000)throw new ServiceError('카드 가중치는 0~1000 사이여야 합니다.');
 await pool.query('INSERT INTO card_weights(card_id,weight,updated_at) VALUES($1,$2,$3) ON CONFLICT(card_id) DO UPDATE SET weight=EXCLUDED.weight,updated_at=EXCLUDED.updated_at',[id,weight,now]);return {id,weight};
}
export async function listPickups(pool){
 const {rows}=await pool.query('SELECT * FROM pickup_events ORDER BY start_at DESC,created_at DESC LIMIT 100');return rows.map(r=>({id:r.id,name:r.name,cardId:r.card_id,multiplier:num(r.multiplier),startAt:num(r.start_at),endAt:num(r.end_at),enabled:Boolean(r.enabled),createdAt:num(r.created_at)}));
}
export async function createPickup(pool,input,now){
 const name=String(input.name??'').trim(),cardId=String(input.cardId??'').trim().toUpperCase(),multiplier=Number(input.multiplier),startAt=ts(input.startAt,'시작'),endAt=ts(input.endAt,'종료');
 if(!name||name.length>80)throw new ServiceError('픽업 이벤트 이름을 확인해 주세요.');if(!isCardId(cardId))throw new ServiceError('픽업 카드 ID를 확인해 주세요.');if(!Number.isFinite(multiplier)||multiplier<=0||multiplier>100)throw new ServiceError('픽업 배수는 0 초과 100 이하로 설정해 주세요.');if(endAt<=startAt)throw new ServiceError('종료 시간은 시작 시간보다 뒤여야 합니다.');
 const id=randomUUID();await pool.query('INSERT INTO pickup_events(id,name,card_id,multiplier,start_at,end_at,enabled,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,TRUE,$7,$7)',[id,name,cardId,multiplier,startAt,endAt,now]);return {id,name,cardId,multiplier,startAt,endAt};
}
export async function togglePickup(pool,id,enabled,now){const r=await pool.query('UPDATE pickup_events SET enabled=$1,updated_at=$2 WHERE id=$3 RETURNING id',[Boolean(enabled),now,id]);if(!r.rows[0])throw new ServiceError('픽업 이벤트를 찾지 못했어요.',404);return {ok:true};}

export async function searchUsers(pool,q=''){
 q=String(q??'').trim().slice(0,100);const like=`%${q.replace(/[%_]/g,'\\$&')}%`;
 const {rows}=await pool.query(`
  SELECT u.subject,u.first_day,u.day,
   COALESCE(p.packs_opened,0)::int AS packs_opened,COALESCE(p.last_pack_at,0) AS last_pack_at,
   COALESCE(c.total_cards,0)::int AS total_cards,COALESCE(c.unique_cards,0)::int AS unique_cards
  FROM users u
  LEFT JOIN (SELECT subject,COUNT(*) AS packs_opened,MAX(created_at) AS last_pack_at FROM receipts GROUP BY subject) p ON p.subject=u.subject
  LEFT JOIN (SELECT r.subject,COUNT(*) AS total_cards,COUNT(DISTINCT card) AS unique_cards FROM receipts r CROSS JOIN LATERAL jsonb_array_elements_text(r.cards) card GROUP BY r.subject) c ON c.subject=u.subject
  WHERE ($1='' OR u.subject ILIKE $2 ESCAPE '\\')
  ORDER BY COALESCE(p.last_pack_at,0) DESC,u.subject LIMIT 50
 `,[q,like]);
 return rows.map(r=>({subject:r.subject,firstDay:r.first_day,day:r.day,packsOpened:num(r.packs_opened),lastPackAt:num(r.last_pack_at),totalCards:num(r.total_cards),uniqueCards:num(r.unique_cards)}));
}
export async function userDetail(pool,subject,quotaFn){
 subject=String(subject??'').trim();if(!subject||subject.length>200)throw new ServiceError('accountId를 확인해 주세요.');const {rows:[u]}=await pool.query('SELECT * FROM users WHERE subject=$1',[subject]);if(!u)throw new ServiceError('사용자를 찾지 못했어요.',404);
 const [cards,recent,quota]=await Promise.all([
  pool.query(`SELECT card,COUNT(*)::int AS count,MAX(r.created_at) AS last_at FROM receipts r CROSS JOIN LATERAL jsonb_array_elements_text(r.cards) card WHERE r.subject=$1 GROUP BY card ORDER BY card`,[subject]),
  pool.query('SELECT id,request_id,created_at,cards FROM receipts WHERE subject=$1 ORDER BY created_at DESC LIMIT 20',[subject]),
  quotaFn(subject)
 ]);
 const inventory=cards.rows.map(r=>({cardId:r.card,count:num(r.count),rarity:rarityOf(r.card),lastAt:num(r.last_at)}));
 return {subject,firstDay:u.first_day,day:u.day,quota,totalCards:inventory.reduce((a,x)=>a+x.count,0),uniqueCards:inventory.length,inventory,recentPacks:recent.rows.map(r=>({id:r.id,requestId:r.request_id,createdAt:num(r.created_at),cards:r.cards}))};
}
