import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

type Props={children?:ReactNode};
type State={error:Error|null};

export class AppErrorBoundary extends Component<Props,State>{
  state:State={error:null};

  static getDerivedStateFromError(error:Error):State{return{error};}

  componentDidCatch(error:Error,info:ErrorInfo){
    console.error("[MaryJane UI crash]",error,info);
  }

  render(){
    if(!this.state.error)return this.props.children;
    return(
      <div className="min-h-screen bg-[#060606] px-5 py-16 text-[#f5f5ef]">
        <div className="mx-auto max-w-xl rounded-3xl border border-rose-300/15 bg-rose-300/[.04] p-7">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-300/10 text-rose-200"><AlertTriangle className="h-5 w-5"/></div>
          <h1 className="mt-5 text-2xl font-semibold tracking-[-.03em]">Mary Jane hit a UI error</h1>
          <p className="mt-2 text-sm leading-6 text-white/45">Your wallet and onchain state are unchanged. Reload the page; if the same screen fails again, return to Markets and retry after the next RPC refresh.</p>
          <div className="mt-5 rounded-xl border border-white/[.06] bg-black/30 p-3 font-mono text-[11px] leading-5 text-white/30">{this.state.error.message||"Unexpected application error"}</div>
          <div className="mt-5 flex flex-wrap gap-2">
            <button onClick={()=>window.location.reload()} className="flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-black"><RefreshCw className="h-4 w-4"/>Reload</button>
            <a href="/" className="rounded-xl border border-white/[.1] px-4 py-2.5 text-sm text-white/60">Back to Markets</a>
          </div>
        </div>
      </div>
    );
  }
}
export default AppErrorBoundary;
