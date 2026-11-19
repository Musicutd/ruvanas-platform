import test from 'node:test';
import assert from 'node:assert/strict';
import { createCampaignLinkHttp } from '../lib/retail-rewards/campaign-link-http.mjs';
const env={NODE_ENV:'production',RUVANAS_PUBLIC_URL:'https://rewards.example.invalid',RUVANAS_RETAIL_REWARDS_ENABLED:'true',RUVANAS_RETAIL_REWARDS_CAMPAIGNS_ENABLED:'true',RUVANAS_RETAIL_REWARDS_CAMPAIGN_LINKS_ENABLED:'true'};
const input={offerId:'coupon-one',expectedVersion:4};
const review={ok:true,offer:{id:'coupon-one',title:'Shop coupon',version:4,state:'PUBLISHED',publishedRevision:1},selection:null,publishedLink:null,campaigns:[],page:1,hasMore:false,checkedAt:'2026-11-14T12:00:00.000Z'};
function setup(overrides={}){
  const seen=[];
  const handler=createCampaignLinkHttp({env,authorizeStaff:async()=>{seen.push('auth');return {ok:true,organisationId:'org-one',userId:'owner'};},
    rateLimit:async value=>{seen.push(value.principal?'principal':'ip');return {allowed:true};},
    loadService:async()=>{seen.push('load');return {campaignLinks:async value=>{seen.push(value);return review;},saveCampaignLink:async value=>{seen.push(value);return {ok:false,code:'CONFLICT'};}};},...overrides});
  return {handler,seen};
}
function req(body=input,options={}) { const {method='POST',headers={},query='',raw,...rest}=options;
  return new Request('https://rewards.example.invalid/api/retail-rewards/campaign-links/review'+query,{method,headers:{origin:env.RUVANAS_PUBLIC_URL,'content-type':'application/json',...headers},
    ...(method==='GET'?{}:{body:raw??JSON.stringify(body)}),...rest}); }
test('campaign links default-off blocks before authentication, database or throttle',async()=>{
  for(const flags of [{},{...env,RUVANAS_RETAIL_REWARDS_CAMPAIGN_LINKS_ENABLED:'TRUE'},{...env,RUVANAS_RETAIL_REWARDS_CAMPAIGNS_ENABLED:'false'}]){
    const {handler,seen}=setup({env:flags});assert.equal((await handler.review(req())).status,403);assert.deepEqual(seen,[]);
  }
});
test('campaign links reject methods, foreign origins, cross-site and URL parameters before actor access',async()=>{
  for(const options of [{method:'GET'},{headers:{origin:'https://foreign.invalid'}},{headers:{origin:'null'}},{headers:{'sec-fetch-site':'cross-site'}},{query:'?organisationId=org-other'}]){
    const {handler,seen}=setup();assert.ok((await handler.review(req(input,options))).status>=400);assert.deepEqual(seen,[]);
  }
});
test('campaign links strict and bounded JSON prevents privilege fields, duplicate choices and malformed data',async()=>{
  const cases=[req({...input,organisationId:'org-other'}),req({...input,expectedVersion:'4'}),req(input,{headers:{'content-type':'text/plain'}}),req(input,{raw:'{'}),req(input,{raw:' '.repeat(8193)}),req(input,{headers:{'content-length':'9000'}})];
  for(const request of cases){const {handler,seen}=setup();assert.equal((await handler.review(request)).status,400);assert.ok(!seen.includes('auth'));}
  const {handler}=setup();assert.equal((await handler.save(req({...input,campaignId:null,campaignPublicationRevision:1}))).status,400);
});
test('campaign links authenticated review returns strict private no-store whitelist',async()=>{
  const {handler,seen}=setup(),response=await handler.review(req());assert.equal(response.status,200);assert.deepEqual(await response.json(),review);
  assert.match(response.headers.get('cache-control'),/private.*no-store/);assert.equal(response.headers.get('vary'),'Cookie');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  assert.deepEqual(seen,['ip','auth','principal','load',input]);
});
test('campaign links enforce actor and both rate limits before service invocation',async()=>{
  const denied=setup({authorizeStaff:async()=>({ok:false,code:'FORBIDDEN',secret:'must-not-return'})});
  const response=await denied.handler.save(req({...input,campaignId:null}));assert.equal(response.status,403);assert.ok(!(await response.text()).includes('secret'));assert.ok(!denied.seen.includes('load'));
  for(const block of ['ip','principal']){let called=0;const {handler,seen}=setup({rateLimit:async({principal})=>({allowed:block==='ip'?false:!principal,retryAfterSeconds:3.2})});
    const result=await handler.review(req());assert.equal(result.status,429);assert.equal(result.headers.get('retry-after'),'4');assert.ok(!seen.includes('load'));}
});
test('campaign links strict output rejects private fields and sanitises thrown errors',async()=>{
  for(const loadService of [async()=>({campaignLinks:async()=>({...review,storageKey:'private'})}),async()=>{throw new Error('private-database-password');}]){
    const {handler}=setup({loadService}),response=await handler.review(req());assert.equal(response.status,503);assert.ok(!(await response.text()).includes('private-database-password'));
  }
});
test('campaign links save delegates explicit null only after authority and optimistic input checks',async()=>{
  const {handler,seen}=setup(),body={...input,campaignId:null},response=await handler.save(req(body));assert.equal(response.status,409);assert.deepEqual(seen.at(-1),body);
});
