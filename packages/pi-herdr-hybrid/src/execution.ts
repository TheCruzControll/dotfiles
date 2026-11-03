import { CHILD_ADMISSION } from './admission.ts';
import upstream from 'pi-subagents';
import { registerAgent } from 'pi-subagents/agents';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getAgentConfigDir, loadAgentDefaults, resolveDenyTools, resolveEffectiveSessionMode, resolveSubagentPaths } from './agents.ts';

export type ExecutionMode = 'background' | 'pane';
export function readExecutionMode(): ExecutionMode {
  const file = join(getAgentConfigDir(), 'hybrid-execution.json');
  if (!existsSync(file)) return 'background';
  const value = JSON.parse(readFileSync(file, 'utf8')).executionMode;
  if (value !== 'background' && value !== 'pane') throw Error(`Invalid executionMode in ${file}`);
  return value;
}
export function writeExecutionMode(mode: ExecutionMode | 'reset') {
  mkdirSync(getAgentConfigDir(), { recursive: true });
  writeFileSync(join(getAgentConfigDir(), 'hybrid-execution.json'), JSON.stringify({ executionMode: mode === 'reset' ? 'background' : mode }) + '\n', { mode: 0o600 });
}
export function backgroundRequest(params: any, cwd: string) {
  const defs = params.agent ? loadAgentDefaults(params.agent) : null;
  const reject = (why: string): never => { throw Error(`${why}. Select executionMode: "pane" explicitly (Pane).`); };
  if (params.agent && !defs) reject(`Agent ${params.agent} not found`);
  const effectiveCwd = resolveSubagentPaths({ ...params, cwd: params.cwd === undefined ? undefined : resolve(cwd, params.cwd) }, defs).effectiveCwd ?? cwd;
  if (existsSync(join(effectiveCwd, '.pi', 'agent')) && resolve(join(effectiveCwd, '.pi', 'agent')) !== resolve(getAgentConfigDir())) reject('Background cannot preserve a child-specific agent directory');
  if (params.preflight) reject('Background does not support Hybrid preflight');
  if (params.interactive || defs?.interactive || defs?.autoExit === false) reject('Interactive/retained pane policy is not supported in Background');
  if (defs?.disableModelInvocation) reject('Profile disables model invocation');
  if (defs?.cli && defs.cli !== 'pi') reject('Non-Pi profiles are not supported');
  if (process.env.PI_DENY_TOOLS) reject('Inherited Hybrid tool deny policy cannot be represented safely');
  // Fresh upstream sessions retain the parent header without copying conversation history.
  const mode = resolveEffectiveSessionMode(params, defs);
  if (defs?.sessionMode === 'standalone' && !params.fork) reject('Background fresh sessions retain parent lineage; standalone policy requires Pane');
  const list = (value?: string) => value === undefined ? undefined : value.split(',').map(s => s.trim()).filter(Boolean);
  return { cwd: effectiveCwd, context: mode === 'fork' ? 'fork' : 'fresh', definition: {
    description: params.name, systemPrompt: (defs?.body ?? params.systemPrompt ?? '').trim() || 'Complete the assigned task.',
    systemPromptMode: defs?.systemPromptMode ?? 'append',
    tools: list(params.tools ?? defs?.tools), skills: list(params.skills ?? defs?.skills),
    excludeTools: [...resolveDenyTools(defs), ...(defs?.spawning === false ? ['subagent_native', 'subagent_workflow', 'subagents_enable'] : [])], allowNestedSubagents: defs?.spawning !== false,
    model: params.model ?? defs?.model, thinking: defs?.thinking,
    inheritProjectContext: true, inheritGlobalContext: true, inheritSkills: defs?.inheritSkills !== false,
  } };
}

/** One upstream instance; only its subagent registration is private, including repins. */
export function embedBackground(pi: any, initialize = upstream) {
  let tool: any;
  const pending = new Map<string, any>();
  const bind = (event: any) => {
    const matches = [...pending.values()].filter(request => request.agentName && request.agentName === event.agent);
    const calls = [...pending.values()].filter(request => request.toolCallId === event.toolCallId && event.toolCallId);
    const request = matches.length === 1 ? matches[0] : calls.length === 1 ? calls[0] : undefined;
    if (!request || !event.id) return;
    request.nativeId = event.id;
    pi.appendEntry?.('hybrid-background', { id: event.id });
    pi.events?.emit('workflow:child-backend-binding', { version: 1, executionMode: 'background', reservationId: request.id, id: event.id, sessionRoot: event.sessionRoot });
  };
  pi.events?.on?.('subagent:async-started', bind);
  const admit = (callId: string, input: any, ctx: any, cwd: string, model: string, previousId?: string) => {
    const parentModel = ctx.model && `${ctx.model.provider}/${ctx.model.id}`;
    const base = model?.replace(/:(off|minimal|low|medium|high|xhigh|max)$/, '');
    const request: any = { version: 1, backendProtocol: 1, executionMode: 'background', kind: previousId ? 'resume' : 'spawn', id: randomUUID(), previousId,
      cwd, model, parentModel, parentCwd: ctx.cwd, ownerSessionFile: ctx.sessionManager?.getSessionFile?.(), input, toolCallId: callId, handled: false, allowed: false };
    pi.events?.emit(CHILD_ADMISSION, request);
    if (request.handled && (!base || !/^[^/\s]+\/[^\s]+$/.test(base))) throw Error('Background admission requires an exact provider/model selector');
    if (request.handled && base !== parentModel) {
      const slash = base.indexOf('/');
      const resolved = ctx.modelRegistry?.find(base.slice(0, slash), base.slice(slash + 1));
      if (!resolved || `${resolved.provider}/${resolved.id}` !== base) {
        pi.events.emit('workflow:child-backend-validation-failed', { version: 1, reservationId: request.id });
        throw Error(`Unknown exact background model: ${base}`);
      }
    }
    if (request.handled && (!request.allowed || request.backendProtocolAccepted !== 1)) throw Error(request.reason ?? 'Controller does not support background admission');
    pending.set(request.id, request);
    return request;
  };
  const facade = new Proxy(pi, { get(target, key) {
    if (key === 'registerTool') return (definition: any) => {
      if (definition.name === 'subagent') {
        tool = definition;
        if ((process.env.PI_DENY_TOOLS ?? '').split(',').some((name: string) => ['subagent', 'subagent_native'].includes(name.trim()))) return;
        target.registerTool({ ...definition, name: 'subagent_native', label: 'Native background management',
          description: 'Upstream background management only (status, list, interrupt, resume, etc.). Launch new children with subagent.',
          execute: (...args: any[]) => {
            if (!['status', 'list', 'interrupt', 'stop', 'resume', 'steer', 'debug.run', 'guide'].includes(args[1]?.action)) throw Error('Use Hybrid subagent for launches; native surface supports status/list/interrupt/stop/resume/steer/debug.run/guide only');
            return execute(...args as [string, any, any, any, any]);
          } });
        return;
      }
      // Explicit eager activation: omit the lazy loader. Its selection hooks then no-op.
      if (definition.name === 'subagents_enable') return;
      target.registerTool(definition);
    };
    if (key === 'registerCommand') return (name: string, command: any) => {
      if (name !== 'subagent') target.registerCommand(name, command);
    };
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  initialize(facade);
  const execute = async (id: string, args: any, signal: any, update: any, ctx: any) => {
    if (!tool) throw Error('Upstream subagent runtime is not registered');
    const saved = args.action === 'resume' ? ctx.sessionManager?.getBranch?.().findLast((entry: any) =>
      entry.customType === 'hybrid-background-definition' && entry.data?.id === args.id)?.data : undefined;
    let registration: ReturnType<typeof registerAgent> | undefined;
    let reservation: any;
    if (args.action === 'resume') {
      reservation = admit(id, args, ctx, saved?.cwd, saved?.model, args.id);
      reservation.agentName = saved?.name;
      if (saved) args = { ...args, cwd: saved.cwd };
    }
    try {
      try { if (saved) registration = registerAgent({ pi: facade, name: saved.name, definition: saved.definition }); }
      catch (error) {
        pi.events?.emit('workflow:child-backend-validation-failed', { version: 1, reservationId: reservation?.id });
        if (reservation) pending.delete(reservation.id);
        throw error;
      }
      const result = await tool.execute(id, args, signal, update, ctx);
      const runId = result.details?.runId ?? result.details?.asyncId;
      if (saved && runId) {
        if (!reservation.nativeId) bind({ id: runId, agent: saved.name });
        pi.appendEntry('hybrid-background-definition', { ...saved, id: runId });
      }
      return result;
    } finally { registration?.dispose(); if (reservation?.nativeId) pending.delete(reservation.id); }
  };
  return {
    execute,
    async spawn(id: string, params: any, signal: any, ctx: any) {
      const request = backgroundRequest(params, ctx.cwd);
      const model = params.model ?? request.definition.model ?? (ctx.model && `${ctx.model.provider}/${ctx.model.id}`);
      const reservation = admit(id, params, ctx, request.cwd, model);
      const name = `hybrid-${randomUUID()}`;
      reservation.agentName = name;
      let registration: ReturnType<typeof registerAgent>;
      try { registration = registerAgent({ pi: facade, name, definition: request.definition }); }
      catch (error) {
        pending.delete(reservation.id);
        pi.events?.emit('workflow:child-backend-validation-failed', { version: 1, reservationId: reservation.id });
        throw error;
      }
      try {
        const result = await execute(id, { agent: name, task: params.task, model, async: true, cwd: request.cwd, options: { context: request.context } }, signal, undefined, ctx);
        const runId = result.details?.runId ?? result.details?.asyncId;
        if (runId && !reservation.nativeId) bind({ id: runId, agent: name });
        if (runId) pi.appendEntry?.('hybrid-background-definition', { id: runId, name, definition: request.definition, cwd: request.cwd, model });
        return { ...result, details: { ...result.details, id: runId, executionMode: 'background' } };
      } finally {
        if (reservation.nativeId) pending.delete(reservation.id);
        registration.dispose();
      }
    },
  };
}
