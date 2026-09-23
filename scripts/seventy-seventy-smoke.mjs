const base="https://maryjane-blue.vercel.app";

async function waitFor(path,accept,label){
  let last="";
  for(let attempt=1;attempt<=24;attempt++){
    try{
      const response=await fetch(base+path,{
        cache:"no-store",
        signal:AbortSignal.timeout(15000),
        headers:{"user-agent":"MaryJane-7070-Smoke/1.0"},
      });
      last=await response.text();
      console.log(`${label} attempt=${attempt} status=${response.status} ${last.slice(0,400)}`);
      if(accept(response,last))return last;
    }catch(error){
      last=String(error?.message||error);
      console.log(`${label} attempt=${attempt} error=${last}`);
    }
    await new Promise(r=>setTimeout(r,5000));
  }
  throw new Error(`${label} never became healthy: ${last}`);
}

await waitFor(
  "/7070",
  (response,text)=>response.ok
    && String(response.headers.get("content-type")||"").includes("text/html")
    && text.includes("<div id=\"root\">"),
  "7070-page",
);

const stateText=await waitFor(
  "/api/discovery-feed?miladyState=1",
  (response,text)=>{
    if(!response.ok)return false;
    try{
      const data=JSON.parse(text);
      return data?.programLive===true
        && Number(data?.pool?.totalSuppliedUsdg)>=0
        && Number(data?.pool?.availableUsdg)>=0
        && Number(data?.pool?.supplyAprPct)>=0
        && Number(data?.pool?.utilizationPct)>=0;
    }catch{return false;}
  },
  "7070-engine",
);

const state=JSON.parse(stateText);
console.log(JSON.stringify({
  seventySeventy:"PASS",
  programLive:state.programLive,
  availableUsdg:state.pool.availableUsdg,
  totalSuppliedUsdg:state.pool.totalSuppliedUsdg,
  totalBorrowedUsdg:state.pool.totalBorrowedUsdg,
  supplyAprPct:state.pool.supplyAprPct,
  utilizationPct:state.pool.utilizationPct,
},null,2));
