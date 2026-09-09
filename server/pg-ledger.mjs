import pg from 'pg';
import {randomBytes,createHash,randomUUID,randomInt} from 'node:crypto';
import {ServiceError,koreanDay,nextKoreanMidnight} from './ledger.mjs';
const {Pool}=pg;
const digest=value=>createHash('sha256').update(value).digest('hex');
const num=v=>Number(v);
const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));

function validateSettings(input){
  const commonPct=Number(input.commonPct),rarePct=Number(input.rarePct),epicPct=Number(input.epicPct);
  const dailyPacks=Number(input.dailyPacks),welcomeBonus=Number(input.welcomeBonus);
  if(![commonPct,rarePct,epicPct].every(v=>Number.isFinite(v)&&v>=0&&v<=100))throw new ServiceError('확률은 0~100 사이여야 합니다.');
  if(Math.abs(commonPct+rarePct+epicPct-100)>0.0001)throw new ServiceError('카드 확률 합계는 100%여야 합니다.');
  if(!Number.isInteger(dailyPacks)||dailyPacks<0||dailyPacks>100)throw new ServiceError('일일 지급량은 0~100 사이 정수여야 합니다.');
  if(!Number.isInteger(welcomeBonus)||welcomeBonus<0||welcomeBonus>100)throw new ServiceError('첫날 보너스는 0~100 사이 정수여야 합니다.');
  return {commonPct,rarePct,epicPct,dailyPacks,welcomeBonus,issuanceEnabled:Boolean(input.issuanceEnabled)};
}
function settingsFromRow(r){return {commonPct:num(r.common_pct),rarePct:num(r.rare_pct),epicPct:num(r.epic_pct),dailyPacks:num(r.daily_packs),welcomeBonus:num(r.welcome_bonus),issuanceEnabled:Boolean(r.issuance_enabled),updatedAt:num(r.updated_at)};}
function drawCards(settings){
  return Array.from({length:3},()=>{
    const roll=randomInt(1_000_000)/10_000;
    const off=roll<settings.commonPct?1:roll<settings.commonPct+settings.rarePct?2:3;
    const concept=randomInt(32);
    return `E${String(concept*3+off).padStart(3,'0')}`;
  });
}
function isUuid(v){return typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);}
function parseTs(v,label){
  const t=typeof v==='number'?v:Date.parse(v);
  if(!Number.isFinite(t))throw new ServiceError(`${label} 시간을 확인해 주세요.`);
  return t;
}

export class PgLedger{
  constructor(url,{clock=Date.now,draw=null}={}){this.clock=clock;this.customDraw=draw;this.pool=new Pool({connectionString:url,max:5});}
  async init(){
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users(
        subject TEXT PRIMARY KEY,
        first_day TEXT NOT NULL,
        day TEXT NOT NULL,
        daily_used INTEGER NOT NULL DEFAULT 0,
        welcome_used INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS receipts(
        subject TEXT NOT NULL REFERENCES users(subject) ON DELETE CASCADE,
        request_id TEXT NOT NULL,
        id TEXT NOT NULL UNIQUE,
        created_at BIGINT NOT NULL,
        cards JSONB NOT NULL,
        PRIMARY KEY(subject,request_id)
      );
      CREATE TABLE IF NOT EXISTS sessions(
        hash TEXT PRIMARY KEY,
        subject TEXT NOT NULL REFERENCES users(subject) ON DELETE CASCADE,
        expires_at BIGINT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS game_settings(
        id INTEGER PRIMARY KEY CHECK(id=1),
        common_pct NUMERIC(7,4) NOT NULL DEFAULT 70,
        rare_pct NUMERIC(7,4) NOT NULL DEFAULT 25,
        epic_pct NUMERIC(7,4) NOT NULL DEFAULT 5,
        daily_packs INTEGER NOT NULL DEFAULT 1,
        welcome_bonus INTEGER NOT NULL DEFAULT 2,
        issuance_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        updated_at BIGINT NOT NULL
      );
      INSERT INTO game_settings(id,updated_at) VALUES(1,0) ON CONFLICT(id) DO NOTHING;
      CREATE TABLE IF NOT EXISTS events(
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        start_at BIGINT NOT NULL,
        end_at BIGINT NOT NULL,
        bonus_packs INTEGER NOT NULL,
        target_type TEXT NOT NULL CHECK(target_type IN ('all','new_users')),
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS event_usages(
        subject TEXT NOT NULL REFERENCES users(subject) ON DELETE CASCADE,
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        used INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(subject,event_id)
      );
      CREATE TABLE IF NOT EXISTS manual_grants(
        id TEXT PRIMARY KEY,
        subject TEXT NOT NULL REFERENCES users(subject) ON DELETE CASCADE,
        packs INTEGER NOT NULL,
        remaining INTEGER NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        expires_at BIGINT,
        created_at BIGINT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS admin_audit_logs(
        id BIGSERIAL PRIMARY KEY,
        action TEXT NOT NULL,
        detail JSONB NOT NULL,
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS receipts_created_at_idx ON receipts(created_at);
      CREATE INDEX IF NOT EXISTS events_window_idx ON events(enabled,start_at,end_at);
      CREATE INDEX IF NOT EXISTS grants_subject_idx ON manual_grants(subject,created_at);
    `);
  }
  async settings(c=this.pool){const {rows}=await c.query('SELECT * FROM game_settings WHERE id=1');return settingsFromRow(rows[0]);}
  async ensure(c,subject){
    const day=koreanDay(this.clock());
    await c.query('INSERT INTO users(subject,first_day,day) VALUES($1,$2,$2) ON CONFLICT(subject) DO NOTHING',[subject,day]);
    await c.query('UPDATE users SET day=$1,daily_used=0 WHERE subject=$2 AND day<$1',[day,subject]);
    const {rows}=await c.query('SELECT * FROM users WHERE subject=$1',[subject]);
    return rows[0];
  }
  async activeEventState(c,user){
    const now=this.clock(),startDayExpr=`to_char(to_timestamp(e.start_at/1000.0) AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD')`;
    const {rows}=await c.query(`
      SELECT e.*,COALESCE(u.used,0) AS used
      FROM events e
      LEFT JOIN event_usages u ON u.event_id=e.id AND u.subject=$1
      WHERE e.enabled=TRUE AND e.start_at<=$2 AND e.end_at>=$2
        AND (e.target_type='all' OR (e.target_type='new_users' AND $3 >= ${startDayExpr}))
      ORDER BY e.end_at ASC,e.created_at ASC
    `,[user.subject,now,user.first_day]);
    return rows.map(r=>({id:r.id,name:r.name,remaining:Math.max(0,num(r.bonus_packs)-num(r.used)),endAt:num(r.end_at)})).filter(x=>x.remaining>0);
  }
  async snapshot(c,user){
    const now=this.clock(),s=await this.settings(c),events=await this.activeEventState(c,user);
    const {rows:[g]}=await c.query(`SELECT COALESCE(SUM(remaining),0) AS n FROM manual_grants WHERE subject=$1 AND remaining>0 AND (expires_at IS NULL OR expires_at>$2)`,[user.subject,now]);
    const dailyRemaining=Math.max(0,s.dailyPacks-num(user.daily_used));
    const welcomeRemaining=koreanDay(now)===user.first_day?Math.max(0,s.welcomeBonus-num(user.welcome_used)):0;
    const eventRemaining=events.reduce((a,x)=>a+x.remaining,0),grantRemaining=num(g.n);
    return {day:user.day,dailyRemaining,welcomeRemaining,eventRemaining,grantRemaining,total:dailyRemaining+welcomeRemaining+eventRemaining+grantRemaining,nextResetAt:nextKoreanMidnight(now),serverTime:now,adsEnabled:false,adRemaining:0,issuanceEnabled:s.issuanceEnabled,activeEvents:events};
  }
  async quota(subject){const c=await this.pool.connect();try{await c.query('BEGIN');const user=await this.ensure(c,subject);const q=await this.snapshot(c,user);await c.query('COMMIT');return q;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
  async login(subject){const c=await this.pool.connect();try{await c.query('BEGIN');await this.ensure(c,subject);const token=randomBytes(32).toString('base64url'),expiresAt=this.clock()+30*60*1000;await c.query('DELETE FROM sessions WHERE expires_at<=$1',[this.clock()]);await c.query('INSERT INTO sessions(hash,subject,expires_at) VALUES($1,$2,$3)',[digest(token),subject,expiresAt]);await c.query('COMMIT');return {token,expiresAt};}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
  async authenticate(token){if(typeof token!=='string'||token.length>200)throw new ServiceError('토스 로그인이 필요해요.',401);const {rows}=await this.pool.query('SELECT subject FROM sessions WHERE hash=$1 AND expires_at>$2',[digest(token),this.clock()]);if(!rows[0])throw new ServiceError('이용권을 다시 확인해 주세요.',401);return rows[0].subject;}
  async reserve(subject,requestId){
    if(typeof requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))throw new ServiceError('요청 번호를 확인해 주세요.');
    const c=await this.pool.connect();
    try{
      await c.query('BEGIN');await this.ensure(c,subject);
      let {rows:[user]}=await c.query('SELECT * FROM users WHERE subject=$1 FOR UPDATE',[subject]);
      const old=await c.query('SELECT * FROM receipts WHERE subject=$1 AND request_id=$2',[subject,requestId]);
      if(old.rows[0]){const q=await this.snapshot(c,user);await c.query('COMMIT');const x=old.rows[0];return {receipt:{id:x.id,requestId,createdAt:num(x.created_at),cardNumbers:x.cards},quota:q,replayed:true};}
      let q=await this.snapshot(c,user);if(!q.issuanceEnabled)throw new ServiceError('현재 카드팩 발급이 잠시 중지됐어요.',503);if(q.total<=0)throw new ServiceError('오늘 이용권을 모두 사용했어요.',429);
      const s=await this.settings(c),cardNumbers=this.customDraw?this.customDraw():drawCards(s);
      if(!Array.isArray(cardNumbers)||cardNumbers.length!==3||cardNumbers.some(id=>!/^E0(?:0[1-9]|[1-8][0-9]|9[0-6])$/.test(id)))throw new ServiceError('카드팩 생성에 실패했어요. 이용권은 차감되지 않았어요.',500);
      const receipt={id:randomUUID(),requestId,createdAt:this.clock(),cardNumbers};
      await c.query('INSERT INTO receipts(subject,request_id,id,created_at,cards) VALUES($1,$2,$3,$4,$5::jsonb)',[subject,requestId,receipt.id,receipt.createdAt,JSON.stringify(cardNumbers)]);
      if(q.welcomeRemaining>0)await c.query('UPDATE users SET welcome_used=welcome_used+1 WHERE subject=$1',[subject]);
      else if(q.dailyRemaining>0)await c.query('UPDATE users SET daily_used=daily_used+1 WHERE subject=$1',[subject]);
      else if(q.eventRemaining>0){
        const events=await this.activeEventState(c,user),e=events[0];
        await c.query(`INSERT INTO event_usages(subject,event_id,used) VALUES($1,$2,1) ON CONFLICT(subject,event_id) DO UPDATE SET used=event_usages.used+1`,[subject,e.id]);
      }else{
        const {rows:[g]}=await c.query(`SELECT id FROM manual_grants WHERE subject=$1 AND remaining>0 AND (expires_at IS NULL OR expires_at>$2) ORDER BY COALESCE(expires_at,9223372036854775807),created_at LIMIT 1 FOR UPDATE`,[subject,this.clock()]);
        if(!g)throw new ServiceError('이용권 상태가 변경됐어요. 다시 시도해 주세요.',409);
        await c.query('UPDATE manual_grants SET remaining=remaining-1 WHERE id=$1',[g.id]);
      }
      ({rows:[user]}=await c.query('SELECT * FROM users WHERE subject=$1',[subject]));q=await this.snapshot(c,user);await c.query('COMMIT');return {receipt,quota:q,replayed:false};
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }
  async unlink(subject){await this.pool.query('DELETE FROM users WHERE subject=$1',[subject]);}
  async audit(c,action,detail){await c.query('INSERT INTO admin_audit_logs(action,detail,created_at) VALUES($1,$2::jsonb,$3)',[action,JSON.stringify(detail),this.clock()]);}
  async adminDashboard(){
    const now=this.clock(),todayStart=Date.parse(koreanDay(now)+'T00:00:00+09:00');
    const [settings,users,packs,active,rarities]=await Promise.all([
      this.settings(),
      this.pool.query('SELECT COUNT(*)::int AS n FROM users'),
      this.pool.query('SELECT COUNT(*)::int AS packs,COUNT(DISTINCT subject)::int AS active_users FROM receipts WHERE created_at>=$1',[todayStart]),
      this.pool.query('SELECT COUNT(*)::int AS n FROM events WHERE enabled=TRUE AND start_at<=$1 AND end_at>=$1',[now]),
      this.pool.query(`SELECT CASE WHEN ((substring(card from 2)::int)%3)=1 THEN 'common' WHEN ((substring(card from 2)::int)%3)=2 THEN 'rare' ELSE 'epic' END AS rarity,COUNT(*)::int AS n FROM receipts r,CROSS JOIN LATERAL jsonb_array_elements_text(r.cards) card WHERE r.created_at>=$1 GROUP BY 1`,[todayStart])
    ]);
    const rarity={common:0,rare:0,epic:0};for(const r of rarities.rows)rarity[r.rarity]=num(r.n);
    return {settings,totalUsers:num(users.rows[0].n),todayPacks:num(packs.rows[0].packs),todayActiveUsers:num(packs.rows[0].active_users),activeEvents:num(active.rows[0].n),todayRarity:rarity,serverTime:now};
  }
  async adminUpdateSettings(input){
    const v=validateSettings(input),c=await this.pool.connect();try{await c.query('BEGIN');await c.query(`UPDATE game_settings SET common_pct=$1,rare_pct=$2,epic_pct=$3,daily_packs=$4,welcome_bonus=$5,issuance_enabled=$6,updated_at=$7 WHERE id=1`,[v.commonPct,v.rarePct,v.epicPct,v.dailyPacks,v.welcomeBonus,v.issuanceEnabled,this.clock()]);await this.audit(c,'settings.update',v);await c.query('COMMIT');return this.settings();}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }
  async adminListEvents(){const {rows}=await this.pool.query('SELECT * FROM events ORDER BY start_at DESC,created_at DESC LIMIT 100');return rows.map(r=>({id:r.id,name:r.name,startAt:num(r.start_at),endAt:num(r.end_at),bonusPacks:num(r.bonus_packs),targetType:r.target_type,enabled:Boolean(r.enabled),createdAt:num(r.created_at)}));}
  async adminCreateEvent(input){
    const name=String(input.name??'').trim();if(!name||name.length>80)throw new ServiceError('이벤트 이름을 확인해 주세요.');
    const startAt=parseTs(input.startAt,'시작'),endAt=parseTs(input.endAt,'종료'),bonusPacks=Number(input.bonusPacks),targetType=input.targetType;
    if(endAt<=startAt)throw new ServiceError('종료 시간은 시작 시간보다 뒤여야 합니다.');if(!Number.isInteger(bonusPacks)||bonusPacks<1||bonusPacks>100)throw new ServiceError('이벤트 지급량은 1~100팩이어야 합니다.');if(!['all','new_users'].includes(targetType))throw new ServiceError('이벤트 대상을 확인해 주세요.');
    const id=randomUUID(),now=this.clock(),c=await this.pool.connect();try{await c.query('BEGIN');await c.query('INSERT INTO events(id,name,start_at,end_at,bonus_packs,target_type,enabled,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,TRUE,$7,$7)',[id,name,startAt,endAt,bonusPacks,targetType,now]);await this.audit(c,'event.create',{id,name,startAt,endAt,bonusPacks,targetType});await c.query('COMMIT');return {id};}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }
  async adminSetEventEnabled(id,enabled){if(!isUuid(id))throw new ServiceError('이벤트 ID를 확인해 주세요.');const c=await this.pool.connect();try{await c.query('BEGIN');const r=await c.query('UPDATE events SET enabled=$1,updated_at=$2 WHERE id=$3 RETURNING id',[Boolean(enabled),this.clock(),id]);if(!r.rows[0])throw new ServiceError('이벤트를 찾지 못했어요.',404);await this.audit(c,'event.toggle',{id,enabled:Boolean(enabled)});await c.query('COMMIT');return {ok:true};}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
  async adminGrant(input){
    const subject=String(input.subject??'').trim(),packs=Number(input.packs),reason=String(input.reason??'').trim().slice(0,200),expiresAt=input.expiresAt?parseTs(input.expiresAt,'만료'):null;
    if(!subject||subject.length>200)throw new ServiceError('accountId를 확인해 주세요.');if(!Number.isInteger(packs)||packs<1||packs>100)throw new ServiceError('지급량은 1~100팩이어야 합니다.');
    const c=await this.pool.connect();try{await c.query('BEGIN');const u=await c.query('SELECT 1 FROM users WHERE subject=$1',[subject]);if(!u.rows[0])throw new ServiceError('해당 accountId 사용자를 찾지 못했어요.',404);const id=randomUUID();await c.query('INSERT INTO manual_grants(id,subject,packs,remaining,reason,expires_at,created_at) VALUES($1,$2,$3,$3,$4,$5,$6)',[id,subject,packs,reason,expiresAt,this.clock()]);await this.audit(c,'grant.create',{id,subject,packs,reason,expiresAt});await c.query('COMMIT');return {id};}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }
  async adminRecentGrants(){const {rows}=await this.pool.query('SELECT * FROM manual_grants ORDER BY created_at DESC LIMIT 50');return rows.map(r=>({id:r.id,subject:r.subject,packs:num(r.packs),remaining:num(r.remaining),reason:r.reason,expiresAt:r.expires_at===null?null:num(r.expires_at),createdAt:num(r.created_at)}));}
  async adminAudit(){const {rows}=await this.pool.query('SELECT * FROM admin_audit_logs ORDER BY id DESC LIMIT 50');return rows.map(r=>({id:num(r.id),action:r.action,detail:r.detail,createdAt:num(r.created_at)}));}
  async adminSimulate(n=100000){n=clamp(Math.floor(Number(n)||100000),1000,200000);const s=await this.settings(),counts={common:0,rare:0,epic:0};for(let i=0;i<n;i++){const roll=randomInt(1_000_000)/10_000;if(roll<s.commonPct)counts.common++;else if(roll<s.commonPct+s.rarePct)counts.rare++;else counts.epic++;}return {n,settings:s,counts,percent:{common:counts.common/n*100,rare:counts.rare/n*100,epic:counts.epic/n*100}};}
  async close(){await this.pool.end();}
}
