export const CHILD_ADMISSION = 'workflow:child-admission';
export const CHILD_ADMISSION_PROBE = 'workflow:child-admission-probe';

/** Every actual launch, including internal chain/parallel stages, passes here
 * after pure planning but before artifacts, sidecar deletion or pane creation. */
export function requestChildAdmission(
  pi: {events:{emit(type:string,payload:unknown):void}},
  plan: {id:string;sessionFile:string;paneStart:{cwd:string};piArgv:string[]},
  parent: {cwd:string;model?:{provider:string;id:string};sessionManager:{getSessionFile():string|null}},
  input: unknown, kind: 'spawn'|'resume', name: string, toolCallId?: string,
): string | undefined {
  const modelIndex=plan.piArgv.indexOf('--model');
  const request={version:1,kind,id:plan.id,name,sessionFile:plan.sessionFile,cwd:plan.paneStart.cwd,
    model:modelIndex>=0?plan.piArgv[modelIndex+1]:undefined,
    parentCwd:parent.cwd,parentModel:parent.model?`${parent.model.provider}/${parent.model.id}`:undefined,
    ownerSessionFile:parent.sessionManager.getSessionFile(),input,toolCallId,
    handled:false,allowed:false,reason:undefined as string|undefined};
  try {pi.events.emit(CHILD_ADMISSION,request);}
  catch(error){return `Child admission failed: ${String(error)}`;}
  // Native Herdr still works without a workflow controller. With a listener,
  // missing/negative decisions fail closed, including unrecognized protocol.
  if(request.handled && request.allowed!==true) return request.reason ?? 'Workflow controller refused this child launch';
  return undefined;
}
