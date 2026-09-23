const SOL_FEED_ID="0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

export const config = {
  maxDuration: 20,
};

export default async function handler(req:any,res:any){
  res.setHeader("Content-Type","application/json; charset=utf-8");
  if(req.method!=="GET") return res.status(405).json({error:"Method not allowed"});

  const apiKey=String(process.env.PYTH_API_KEY||"").trim();
  if(!apiKey){
    return res.status(503).json({
      error:"PYTH_API_KEY is not configured",
      configured:false,
    });
  }

  try{
    const url=new URL("https://pyth.dourolabs.app/hermes/v2/updates/price/latest");
    url.searchParams.append("ids[]",SOL_FEED_ID);
    url.searchParams.set("encoding","base64");
    url.searchParams.set("parsed","true");

    const response=await fetch(url,{
      headers:{
        authorization:`Bearer ${apiKey}`,
        accept:"application/json",
      },
      signal:AbortSignal.timeout(12000),
    });
    const text=await response.text();
    if(!response.ok){
      return res.status(502).json({
        error:`Pyth request failed (${response.status})`,
        detail:text.slice(0,240),
        configured:true,
      });
    }

    const body=JSON.parse(text);
    const parsed=body.parsed?.find((item:any)=>
      ("0x"+String(item.id||"").replace(/^0x/,"")).toLowerCase()===SOL_FEED_ID
    )??body.parsed?.[0];

    if(!parsed?.price||!body?.binary?.data?.length){
      return res.status(502).json({error:"Pyth SOL/USD response is incomplete",configured:true});
    }

    const price=Number(parsed.price.price)*10**Number(parsed.price.expo);
    return res.status(200).json({
      configured:true,
      feedId:SOL_FEED_ID,
      price,
      updateData:body.binary.data,
      publishTime:Number(parsed.price.publish_time||0),
    });
  }catch(error:any){
    return res.status(502).json({
      error:error?.message||"Unable to fetch Pyth SOL/USD",
      configured:true,
    });
  }
}
