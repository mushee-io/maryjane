const base="https://maryjane-blue.vercel.app";

async function waitFor(path, accept, label){
  let last="";
  for(let attempt=1;attempt<=24;attempt++){
    try{
      const response=await fetch(base+path,{
        cache:"no-store",
        signal:AbortSignal.timeout(15000),
        headers:{"user-agent":"MaryJane-44Milady-Smoke/2.0"},
      });
      last=await response.text();
      console.log(`${label} attempt=${attempt} status=${response.status} ${last.slice(0,400)}`);
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

const pyth=await waitFor(
  "/api/pyth-sol",
  (response,text)=>{
    if(response.status!==200 && response.status!==503 && response.status!==502) return false;
    try{
      const data=JSON.parse(text);
      if(response.status===200) return data?.configured===true && Number(data?.price)>0 && Array.isArray(data?.updateData);
      if(response.status===503) return data?.configured===false && Boolean(data?.error);
      return data?.configured===true && Boolean(data?.error);
    }catch{return false;}
  },
  "pyth-sol-proxy",
);

const pythData=JSON.parse(pyth.text);
console.log(JSON.stringify({
  fortyFourMilady:"PASS",
  page:"/44-milady",
  pythProxy:"PASS",
  oracleConfigured:Boolean(pythData.configured),
  oraclePrice:pythData.price??null,
},null,2));
