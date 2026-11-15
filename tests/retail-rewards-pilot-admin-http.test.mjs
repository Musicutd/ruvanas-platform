import test from 'node:test';
import assert from 'node:assert/strict';
import { createPilotAdminHttp } from '../lib/retail-rewards/pilot-admin-http.mjs';
import { safePilotAdminResult } from '../lib/retail-rewards/pilot-admin-dtos.mjs';
const env={NODE_ENV:'production',RUVANAS_PUBLIC_URL:'https://rewards.example.invalid',RUVANAS_RETAIL_REWARDS_ENABLED:'true',RUVANAS_RETAIL_REWARDS_PILOT_ADMIN_ENABLED:'true',RUVANAS_RETAIL_REWARDS_PILOT_ORGANISATION_IDS:'["org-one"]'};
const input={organisationId:'org-one',email:'shopper@example.invalid',displayName:'Pilot shopper',expiresAt:'2026-11-20T12:00:00.000Z',confirm:true};
const invited={ok:true,shopperId:'shopper-one',invitationToken:'a'.repeat(64),invitationExpiresAt:'2026-11-15T12:00:00.000Z',membershipExpiresAt:'2026-11-20T12:00:00.000Z'};
const organisations={ok:true,organisations:[{id:'org-one',name:'Synthetic shop'}],checkedAt:'2026-11-14T12:00:00.000Z'};
function setup(overrides={}){
  const seen=[];
  const http=createPilotAdminHttp({env,authorize:async organisationId=>{seen.push(['auth',organisationId]);return {ok:true,userId:'super-admin'};},
    rateLimit:async v=>{seen.push(v.principal?'principal':'ip');return {allowed:true};},
    loadService:async()=>{seen.push('load');return {invite:async v=>{seen.push(v);return invited;},organisations:async()=>organisations};},...overrides});
  return {http,seen};
}
function req(body=input,{method='POST',headers={},query='',raw}={}){return new Request('https://rewards.example.invalid/api/admin/retail-rewards/pilot/invite'+query,{method,
  headers:{origin:env.RUVANAS_PUBLIC_URL,'content-type':'application/json',...headers},...(method==='GET'?{}:{body:raw??JSON.stringify(body)})});}
test('pilot HTTP default off and malformed policy use no authentication, limits or database',async()=>{
  for(const flags of [{},{...env,RUVANAS_RETAIL_REWARDS_ENABLED:'false'},{...env,RUVANAS_RETAIL_REWARDS_PILOT_ADMIN_ENABLED:'TRUE'},{...env,RUVANAS_RETAIL_REWARDS_PILOT_ORGANISATION_IDS:'[]'}]){
    const {http,seen}=setup({env:flags});assert.equal((await http.run(req(),'invite')).status,403);assert.deepEqual(seen,[]);
  }
});
test('pilot transport blocks foreign/missing origin, query tokens, cross-site and wrong methods',async()=>{
  for(const options of [{method:'GET'},{headers:{origin:'https://foreign.invalid'}},{headers:{origin:''}},{headers:{origin:'null'}},{headers:{'sec-fetch-site':'cross-site'}},{query:'?token=secret'}]){
    const {http,seen}=setup();assert.ok((await http.run(req(input,options),'invite')).status>=400);assert.deepEqual(seen,[]);
  }
  for(const operation of ['constructor','__proto__','toString','unknown']){const {http,seen}=setup();assert.equal((await http.run(req(),operation)).status,400);assert.deepEqual(seen,[]);}
});
test('pilot JSON rejects privilege injection, oversized chunks, invalid UTF8 and malformed content',async()=>{
  const requests=[req({...input,role:'SUPER_ADMIN'}),req({...input,confirm:false}),req(input,{headers:{'content-type':'text/plain'}}),req(input,{raw:'{'}),req(input,{raw:' '.repeat(8193)}),req(input,{headers:{'content-length':'9000'}}),req(input,{raw:new Uint8Array([255,255])})];
  for(const request of requests){const {http,seen}=setup();assert.equal((await http.run(request,'invite')).status,400);assert.ok(!seen.includes('load'));}
  const {http}=setup();assert.equal((await http.run(req(null,{method:'GET',query:'?organisationId=org-one&organisationId=org-two'}),'overview')).status,400);
});
test('pilot invitation response is one-time secret DTO with no-store and no-referrer',async()=>{
  const {http,seen}=setup(),response=await http.run(req(),'invite');assert.equal(response.status,200);assert.deepEqual(await response.json(),invited);
  assert.match(response.headers.get('cache-control'),/private.*no-store/);assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.equal(response.headers.get('vary'),'Cookie');
  assert.deepEqual(seen,['ip',['auth','org-one'],'principal','load',input]);
});
test('pilot read list uses no request body or organisation override',async()=>{
  const {http}=setup();const r=await http.run(req(null,{method:'GET'}),'organisations');assert.equal(r.status,200);assert.deepEqual(await r.json(),organisations);
  assert.equal((await http.run(req(null,{method:'GET',query:'?organisationId=org-two'}),'organisations')).status,400);
});
test('pilot auth, rate limits and service errors are sanitised',async()=>{
  const {http,seen}=setup({authorize:async()=>({ok:false,code:'FORBIDDEN',password:'secret-value'})});
  const r=await http.run(req(),'invite');assert.equal(r.status,403);assert.ok(!(await r.text()).includes('secret-value'));assert.ok(!seen.includes('load'));
  for(const when of ['ip','principal']){const {http,seen}=setup({rateLimit:async({principal})=>({allowed:when==='ip'?false:!principal,retryAfterSeconds:3.1})});const r=await http.run(req(),'invite');assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'4');assert.ok(!seen.includes('load'));}
  for(const loadService of [async()=>{throw Error('private-connection-secret');},async()=>({invite:async()=>({...invited,emailCanonical:'private@example.invalid'})})]){
    const {http}=setup({loadService});const r=await http.run(req(),'invite');assert.equal(r.status,503);assert.ok(!(await r.text()).includes('private-'));
  }
});
test('pilot DTOs reject audit/private fields and raw invitation from read endpoints',()=>{
  assert.equal(safePilotAdminResult('organisations',{...organisations,token:invited.invitationToken}),null);
  assert.equal(safePilotAdminResult('invite',{...invited,invitationExpiresAt:'2026-12-01T00:00:00.000Z'}),null);
  assert.equal(safePilotAdminResult('revoke',{ok:true,shopperId:'shopper-one',invitationToken:invited.invitationToken}),null);
  assert.equal(safePilotAdminResult('constructor',{}),null);
});
