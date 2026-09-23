const base="https://maryjane-blue.vercel.app";

async function waitFor(path, accept, label){
  let last="";
  for(let attempt=1;attempt<=30;attempt++){
    try{
      const response=await fetch(base+path,{
        cache:"no-store",
        signal:AbortSignal.timeout(15000),
        headers:{"user-agent":"MaryJane-44Milady-Smoke/3.0"},
      });
      last=await response.text();
      console.log(`${label} attempt=${attempt} status=${response.status} ${last.slice(0,500)}`);
      if(accept(response,last)) return {response,text:last};
    }catch(error){
      last=String(error?.message||error);
      console.log(`${label} attempt=${attempt} error=${last}`);
    }
    await new Promise(r=>setTimeout(r,5000));
  }
  throw new Error(`${label} never became healthy: ${last}`);
}

await waitFor(
  "/44-milady",
  (response,text)=>response.ok
    && String(response.headers.get("content-type")||"").includes("text/html")
    && text.includes("<div id=\"root\">"),
  "44-milady-page",
);

const state=await waitFor(
  "/api/discovery-feed?miladyState=1",
  (response,text)=>{
    if(!response.ok)return false;
    try{
      const data=JSON.parse(text);
      return data?.programId==="BS3vTdhrkK5zHchx92PFGeodckt1dLzf7i9uJyEsmZst"
        && data?.programLive===true
        && Boolean(data?.solx?.market)
        && Boolean(data?.solx?.mint)
        && data?.oracle?.configured===true
        && Number(data?.oracle?.price)>0;
    }catch{return false;}
  },
  "44-milady-state",
);

const data=JSON.parse(state.text);
console.log(JSON.stringify({
  fortyFourMilady:"PASS",
  programId:data.programId,
  programLive:data.programLive,
  solxMint:data.solx.mint,
  solxMarket:data.solx.market,
  poolUsdg:data.poolUsdg,
  oracleConfigured:data.oracle.configured,
  oraclePrice:data.oracle.price,
},null,2));
