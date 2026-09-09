import {mkdirSync} from 'node:fs';import {dirname} from 'node:path';
import {Ledger} from './ledger.mjs';import {makeTossVerifier} from './toss.mjs';import {createApi} from './http.mjs';
const file=process.env.HOLOCUT_DB_PATH;if(!file)throw Error('영구 볼륨의 HOLOCUT_DB_PATH를 설정하세요.');
const origins=(process.env.ALLOWED_ORIGINS??'').split(',').filter(Boolean);if(origins.some(s=>!/^https:\/\/[^/]+$/.test(s)))throw Error('CORS Origin은 HTTPS origin이어야 합니다.');
const unlinkAuthorization=process.env.TOSS_UNLINK_AUTHORIZATION;if(!unlinkAuthorization?.startsWith('Basic '))throw Error('연결 해제 콜백 Basic 인증값이 필요합니다.');
const toss=makeTossVerifier({certPem:process.env.TOSS_MTLS_CERT_PEM,keyPem:process.env.TOSS_MTLS_KEY_PEM,certPath:process.env.TOSS_MTLS_CERT,keyPath:process.env.TOSS_MTLS_KEY,subjectSecret:process.env.SUBJECT_SECRET});
mkdirSync(dirname(file),{recursive:true});const ledger=new Ledger(file);const server=createApi({ledger,...toss,origins,unlinkAuthorization});
server.requestTimeout=15000;server.headersTimeout=10000;server.listen(Number(process.env.PORT??8080),'0.0.0.0',()=>console.log('Holocut pack API ready'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.close(()=>{ledger.close();process.exit(0);});});
