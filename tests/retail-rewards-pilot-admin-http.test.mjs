import test from 'node:test';
import assert from 'node:assert/strict';
import { createPilotAdminHttp } from '../lib/retail-rewards/pilot-admin-http.mjs';
import { safePilotAdminResult } from '../lib/retail-rewards/pilot-admin-dtos.mjs';
import { pilotPreviewRoute } from '../lib/retail-rewards/pilot-preview-routes.mjs';
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

const newOperations = {
  invitePrepared: { body: { organisationId:'org-one', shopperId:'shopper-one', email:'shopper@example.invalid', authVersion:1, preparedAt:'2026-11-14T10:00:00.000Z', expiresAt:input.expiresAt, confirm:true }, result:invited },
  activateLocation: { body: { organisationId:'org-one', locationId:'shop-one', confirm:true }, result:{ok:true,locationId:'shop-one',status:'ACTIVE'} }
};
test('new pilot mutations remain off without any authentication, rate-limit or service access',async()=>{
  for (const [operation,{body}] of Object.entries(newOperations)) {
    const {http,seen}=setup({env:{...env,RUVANAS_RETAIL_REWARDS_ENABLED:'false'}});
    assert.equal((await http.run(req(body),operation)).status,403);assert.deepEqual(seen,[]);
  }
});
test('prepared identity and location operations reject method/origin/field injection before service',async()=>{
  for (const [operation,{body}] of Object.entries(newOperations)) {
    for(const [value,options] of [[body,{method:'GET'}],[body,{headers:{origin:'https://foreign.invalid'}}],[{...body,channelId:'forged'},{}],[{...body,confirm:false},{}],[body,{query:'?token=forged'}]]) {
      const {http,seen}=setup();assert.ok((await http.run(req(value,options),operation)).status>=400);assert.ok(!seen.includes('load'));
    }
  }
});
test('new mutations pass only the strict reviewed input and return protected exact DTOs',async()=>{
  for(const [operation,{body,result}] of Object.entries(newOperations)) {
    let received;
    const {http}=setup({loadService:async()=>({[operation]:async value=>{received=value;return result;}})});
    const response=await http.run(req(body),operation);assert.equal(response.status,200);assert.deepEqual(received,body);
    assert.deepEqual(await response.json(),result);assert.match(response.headers.get('cache-control'),/private.*no-store/);
    assert.equal(response.headers.get('referrer-policy'),'no-referrer');
    const malformed=setup({loadService:async()=>({[operation]:async()=>({...result,passwordHash:'private-fixture'})})});
    const denied=await malformed.http.run(req(body),operation);assert.equal(denied.status,503);assert.ok(!(await denied.text()).includes('private-fixture'));
  }
});
test('preview routing explicitly admits only POST for the two new administrator operations',()=>{
  for(const operation of Object.keys(newOperations)) {
    const path=`/api/admin/retail-rewards/pilot/${operation}`;
    assert.equal(pilotPreviewRoute(path,'POST'),'ADMIN');
    for(const method of ['GET','PATCH','DELETE']) assert.equal(pilotPreviewRoute(path,method),null);
    assert.equal(pilotPreviewRoute(path,'POST',true),null);
    assert.equal(pilotPreviewRoute(path+'/extra','POST'),null);
  }
});

const renewalBody = { organisationId:'org-one', shopperId:'shopper-one', expectedState:'a'.repeat(64),
  expiresAt:'2026-11-20T12:00:00.000Z', requestId:'11111111-1111-4111-8111-111111111111', confirm:true };
const renewed = {ok:true,shopperId:'shopper-one',programId:'program-one',grantId:'grant-one',membershipId:'membership-one',
  expiresAt:renewalBody.expiresAt,membershipVersion:2,requestId:renewalBody.requestId};
const renewalReview = {ok:true,organisationId:'org-one',shopperId:'shopper-one',email:'shopper@example.invalid',displayName:'Pilot shopper',programId:'program-one',
  grant:{id:'grant-one',tier:'REWARDS_STARTER',expiresAt:'2026-11-19T12:00:00.000Z',limits:{activeOffers:3,locations:1,staffSeats:1,monthlyRedemptions:100,analyticsRetentionDays:30,exportEnabled:false,brandingEnabled:false}},
  membership:{id:'membership-one',expiresAt:'2026-11-19T12:00:00.000Z',version:1},invitation:{id:'invitation-one',status:'REVOKED'},expectedState:'a'.repeat(64),checkedAt:'2026-11-20T11:00:00.000Z'};
test('renewal HTTP review accepts only an exact scoped GET and projects no hidden invitation fields',async()=>{
  let received;
  const {http}=setup({loadService:async()=>({renewalReview:async value=>{received=value;return renewalReview;}})});
  const response=await http.run(req(null,{method:'GET',query:'?organisationId=org-one&shopperId=shopper-one'}),'renewalReview');
  assert.equal(response.status,200);assert.deepEqual(await response.json(),renewalReview);
  assert.deepEqual(received,{organisationId:'org-one',shopperId:'shopper-one'});
  assert.match(response.headers.get('cache-control'),/private.*no-store/);assert.equal(response.headers.get('referrer-policy'),'no-referrer');
  for(const query of ['?organisationId=org-one','?organisationId=org-one&shopperId=shopper-one&shopperId=foreign',
    '?organisationId=org-one&shopperId=shopper-one&expectedState=forged','?organisationId=org-one&shopperId=shopper-one&token=secret']){
    const denied=setup();assert.equal((await denied.http.run(req(null,{method:'GET',query}),'renewalReview')).status,400);assert.ok(!denied.seen.includes('load'));
  }
  assert.equal((await http.run(req(renewalBody),'renewalReview')).status,405);
  for(const bad of [{...renewalReview,tokenHash:'private-secret'},{...renewalReview,invitation:{...renewalReview.invitation,tokenHash:'private-secret'}},
    {...renewalReview,invitation:{...renewalReview.invitation,status:'PENDING'}},{...renewalReview,grant:{...renewalReview.grant,secret:'private-secret'}}]){
    assert.equal(safePilotAdminResult('renewalReview',bad),null);
  }
});
test('renewal POST requires explicit unchanged pins and refuses method, origin and capacity injection',async()=>{
  for(const [body,options] of [[renewalBody,{method:'GET'}],[renewalBody,{headers:{origin:'https://foreign.invalid'}}],
    [{...renewalBody,confirm:false},{}],[{...renewalBody,limits:renewalReview.grant.limits},{}],[{...renewalBody,tier:'REWARDS_ENTERPRISE'},{}],
    [{...renewalBody,expectedState:'forged'},{}],[{...renewalBody,requestId:undefined},{}],[renewalBody,{query:'?expiresAt=forged'}]]){
    const {http,seen}=setup();assert.ok((await http.run(req(body,options),'renew')).status>=400);assert.ok(!seen.includes('load'));
  }
  let received;const {http}=setup({loadService:async()=>({renew:async value=>{received=value;return renewed;}})});
  const response=await http.run(req(renewalBody),'renew');assert.equal(response.status,200);assert.deepEqual(await response.json(),renewed);assert.deepEqual(received,renewalBody);
  assert.equal(safePilotAdminResult('renew',{...renewed,invitationToken:'a'.repeat(64)}),null);
  assert.equal(safePilotAdminResult('renew',{...renewed,membershipVersion:0}),null);
});
test('renewal routes never reach authority or service when Rewards is disabled',async()=>{
  for(const operation of ['renewalReview','renew']){
    const {http,seen}=setup({env:{...env,RUVANAS_RETAIL_REWARDS_ENABLED:'false'}});
    const response=await http.run(operation==='renew'?req(renewalBody):req(null,{method:'GET',query:'?organisationId=org-one&shopperId=shopper-one'}),operation);
    assert.equal(response.status,403);assert.deepEqual(seen,[]);
  }
});
