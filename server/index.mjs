import {mkdirSync} from 'node:fs';import {dirname} from 'node:path';
import {Ledger} from './ledger.mjs';import {PgLedger} from './pg-ledger.mjs';import {makeTossVerifier} from './toss.mjs';import {createApi} from './http.mjs';import {installOps} from './ops-extension.mjs';import {makeOpsRouter} from './ops-router.mjs';
const origins=(process.env.ALLOWED_ORIGINS??'').split(',').filter(Boolean);if(origins.some(s=>!/^https:\/\/[^/]+$/.test(s)))throw Error('CORS Origin은 HTTPS origin이어야 합니다.');
const unlinkAuthorization=process.env.TOSS_UNLINK_AUTHORIZATION;if(!unlinkAuthorization?.startsWith('Basic '))throw Error('연결 해제 콜백 Basic 인증값이 필요합니다.');
const toss=makeTossVerifier({certPem:process.env.TOSS_MTLS_CERT_PEM,keyPem:process.env.TOSS_MTLS_KEY_PEM,certPath:process.env.TOSS_MTLS_CERT,keyPath:process.env.TOSS_MTLS_KEY,subjectSecret:process.env.SUBJECT_SECRET});
let ledger;if(process.env.DATABASE_URL){ledger=new PgLedger(process.env.DATABASE_URL);await ledger.init();await installOps(ledger);console.log('Holocut storage: PostgreSQL + ops');}else{const file=process.env.HOLOCUT_DB_PATH;if(!file)throw Error('DATABASE_URL 또는 HOLOCUT_DB_PATH를 설정하세요.');mkdirSync(dirname(file),{recursive:true});ledger=new Ledger(file);console.warn('Holocut storage: ephemeral SQLite fallback');}
const adminUsername=process.env.ADMIN_USERNAME??'admin',adminPassword=process.env.ADMIN_PASSWORD;
const server=createApi({ledger,...toss,origins,unlinkAuthorization,adminUsername,adminPassword});
if(process.env.DATABASE_URL){const base=server.listeners('request')[0],ops=makeOpsRouter({ledger,adminUsername,adminPassword});server.removeAllListeners('request');server.on('request',async(req,res)=>{if(await ops(req,res))return;base(req,res);});}
server.requestTimeout=15000;server.headersTimeout=10000;server.listen(Number(process.env.PORT??8080),'0.0.0.0',()=>console.log('Holocut pack API ready'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.close(async()=>{await ledger.close();process.exit(0);});});
