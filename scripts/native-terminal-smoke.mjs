const base="https://maryjane-blue.vercel.app";
const market="B76aB9GWZPtFqwuyTPjB33Gys1UgCQXw27mdyPKEMyeF";

async function waitForState(){
  let last="";
  for(let attempt=1;attempt<=18;attempt++){
    try{
      const response=await fetch(`${base}/api/native-market-state?address=${market}`,{cache:"no-store",signal:AbortSignal.timeout(12000)});
      last=await response.text();
      console.log(`state attempt ${attempt} status=${response.status} ${last.slice(0,1000)}`);
      if(response.ok){
        const data=JSON.parse(last);
        if(data?.market?.address===market && data?.market?.status && data?.book?.yes && data?.book?.no){
          return data;
        }
      }
    }catch(error){console.log(`state attempt ${attempt} error=${error?.message||error}`);}
    await new Promise(r=>setTimeout(r,8000));
  }
  throw new Error(`native market state never became healthy: ${last}`);
}

async function controlledError(path){
  const response=await fetch(`${base}${path}`,{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({}),
    signal:AbortSignal.timeout(12000),
  });
  const text=await response.text();
  console.log(`${path} status=${response.status} body=${text.slice(0,500)}`);
  if(response.status>=500)throw new Error(`${path} crashed with ${response.status}`);
  let data;
  try{data=JSON.parse(text);}catch{throw new Error(`${path} did not return JSON`);}
  if(!data?.error)throw new Error(`${path} did not return a controlled error`);
}

const state=await waitForState();
await controlledError("/api/order-place");
await controlledError("/api/order-fill");
await controlledError("/api/order-cancel");

console.log(JSON.stringify({
  nativeTerminal:"PASS",
  address:state.market.address,
  status:state.market.status,
  activeOrders:state.book.activeOrderCount,
  recentTrades:state.recentTrades?.length||0,
},null,2));
