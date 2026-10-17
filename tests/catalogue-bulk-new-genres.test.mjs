import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import crypto from "node:crypto";
import { parseCatalogueManifest, parseCatalogueBatchSettings, metadataForBulkRow, matchManifestRowsToAudio, CatalogueBulkImportError } from "../lib/catalogue-bulk-import.mjs";
import { newCatalogueGenreLevel } from "../lib/catalogue-new-genres.mjs";

const pop = {id:"cm0000000000000000000002",name:"Pop",slug:"pop",active:true,providerReviewStatus:"APPROVED"};
const settings = parseCatalogueBatchSettings({rightsHolder:"Synthetic rights holder",rightsReference:"SYNTHETIC-ONLY",permittedTerritories:"MT",licenceExpiresAt:"",rightsConfirmed:true,publishNow:true,licensedCatalogue:true,minimumCatalogueLevel:"FOCUSED",permittedUses:["ONLINE_RADIO"]}).data;
const csv = "File,Artist,Title,BPM,Genre\ndance.mp3,Synthetic artist,Dance example,125,Dance\npop.mp3,Synthetic artist,Pop example,120,Pop\n";
const parse = (text, genres=[pop], allowNewGenres=true) => parseCatalogueManifest({buffer:Buffer.from(text),fileName:"synthetic.csv",genres,allowNewGenres});

test("missing Dance is proposed without blocking and honors the owner's explicit readiness choice", async () => {
  const rows = await parse(csv);
  assert.deepEqual(rows.map(r=>r.errors),[[],[]]);
  assert.deepEqual(rows[0].newGenreNames,["Dance"]);
  assert.deepEqual(rows[0].genreIds,[]);
  assert.equal(metadataForBulkRow(rows[0],settings).data.status,"READY");
  assert.equal(metadataForBulkRow(rows[1],settings).data.status,"READY");
  for (const row of rows) {
    assert.equal(metadataForBulkRow(row,{...settings,publishNow:false}).data.status,"DRAFT");
    assert.equal(metadataForBulkRow(row,{...settings,publishNow:undefined}).data.status,"DRAFT");
  }
  assert.equal(newCatalogueGenreLevel("Dance"),"FOCUSED");
});

test("case, HTML and canonical aliases reuse existing genres without new proposals", async () => {
  const extra = [{id:"rb",name:"R&B",slug:"r-and-b",active:true,providerReviewStatus:"APPROVED"}, {id:"club",name:"Extended Club/House",slug:"club-house-extended",active:true,providerReviewStatus:"APPROVED"}];
  for (const name of ["R&amp;B","R and B","RnB","rhythm and blues"]) {
    const [row] = await parse(`Artist,Title,Genre\nSynthetic,Example,${name}\n`,extra);
    assert.deepEqual(row.genreIds,["rb"]); assert.deepEqual(row.newGenreNames,[]);
  }
  const [house] = await parse("Artist,Title,Genre\nSynthetic,Example,House\n",extra);
  assert.deepEqual(house.genreIds,["club"]);
  const [newHouse] = await parse("Artist,Title,Genre\nSynthetic,Example,House|Club\n",[]);
  assert.deepEqual(newHouse.newGenreNames,["Extended Club/House"]);
});

for (const state of [{active:false,providerReviewStatus:"APPROVED"},{active:true,providerReviewStatus:"PENDING"},{active:true,providerReviewStatus:"REJECTED"}]) {
  test(`unavailable genre is never proposed as new: ${JSON.stringify(state)}`, async () => {
    const [row] = await parse("Artist,Title,Genre\nSynthetic,Example,RnB\n",[{id:"blocked",name:"R&B",slug:"r-and-b",...state}]);
    assert.equal(row.errors.length,1); assert.deepEqual(row.newGenreNames,[]);
    assert.match(row.errors[0],/cannot be recreated/);
  });
}

test("ambiguous identities fail closed and renamed normalized identities remain blocked", async () => {
  const [ambiguous] = await parse("Artist,Title,Genre\nSynthetic,Example,Pop\n",[pop,{...pop,id:"duplicate",name:"POP",slug:"another-pop"}]);
  assert.match(ambiguous.errors[0],/more than one/);
  const [renamed] = await parse("Artist,Title,Genre\nSynthetic,Example,Dance\n",[{id:"renamed",name:"Archived name",slug:"archived-name",normalizedKey:"dance",active:false,providerReviewStatus:"REJECTED"}]);
  assert.match(renamed.errors[0],/cannot be recreated/);
});

test("new genre proposals retain row limits, metadata requirements and bad audio matching errors", async () => {
  const [over] = await parse(`Artist,Title,Genre\nSynthetic,Example,${Array.from({length:11},(_,i)=>`Custom${i}`).join("|")}\n`,[]);
  assert.match(over.errors[0],/no more than 10/);
  const [bad] = await parse("Artist,Title,BPM,Genre\nSynthetic,Example,999,Dance\n");
  assert.match(bad.errors[0],/BPM/);
  assert.ok(matchManifestRowsToAudio([bad],[])[0].errors.some(x=>/No matching/.test(x)));
  assert.equal(parseCatalogueBatchSettings({...settings,rightsConfirmed:false}).ok,false);
  const [duplicate] = await parse("Artist,Title,Genre\nSynthetic,Example,Custom Glitch|CustomGlitch\n",[]);
  assert.equal(duplicate.newGenreNames.length,1);
  const [control] = await parse("Artist,Title,Genre\nSynthetic,Example,New\u0000Genre\n",[]);
  assert.match(control.errors[0],/not a valid genre name/);
});

// Execute the real route body with in-memory dependencies. No HTTP, database,
// object storage or user audio is accessed by these request-level tests.
const routeSource = (await readFile(new URL("../app/api/admin/catalogue/bulk-upload/route.js",import.meta.url),"utf8"))
  .replace(/import[\s\S]*?from "[^"]+";\r?\n/g,"").replaceAll("export ","");
function routeHarness({role="SUPER_ADMIN",genreRows=[pop],existingKeys=[],failGenre=false}={}) {
  const calls = {genreReads:0,stored:[],audits:0,released:0};
  class StorageError extends Error {} class RequestError extends Error {}
  const dependencies = {
    crypto,
    NextResponse:{json:(body,{status=200,headers={}}={})=>({status,headers,body})},
    catalogueTerritoriesFromForm:()=>({ok:true,codes:["MT"]}),
    prisma:{mediaGenre:{findMany:async(query)=>{calls.genreReads++;assert.equal(query.where,undefined);assert.equal(query.select.active,true);assert.equal(query.select.providerReviewStatus,true);return genreRows;}},auditLog:{create:async()=>{calls.audits++;}}},
    requirePlatformAdmin:async()=>role?({ok:true,user:{id:"synthetic-owner",role}}):({ok:false}),
    accessDenied:()=>({status:401}),
    CatalogueBulkImportError,
    extractCatalogueArchive:async()=>["dance.mp3","pop.mp3"].map(name=>({fileName:name,baseName:name,buffer:Buffer.from("ID3synthetic")})),
    matchManifestRowsToAudio,metadataForBulkRow,parseCatalogueBatchSettings,parseCatalogueManifest,
    CatalogueTrackStorageError:StorageError,
    findExistingCatalogueChecksums:async()=>new Set(existingKeys),
    inspectCatalogueAudio:({fileName})=>({storageKey:fileName}),
    storeCatalogueTrack:async(args)=>{calls.stored.push(args);if(failGenre)throw Object.assign(new Error("The genre is now unavailable."),{code:typeof failGenre === "string" ? failGenre : "CATALOGUE_GENRE_UNAVAILABLE"});return {track:{id:"synthetic-track",artist:args.metadata.artist,title:args.metadata.title}};},
    securityLog:()=>{},catalogueBulkFileSizeError:()=>null,
    acquireCatalogueBulkRequest:()=>()=>{calls.released++;},CatalogueBulkRequestError:RequestError,
    readCatalogueBulkFormData:async request=>request.formData(),newCatalogueGenreLevel,
  };
  const {POST} = new Function(...Object.keys(dependencies),`${routeSource}\nreturn {POST};`)(...Object.values(dependencies));
  function request(mode="validate",rights=true,publishNow=true) {
    const data = new FormData();
    data.set("archive",new File(["synthetic zip"],"synthetic.zip")); data.set("manifest",new File([csv],"synthetic.csv"));data.set("mode",mode);
    for (const [key,value] of Object.entries(settings)) if(key!=="permittedUses")data.set(key,String(key==="rightsConfirmed"?rights:value));
    if (publishNow == null) data.delete("publishNow"); else data.set("publishNow",String(publishNow));
    data.append("permittedUses","ONLINE_RADIO");return {formData:async()=>data};
  }
  return {POST,request,calls};
}

test("actual bulk Check files proposes Dance and performs zero import/audit writes",async()=>{
  const h=routeHarness();const result=await h.POST(h.request());
  assert.equal(result.status,200); assert.equal(result.body.preview.ready,true);
  assert.equal(result.body.preview.summary.matchedTracks,2);
  assert.deepEqual(result.body.preview.rows[0].newGenres,[{name:"Dance",minimumCatalogueLevel:"FOCUSED"}]);
  assert.equal(result.body.preview.rows[0].importStatus,"READY");
  assert.equal(h.calls.stored.length,0);assert.equal(h.calls.audits,0);assert.equal(h.calls.released,1);
});

test("actual deliberate Import passes new names only to the existing storage transaction",async()=>{
  const h=routeHarness();const result=await h.POST(h.request("import"));
  assert.equal(result.status,201);assert.equal(h.calls.stored.length,2);
  assert.deepEqual(h.calls.stored[0].newGenreNames,["Dance"]);
  assert.equal(h.calls.stored[0].metadata.status,"READY");
  assert.equal(h.calls.stored[1].metadata.status,"READY");
  assert.equal(h.calls.audits,1);
  for (const choice of [false,null]) {
    const draft = routeHarness(); const draftResult = await draft.POST(draft.request("import",true,choice));
    assert.equal(draftResult.status,201);
    assert.ok(draft.calls.stored.every(row=>row.metadata.status==="DRAFT"));
  }
});

test("actual Import still refuses existing checksums, blocked genres and unconfirmed rights",async()=>{
  for (const options of [{existingKeys:["dance.mp3"]},{genreRows:[pop,{id:"dance",name:"Dance",slug:"dance",active:false,providerReviewStatus:"APPROVED"}]}]) {
    const h=routeHarness(options);const result=await h.POST(h.request("import"));
    assert.equal(result.status,400);assert.equal(h.calls.stored.length,0);assert.equal(h.calls.audits,0);
  }
  const h=routeHarness();assert.equal((await h.POST(h.request("import",false))).status,400);assert.equal(h.calls.genreReads,0);
});

test("actual route denies anonymous and non-Super-Admin users before reading uploads",async()=>{
  for(const role of [null,"ADMIN","USER"]) {
    const h=routeHarness({role});assert.equal((await h.POST({formData:()=>{throw new Error("must not read");}})).status,role?403:401);
    assert.equal(h.calls.genreReads,0);assert.equal(h.calls.stored.length,0);
  }
});

test("a genre changed between preview and storage returns a safe per-row failure",async()=>{
  for (const failGenre of ["CATALOGUE_GENRE_UNAVAILABLE","CATALOGUE_GENRE_CONFLICT","CATALOGUE_GENRE_INVALID","CATALOGUE_GENRE_AMBIGUOUS"]) {
    const h=routeHarness({failGenre});const result=await h.POST(h.request("import"));
    assert.equal(result.status,207);assert.equal(result.body.imported.length,0);
    assert.ok(result.body.failures.every(row=>row.error==="The genre is now unavailable."));
  }
});
