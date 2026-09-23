const base="https://maryjane-blue.vercel.app";

async function waitFor(path, validate, label){
  let last="";
  for(let attempt=1;attempt<=24;attempt++){
    try{
      const response=await fetch(base+path,{
        cache:"no-store",
        signal:AbortSignal.timeout(15000),
        headers:{"user-agent":"MaryJane-44Milady-Smoke/1.0"},
      });
      last=await response.text();
      console.log(`${label} attempt=${attempt} status=${response.status} ${last.slice(0,500)}`);
      if(response.ok && validate(response,last)) return last;
    }catch(error){
      last=String(error?.message||error);
      console.log(`${label} attempt=${attempt} error=${last}`);
    }
    await new Promise(r=>setTimeout(r,5000));
  }
  throw new Error(`${label} never became healthy: ${last}`);
}

const stateText=await waitFor(
  "/api/v1/44-milady/state",
  (_response,text)=>{
    try{
      const data=JSON.parse(text);
      return data?.programId==="BS3vTdhrkK5zHchx92PFGeodckt1dLzf7i9uJyEsmZst"
        && data?.programLive===true
        && data?.solx?.symbol!=="NVDAx"
        && Boolean(data?.solx?.mint)
        && data?.network==="devnet";
    }catch{return false;}
  },
  "44-milady-state",
);
const state=JSON.parse(stateText);

await waitFor(
  "/44-milady",
  (response,text)=>String(response.headers.get("content-type")||"").includes("text/html")
    && text.includes("<div id=\"root\">"),
  "44-milady-page",
);

console.log(JSON.stringify({
  fortyFourMilady:"PASS",
  programId:state.programId,
  programLive:state.programLive,
  solxMint:state.solx.mint,
  solxMarket:state.solx.market,
  poolUsdg:state.poolUsdg,
  oracleConfigured:state.oracle?.configured||false,
  oraclePrice:state.oracle?.price??null,
},null,2));
