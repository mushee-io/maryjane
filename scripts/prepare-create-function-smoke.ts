import handler from "../api/prepare-create";

function makeResponse(){
  let statusCode=200; let body:any;
  return {
    status(code:number){statusCode=code;return this;},
    setHeader(){return this;},
    json(value:any){body=value;return this;},
    read(){return {statusCode,body};},
  };
}
const res:any=makeResponse();
await handler({method:"GET"},res);
const result=res.read();
console.log(JSON.stringify(result,null,2));
if(result.statusCode!==200) throw new Error("prepare-create health failed");
if(result.body?.service!=="mary-jane-prepare-create") throw new Error("wrong service response");
