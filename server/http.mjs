import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {ServiceError} from './ledger.mjs';
import {adminPage} from './admin-page.mjs';

async function jsonBody(req){
  let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>16384)throw new ServiceError('요청이 너무 커요.',413);}
  try{return JSON.parse(text||'{}');}catch{throw new ServiceError('요청 형식을 확인해 주세요.');}
}
function safeEqual(a,b){const x=Buffer.from(String(a??'')),y=Buffer.from(String(b??''));return x.length===y.length&&x.length>0&&timingSafeEqual(x,y);}
function adminAuthorized(req,username,password){
  const m=/^Basic (.+)$/.exec(req.headers.authorization??'');if(!m)return false;
  try{const s=Buffer.from(m[1],'base64').toString('utf8'),i=s.indexOf(':');if(i<0)return false;return safeEqual(s.slice(0,i),username)&&safeEqual(s.slice(i+1),password);}catch{return false;}
}
function unauthorized(res){res.writeHead(401,{'WWW-Authenticate':'Basic realm="Holocut Admin", charset="UTF-8"','Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({error:'관리자 인증이 필요합니다.'}));}
export function createApi({ledger,verify,subjectFor,origins,unlinkAuthorization,adminUsername='admin',adminPassword}){
  const allowed=new Set(origins);if(!allowed.size||allowed.has('*'))throw Error('정확한 CORS 허용 Origin이 필요합니다.');
  const attempts=new Map();
  return createServer(async(req,res)=>{
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer'});res.end(JSON.stringify(data));};
    try{
      const url=new URL(req.url,'http://internal'),path=url.pathname;
      if(path==='/admin'||path==='/admin/'||path.startsWith('/admin/api/')){
        if(!adminPassword)throw new ServiceError('관리자 콘솔이 비활성화되어 있습니다.',404);
        if(!adminAuthorized(req,adminUsername,adminPassword)){unauthorized(res);return;}
        if((path==='/admin'||path==='/admin/')&&req.method==='GET'){
          res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});
          res.end(adminPage());return;
        }
        if(path==='/admin/api/dashboard'&&req.method==='GET'){send(200,await ledger.adminDashboard());return;}
        if(path==='/admin/api/settings'&&req.method==='PUT'){send(200,await ledger.adminUpdateSettings(await jsonBody(req)));return;}
        if(path==='/admin/api/events'&&req.method==='GET'){send(200,await ledger.adminListEvents());return;}
        if(path==='/admin/api/events'&&req.method==='POST'){send(201,await ledger.adminCreateEvent(await jsonBody(req)));return;}
        const em=/^\/admin\/api\/events\/([0-9a-f-]{36})$/i.exec(path);
        if(em&&req.method==='PATCH'){const body=await jsonBody(req);send(200,await ledger.adminSetEventEnabled(em[1],body.enabled));return;}
        if(path==='/admin/api/grants'&&req.method==='GET'){send(200,await ledger.adminRecentGrants());return;}
        if(path==='/admin/api/grants'&&req.method==='POST'){send(201,await ledger.adminGrant(await jsonBody(req)));return;}
        if(path==='/admin/api/audit'&&req.method==='GET'){send(200,await ledger.adminAudit());return;}
        if(path==='/admin/api/simulate'&&req.method==='GET'){send(200,await ledger.adminSimulate(url.searchParams.get('n')));return;}
        throw new ServiceError('관리자 기능을 찾지 못했어요.',404);
      }
      const origin=req.headers.origin;
      if(origin){if(!allowed.has(origin))throw new ServiceError('허용되지 않은 앱 주소예요.',403);res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
      if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization'});res.end();return;}
      if(path==='/health'&&req.method==='GET'){send(200,{ok:true,storage:process.env.DATABASE_URL?'postgres':'sqlite',admin:Boolean(adminPassword)});return;}
      if(path==='/v1/toss/unlink'&&req.method==='POST'){
        const given=Buffer.from(req.headers.authorization??''),expected=Buffer.from(unlinkAuthorization??'');
        if(!expected.length||given.length!==expected.length||!timingSafeEqual(given,expected))throw new ServiceError('인증이 필요해요.',401);
        const body=await jsonBody(req);if(!Number.isSafeInteger(body.userKey)||body.userKey<=0||!['UNLINK','WITHDRAWAL_TERMS','WITHDRAWAL_TOSS'].includes(body.referrer))throw new ServiceError('요청을 확인해 주세요.');
        await ledger.unlink(subjectFor(body.userKey));send(200,{ok:true});return;
      }
      if(path==='/v1/session'&&req.method==='POST'){
        const ip=req.socket.remoteAddress??'unknown',now=Date.now(),old=attempts.get(ip),rate=old&&old.until>now?old:{n:0,until:now+60000};rate.n++;attempts.set(ip,rate);if(attempts.size>5000)attempts.delete(attempts.keys().next().value);if(rate.n>30)throw new ServiceError('잠시 후 다시 로그인해 주세요.',429);
        const subject=await verify(await jsonBody(req));send(200,{...(await ledger.login(subject)),accountId:subject});return;
      }
      const bearer=/^Bearer ([A-Za-z0-9_-]+)$/.exec(req.headers.authorization??''),subject=await ledger.authenticate(bearer?.[1]);
      if(path==='/v1/quota'&&req.method==='GET'){send(200,await ledger.quota(subject));return;}
      if(path==='/v1/packs'&&req.method==='POST'){const body=await jsonBody(req);send(200,await ledger.reserve(subject,body.requestId));return;}
      throw new ServiceError('요청한 기능을 찾지 못했어요.',404);
    }catch(e){console.error(e);send(e instanceof ServiceError?e.status:500,{error:e instanceof ServiceError?e.message:'요청을 처리하지 못했어요. 다시 시도해 주세요.'});}
  });
}
