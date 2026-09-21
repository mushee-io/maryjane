import handler from "../api/prepare-create";

function makeResponse(){
  let statusCode=200;
  let body:any;
  return {
    status(code:number){statusCode=code;return this;},
    setHeader(){return this;},
    json(value:any){body=value;return this;},
    read(){return {statusCode,body};},
  };
}

const health:any=makeResponse();
await handler({method:"GET"},health);
const healthResult=health.read();
if(healthResult.statusCode!==200) throw new Error("prepare-create health failed");
if(healthResult.body?.service!=="mary-jane-prepare-create") throw new Error("wrong service response");

// Exercise the POST path through the dynamic @solana/web3.js import.
// The test intentionally has no attestor secret, so a healthy runtime must
// advance to stage=load-attestor and return a controlled 503.
process.env.MARKETLINT_PUBLIC_CERTIFY="true";
delete process.env.MARKETLINT_ATTESTOR_SECRET_KEY;

const now=Math.floor(Date.now()/1000);
const post:any=makeResponse();
await handler({
  method:"POST",
  body:{
    wallet:"11111111111111111111111111111111",
    input:{
      question:"Will SOL/USD be above $250 tomorrow?",
      description:"YES if Pyth SOL/USD is at or above $250. NO otherwise.",
      source:"Pyth Oracle · SOL/USD · target 250",
      category:"Crypto",
      deadline:"Tomorrow 12:00 UTC",
      closeTs:now+3600,
      resolutionTs:now+3900,
    },
  },
},post);

const postResult=post.read();
console.log(JSON.stringify({health:healthResult,post:postResult},null,2));
if(postResult.statusCode!==503) {
  throw new Error(`Expected controlled 503 after web3 import, got ${postResult.statusCode}`);
}
if(postResult.body?.stage!=="load-attestor") {
  throw new Error(`Solana runtime did not reach load-attestor; stage=${postResult.body?.stage}`);
}
if(!String(postResult.body?.error||"").includes("MARKETLINT_ATTESTOR_SECRET_KEY")) {
  throw new Error("Expected missing attestor diagnostic");
}
