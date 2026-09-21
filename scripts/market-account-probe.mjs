const url="https://maryjane-blue.vercel.app/api/market-probe?address=B76aB9GWZPtFqwuyTPjB33Gys1UgCQXw27mdyPKEMyeF";
let last="";
for(let attempt=1;attempt<=15;attempt++){
  try{
    const response=await fetch(url,{signal:AbortSignal.timeout(12_000),cache:"no-store"});
    last=await response.text();
    console.log(`attempt ${attempt} status=${response.status} ${last}`);
    if(response.ok){
      const data=JSON.parse(last);
      if(data.exists===true && data.isMarket===true){
        console.log("MARKET_ACCOUNT_PROBE_PASS");
        process.exit(0);
      }
      if(data.exists===false){
        console.log("MARKET_ACCOUNT_NOT_FOUND_YET");
      }
    }
  }catch(error){
    console.log(`attempt ${attempt} error=${error?.message||error}`);
  }
  await new Promise(r=>setTimeout(r,8_000));
}
throw new Error(`Market account probe failed. Last response: ${last}`);
