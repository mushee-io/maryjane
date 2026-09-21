import handler from "../api/discovery-feed";
function response(){let statusCode=200;let body:any;return{status(code:number){statusCode=code;return this;},setHeader(){return this;},json(value:any){body=value;return this;},read(){return{statusCode,body}}};}
const res:any=response();
await handler({method:"POST",query:{}},res);
const result=res.read();
console.log(JSON.stringify(result,null,2));
if(result.statusCode!==405) throw new Error("discovery-feed method guard failed");
