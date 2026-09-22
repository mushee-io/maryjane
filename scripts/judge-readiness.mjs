const base=(process.env.MARY_JANE_BASE_URL||"https://maryjane-blue.vercel.app").replace(/\/$/,"");
const strict=process.env.JUDGE_STRICT==="true";
const minNative=Number(process.env.JUDGE_MIN_NATIVE_MARKETS||(strict?"5":"1"));
const minVisual=Number(process.env.JUDGE_MIN_VISUAL_MARKETS||(strict?"3":"0"));

async function get(path){
  const response=await fetch(base+path,{
    headers:{"cache-control":"no-cache","user-agent":"MaryJane-Judge-Readiness/1.0"},
    signal:AbortSignal.timeout(20000)
  });
  const text=await response.text();
  let data={};
  try{data=text?JSON.parse(text):{};}catch{}
  if(!response.ok)throw new Error(path+" HTTP "+response.status+": "+(data?.error||text.slice(0,200)));
  return data;
}

const [feed,marketLint,prepare]=await Promise.all([
  get("/api/discovery-feed?limit=200"),
  get("/api/marketlint-analyze"),
  get("/api/prepare-create"),
]);

const native=(feed.items||[]).filter((market)=>market.source==="maryjane");
const open=native.filter((market)=>market.status==="OPEN"&&!market.resolved);
const visual=native.filter((market)=>market.coverImageUrl||market.outcomes?.some((outcome)=>outcome.imageUrl));
const liquid=native.filter((market)=>Number(market.volumeTotal||0)>0||market.probabilitySource==="pool-reference");
const categories=[...new Set(native.map((market)=>market.category).filter(Boolean))];

const terminal=[];
for(const market of native.slice(0,Math.min(5,native.length))){
  try{
    const state=await get("/api/native-market-state?address="+encodeURIComponent(market.nativeAddress));
    terminal.push({
      market:market.nativeAddress,
      status:state.market?.status,
      orders:state.book?.activeOrderCount||0,
      trades:state.book?.tradeCount||0
    });
  }catch(error){
    terminal.push({market:market.nativeAddress,error:error?.message||String(error)});
  }
}

const checks=[
  {id:"discovery",ok:Array.isArray(feed.items),detail:String(feed.items?.length||0)+" total discovery markets"},
  {id:"native-markets",ok:native.length>=minNative,detail:native.length+"/"+minNative+" required"},
  {id:"open-native",ok:open.length>0,detail:String(open.length)+" open"},
  {id:"visual-native",ok:visual.length>=minVisual,detail:visual.length+"/"+minVisual+" required"},
  {id:"marketlint",ok:marketLint?.status==="ok",detail:marketLint?.service||"unavailable"},
  {
    id:"public-create",
    ok:prepare?.status==="ok"&&prepare?.attestorConfigured===true&&prepare?.publicCertificationEnabled===true,
    detail:"attestor="+Boolean(prepare?.attestorConfigured)+" public="+Boolean(prepare?.publicCertificationEnabled)
  },
  {
    id:"terminal-state",
    ok:terminal.length>0&&terminal.every((item)=>!item.error),
    detail:terminal.filter((item)=>!item.error).length+"/"+terminal.length+" healthy"
  },
];

console.log(JSON.stringify({
  maryJaneJudgeReadiness:checks.every((check)=>check.ok)?"PASS":"FAIL",
  base,
  summary:{native:native.length,open:open.length,visual:visual.length,liquid:liquid.length,categories},
  checks,
  terminal,
},null,2));

if(!checks.every((check)=>check.ok))process.exitCode=1;
