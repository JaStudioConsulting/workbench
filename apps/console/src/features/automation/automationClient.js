import { supabase } from '../../supabase-client.js';
import { gatewayBaseURL } from '../../auth-client.js';
export async function automationRequest(path,{method='GET',body,download=false}={}) {
  const {data}=await supabase.auth.getSession();
  if(!data.session?.access_token)throw new Error('Private workspace session unavailable. Reload and retry.');
  const response=await fetch(new URL(path,gatewayBaseURL),{method,headers:{Authorization:`Bearer ${data.session.access_token}`,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(download&&response.ok)return response.blob();
  const payload=await response.json();
  if(!response.ok)throw new Error(payload.error?.message || 'Request failed');
  return payload;
}
export function downloadBlob(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export const textField=value=>({value:String(value||'').trim()||null,evidence:String(value||'').trim()?[{source:'resume',quote:String(value).trim()}]:[]});
export const textClaims=value=>String(value||'').split('\n').map(x=>x.trim()).filter(Boolean).map(text=>({text,evidence:[{source:'resume',quote:text}]}));
