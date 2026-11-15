import { issueOwnerSession } from './local-session.js';
import { resolveCandidateSupabaseConfig } from './candidate-routes.js';
import { assembleTemplates } from './automation-domain.js';

export function createAutomationRest({env=process.env,fetchImpl=globalThis.fetch,accessToken}) {
  const config=resolveCandidateSupabaseConfig(env);
  if (!config.enabled) throw new Error('Automation storage unavailable');
  return async function rest(path,{method='GET',body,headers={}}={}) {
    const response=await fetchImpl(`${config.supabaseUrl}/rest/v1/${path}`,{
      method,signal:AbortSignal.timeout(30_000),headers:{apikey:config.publishableKey,Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json',...headers},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),
    });
    const data=await response.json().catch(()=>null);
    if(!response.ok) throw new Error(`Automation storage request failed (${response.status})`);
    return data;
  };
}

export async function processAutomationJob(rest,job,{assembler=assembleTemplates}={}) {
  try {
    const {outputs,result}=await assembler(job.payload);
    await rest('rpc/finish_workbench_automation',{method:'POST',body:{job_id:job.id,token:job.lease_token,outputs,output_status:result}});
  } catch(error) {
    await rest('rpc/fail_workbench_automation',{method:'POST',body:{job_id:job.id,token:job.lease_token,message:error?.message || 'Automatic processing failed'}});
  }
}

export function startAutomationWorker({env=process.env,fetchImpl=globalThis.fetch,logger=console,intervalMs=60_000,issueSession=issueOwnerSession,assembler=assembleTemplates}={}) {
  let stopped=false, timer, session=null, lastReconciled=0;
  const tick=async()=>{
    if(stopped)return;
    try {
      if(!session || (session.expires_at||0)*1000<Date.now()+120_000) session=await issueSession({env,fetchImpl});
      const rest=createAutomationRest({env,fetchImpl,accessToken:session.access_token});
      if(Date.now()-lastReconciled>=intervalMs){await rest('rpc/reconcile_workbench_automation',{method:'POST',body:{}});lastReconciled=Date.now();}
      // Bound each pass; the next pass drains the queue without holding UI requests.
      let processed=0;
      for(;processed<50&&!stopped;processed++){
        const [job]=await rest('rpc/claim_workbench_automation',{method:'POST',body:{}});
        if(!job)break;
        await processAutomationJob(rest,job,{assembler});
      }
      if(!stopped)timer=setTimeout(tick,processed===50?100:intervalMs);
    }catch(error){session=null;logger.error('Automation worker: storage or owner session unavailable. Retrying.');if(!stopped)timer=setTimeout(tick,intervalMs);}
    timer?.unref?.();
  };
  timer=setTimeout(tick,0);timer.unref?.();
  return {stop(){stopped=true;clearTimeout(timer);}};
}
