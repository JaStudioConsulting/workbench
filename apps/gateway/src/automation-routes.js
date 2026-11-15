import express from 'express';
import { randomUUID } from 'node:crypto';
import { mkdir,writeFile,readFile,unlink } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { CandidateIdSchema } from '@ja/shared-types';
import { createAutomationRest } from './automation-worker.js';
import { validateAutomationInputs } from './automation-domain.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function registerAutomationRoutes(app,{access,env=process.env,fetchImpl=globalThis.fetch}={}) {
  const restFor=req=>createAutomationRest({env,fetchImpl,accessToken:req.supabaseRecruiter.accessToken});
  const wrap=fn=>async(req,res)=>{try{await fn(req,res);}catch(error){res.status(400).json({error:{code:'AUTOMATION_FAILED',message:error.message || 'Automatic processing unavailable'}});}};
  app.get('/api/automation/jobs',access,wrap(async(req,res)=>{
    const query=new URLSearchParams({select:'id,record_key,candidate_name,job_title,state,attempts,case_id,result,last_error,created_at,updated_at',state:'neq.outdated',order:'created_at.desc',limit:'100'});
    if(req.query.candidateId){const id=CandidateIdSchema.parse(req.query.candidateId);query.set('record_key',`like.automation:${id}:job:*`);}
    const rows=await restFor(req)(`automation_job_status?${query}`);
    // Present latest source version per record, retaining historical versions in storage.
    const seen=new Set();res.json({jobs:rows.filter(row=>{if(seen.has(row.record_key))return false;seen.add(row.record_key);return true;})});
  }));
  app.post('/api/automation/reconcile',access,wrap(async(req,res)=>{res.json({queued:await restFor(req)('rpc/reconcile_workbench_automation',{method:'POST',body:{}})});}));
  app.post('/api/automation/jobs/:id/retry',access,wrap(async(req,res)=>{
    if(!UUID.test(req.params.id))throw new Error('Invalid processing task');
    const retried=await restFor(req)('rpc/retry_workbench_automation',{method:'POST',body:{job_id:req.params.id}});res.json({retried});
  }));
  app.get('/api/automation/candidates/:id/inputs',access,wrap(async(req,res)=>{
    const id=CandidateIdSchema.parse(req.params.id);const query=new URLSearchParams({candidate_id:`eq.${id}`,limit:'1'});
    res.json({input:(await restFor(req)(`automation_inputs?${query}`))[0] || {fields:{},resume:null}});
  }));
  app.put('/api/automation/candidates/:id/inputs',access,wrap(async(req,res)=>{
    const id=CandidateIdSchema.parse(req.params.id),rest=restFor(req);
    const [candidate]=await rest(`candidates_all?${new URLSearchParams({id:`eq.${id}`,limit:'1'})}`);
    if(!candidate)throw new Error('Candidate no longer exists');
    const input=validateAutomationInputs(req.body,candidate);
    await rest('automation_inputs?on_conflict=owner_id,candidate_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates'},body:{owner_id:req.supabaseRecruiter.ownerId,candidate_id:id,...input,updated_at:new Date().toISOString()}});
    await rest('rpc/reconcile_workbench_automation',{method:'POST',body:{}});res.json({saved:true});
  }));
  const documentRoot=resolve(env.WORKBENCH_DATA_DIR || '../../workbench-data','documents');
  app.get('/api/documents',access,wrap(async(req,res)=>{
    const query=new URLSearchParams({select:'id,candidate_id,job_id,name,content_type,size_bytes,created_at',order:'created_at.desc',limit:'100'});
    if(req.query.candidateId)query.set('candidate_id',`eq.${CandidateIdSchema.parse(req.query.candidateId)}`);
    res.json({documents:await restFor(req)(`workbench_documents?${query}`)});
  }));
  app.post('/api/documents',access,express.json({limit:'29mb'}),wrap(async(req,res)=>{
    const candidateId=req.body.candidateId?CandidateIdSchema.parse(req.body.candidateId):null;
    const jobId=req.body.jobId?Number(req.body.jobId):null;
    if(!candidateId && !jobId)throw new Error('Link the document to a candidate or job');
    if(req.body.jobId != null && req.body.jobId !== '' && (!Number.isSafeInteger(jobId)||jobId<=0))throw new Error('Invalid job');
    const name=String(req.body.name || '').replace(/[\x00-\x1f/\\]/g,'_').slice(0,200);
    if(!/\.(pdf|docx|txt)$/i.test(name))throw new Error('Upload a PDF, DOCX or text document');
    if(typeof req.body.base64!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(req.body.base64))throw new Error('Invalid document data');
    const bytes=Buffer.from(req.body.base64,'base64');
    if(!bytes.length||bytes.length>20*1024*1024)throw new Error('Document must be 1 byte to 20 MiB');
    const id=randomUUID(),owner=req.supabaseRecruiter.ownerId,dir=join(documentRoot,owner);
    await mkdir(dir,{recursive:true,mode:0o700});await writeFile(join(dir,id),bytes,{mode:0o600,flag:'wx'});
    try {
      const contentType=/\.pdf$/i.test(name)?'application/pdf':/\.docx$/i.test(name)?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'text/plain';
      await restFor(req)('workbench_documents',{method:'POST',body:{id,owner_id:owner,candidate_id:candidateId,job_id:jobId,name,content_type:contentType,size_bytes:bytes.length}});
    }catch(error){ /* A lost DB response may follow a committed insert. Preserve original bytes. */ throw error; }
    res.status(201).json({id,saved:true});
  }));
  app.get('/api/documents/:id/download',access,wrap(async(req,res)=>{
    if(!UUID.test(req.params.id))throw new Error('Invalid document');
    const [doc]=await restFor(req)(`workbench_documents?${new URLSearchParams({id:`eq.${req.params.id}`,limit:'1'})}`);
    if(!doc)return res.status(404).json({error:{code:'NOT_FOUND',message:'Document unavailable'}});
    const bytes=await readFile(join(documentRoot,req.supabaseRecruiter.ownerId,doc.id));
    res.set({'Content-Type':doc.content_type,'X-Content-Type-Options':'nosniff','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(doc.name)}`,'Cache-Control':'private, no-store'}).send(bytes);
  }));
}
