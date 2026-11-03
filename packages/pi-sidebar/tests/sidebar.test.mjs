import { test } from 'node:test';
import assert from 'node:assert/strict';
const release = process.env.PI_SIDEBAR_TEST_RELEASE ?? '1.4.0';
const modules = `/Users/franciscruz/.pi/agent/install/releases/${release}/node_modules/`;
const { createJiti } = await import(modules + 'jiti/lib/jiti.mjs');
const root = modules + '@earendil-works/';
const jiti = createJiti(import.meta.url, { alias: { '@earendil-works/pi-tui': root + 'pi-tui/dist/index.js' } });
const { attachSidebar, columns, joinColumns } = await jiti.import('../layout.ts');
const { visibleWidth, CURSOR_MARKER, TuiMainScreen, TuiAltScreen, Container } = await import(root + 'pi-tui/dist/index.js');
function installFooter(container) {
  const statuses = new Map([['workflow','Workflow active'],['background','Background running']]);
  const footer = {session:{state:{model:{id:'test-model',provider:'test-provider'},thinkingLevel:'high'}},footerData:{getExtensionStatuses:()=>statuses},render:()=>['NATIVE PATH','R999 W888 CH50%','Workflow active Background running'],invalidate(){}};
  container.children = [footer];
  return {footer,statuses};
}
function fixture() {
  const marker = {render: () => [], invalidate() {}};
  let content = 'GOAL';
  const widget = {render: w => [content + ' ' + w], invalidate() {}};
  const above = {children: [marker, widget], render(w) {return this.children.flatMap(c => c.render(w));}, invalidate() {}};
  const children = Array.from({length:7}, () => ({render: w => ['chat ' + w], invalidate() {}}));
  children[3] = above;
  children[5] = new Container();
  children[6] = new Container(); installFooter(children[6]);
  children[4] = {render: w => ['edit' + CURSOR_MARKER], invalidate() {}};
  const host = {mode:'regular', children, terminal:{rows:24}, focusedComponent: children[4], render(w) {return this.children.flatMap(c => c.render(w));}, invalidate() {}, requestRender() {}};
  return {host, marker, above, widget, update: value => content = value};
}
test(`real Pi ${release} TuiMainScreen and Container render integration`, () => {
  const terminal = {rows:30,columns:120,write(){}};
  const host = new TuiMainScreen(terminal,false);
  // Avoid scheduling terminal IO: this test exercises the actual render tree only.
  host.requestRender = () => {};
  const marker = {render:()=>[],invalidate(){}};
  const above = new Container(); above.addChild(marker);
  let value = 'live goal';
  above.addChild({render:w=>[value+' '+w],invalidate(){}});
  for(let i=0;i<7;i++) host.addChild(i===3 ? above : new Container());
  installFooter(host.children[6]);
  const editor = {focused:false,render:()=>['prompt'+CURSOR_MARKER],invalidate(){},handleInput(){}};
  host.children[4].addChild(editor); host.setFocus(editor);
  const original = host.render;
  const ctl = attachSidebar(host,marker); assert.ok(ctl);
  assert.match(host.render(120).join('\n'),/live goal 30/);
  value='updated'; assert.match(host.render(120).join('\n'),/updated 30/);
  assert.equal(host.getFocusedComponent(),editor); assert.equal(editor.focused,true);
  ctl.dispose(); assert.equal(host.render,original);
});
test('fullscreen real viewport: resize, empty, mouse, keyboard, cursor and cleanup', async () => {
  const {createChatViewport} = await jiti.import(root + 'pi-coding-agent/dist/modes/interactive/chat-viewport.js');
  const {renderLayoutFrame, getScrollViewBox} = await import(root + 'pi-tui/dist/layout.js');
  const terminal = {rows:30,columns:120,write(){}};
  const host = new TuiAltScreen(terminal,false); host.requestRender = () => {};
  const children = Array.from({length:7},()=>new Container()); children.forEach(c=>host.addChild(c));
  installFooter(children[6]);
  const marker = {render:()=>[],invalidate(){}};
  let belowValue='Observer off';
  children[5].addChild({render:()=>[belowValue,'/observer on'],invalidate(){}});
  children[2].addChild({render:()=>['Working Esc cancel'],invalidate(){}});
  let value='goal'; children[3].addChild(marker);
  children[3].addChild({render:w=>value ? [value+' '+w] : [],invalidate(){}});
  children[0].addChild({render:w=>Array.from({length:100},(_,i)=>'chat '+i+' '+w),invalidate(){}});
  let typed=''; let mouse;
  const editor = {focused:false,render:w=>['prompt '+w+CURSOR_MARKER],invalidate(){},handleInput(data){typed+=data},handleMouse(e){mouse=e;return {handled:true,render:false}}};
  children[4].addChild(editor);
  const viewport = createChatViewport({document:children[0],pendingMessages:children[1],status:children[2],widgetsAbove:children[3],editor:children[4],widgetsBelow:children[5],footer:children[6]});
  host.setLayoutRoot(viewport.root); host.setFocus(editor);
  const originalAbove=children[3].render, originalFooter=children[6].render, originalBelow=children[5].render;
  let contextUsage={tokens:24800,percent:12};
  const ctl=attachSidebar(host,marker,undefined,()=>contextUsage); assert.ok(ctl); assert.notEqual(host.layoutRoot,viewport.root);
  function frame(w,h=30) { terminal.columns=w; terminal.rows=h; const f=renderLayoutFrame(host.layoutRoot,w,h,()=>{}); host.currentLayout=f; return f; }
  let f=frame(120); assert.equal(f.primaryScrollView,viewport.transcript);
  assert.equal(getScrollViewBox(f,viewport.transcript).rect.width,84);
  assert.ok(f.lines.some(l=>l.includes(CURSOR_MARKER))); assert.match(f.lines.join('\n'),/goal 30/);
  assert.equal(f.lines.length,30); assert.ok(f.lines.every(l=>visibleWidth(l)<=120));
  assert.match(plain(f.lines.join('\n')),/test-model · high/);
  assert.match(plain(f.lines.join('\n')),/Workflow active/);
  assert.doesNotMatch(plain(f.lines.join('\n')),/R999|W888|CH50/);
  assert.equal(host.getFocusedComponent(),editor); assert.equal(host.isComponentMounted(editor),true);
  assert.ok(getScrollViewBox(f,viewport.transcript).rect.height >= 25);
  assert.match(host.render(120).join('\n'),/goal 30/);
  host.handleTerminalInput('x'); assert.equal(typed,'x');
  function findBox(box, component) { if(box.component===component)return box; for(const child of box.children){const found=findBox(child,component);if(found)return found;} }
  const editorBox=findBox(f.root,children[4]);
  host.dispatchMouseToLayout(host.createMouseEvent('press',0,2,editorBox.rect.y)); assert.equal(mouse.width,84); assert.equal(mouse.x,2);
  const scroll=viewport.transcript.scrollTop;
  host.handleViewportInput('\x1b[<64;110;2M'); assert.equal(viewport.transcript.scrollTop,scroll);
  host.handleViewportInput('\x1b[<64;2;2M'); assert.ok(viewport.transcript.scrollTop<scroll);
  for (const width of [79,80,90,99,100,90,79,100]) {
    f=frame(width,36); const size=columns(width,true);
    assert.equal(getScrollViewBox(f,viewport.transcript).rect.width,size.chat);
    assert.ok(f.lines.some(l=>l.includes(CURSOR_MARKER)));
    assert.equal(host.getFocusedComponent(),editor);
    assert.ok(f.lines.every(l=>visibleWidth(l)<=width));
    if(size.side) {
      assert.match(f.lines.map(l=>plain(l).slice(0,size.chat)).join('\n'),/24\.8k · 12%/);
      assert.doesNotMatch(f.lines.map(l=>plain(l).slice(size.chat+2)).join('\n'),/Context|24\.8k|12%/);
    }
    assert.match(plain(f.lines.join('\n')),/Observer off/);
    assert.match(plain(f.lines.join('\n')),/Working Esc cancel/);
    if(size.side) {
      assert.doesNotMatch(f.lines.map(l=>plain(l).slice(0,size.chat)).join('\n'),/Observer off|observer on/);
      assert.doesNotMatch(f.lines.join('\n'),/R999 W888/);
    } else assert.match(f.lines.join('\n'),/R999 W888/);
    const box=findBox(f.root,children[4]);
    host.dispatchMouseToLayout(host.createMouseEvent('press',0,2,box.rect.y));
    assert.equal(mouse.width,size.chat); assert.equal(mouse.x,2);
  }
  contextUsage={tokens:0,percent:0}; f=frame(80,36); assert.match(f.lines.map(plain).join('\n'),/0 · 0%/);
  contextUsage=undefined; f=frame(80,36); assert.match(f.lines.map(plain).join('\n'),/Tokens \? · Usage \?/);
  belowValue='Observer live'; f=frame(90,36); assert.match(f.lines.join('\n'),/Observer live/);
  const belowComponent=children[5].children[0], belowRender=belowComponent.render;
  belowComponent.render=()=>{throw new Error('below render failure')};
  assert.throws(()=>frame(90,36),/below render failure/);
  belowComponent.render=belowRender;
  f=frame(90,36); assert.match(f.lines.join('\n'),/Observer live/);
  f=frame(79,18); assert.equal(getScrollViewBox(f,viewport.transcript).rect.width,79); assert.match(f.lines.join('\n'),/goal/); assert.match(f.lines.join('\n'),/R999 W888/);
  value=''; f=frame(120); assert.equal(getScrollViewBox(f,viewport.transcript).rect.width,84);
  value='updated'; f=frame(150,35); assert.equal(getScrollViewBox(f,viewport.transcript).rect.width,114); assert.match(f.lines.join('\n'),/updated/);
  ctl.toggle(); f=frame(120); assert.equal(getScrollViewBox(f,viewport.transcript).rect.width,120);
  assert.doesNotMatch(f.lines.join('\n'),/updated|Observer live|observer on|R999|NATIVE PATH|Workflow active|Background running/);
  assert.match(f.lines.join('\n'),/Working Esc cancel/);
  assert.match(plain(f.lines.join('\n')),/Tokens \? · Usage \?  test-model · high/);
  contextUsage={tokens:31000,percent:15}; f=frame(120);
  assert.match(plain(f.lines.join('\n')),/31k · 15%  test-model · high/);
  ctl.toggle(); f=frame(120);
  assert.match(plain(f.lines.join('\n')),/31k · 15%  test-model · high/);
  assert.doesNotMatch(f.lines.join('\n'),/R999 W888/);
  ctl.dispose(); ctl.dispose(); assert.equal(host.layoutRoot,viewport.root); assert.equal(children[3].render,originalAbove); assert.equal(children[6].render,originalFooter); assert.equal(children[5].render,originalBelow); assert.equal(host.getFocusedComponent(),editor);
  assert.match(children[5].render(79).join('\n'),/Observer live/);
  const ctl2=attachSidebar(host,marker); assert.ok(ctl2);
  const later=()=>['later below adapter']; children[5].render=later;
  f=frame(90,36);
  assert.equal(getScrollViewBox(f,viewport.transcript).rect.width,90);
  assert.match(f.lines.join('\n'),/later below adapter/); assert.match(f.lines.join('\n'),/R999 W888/);
  assert.match(f.lines.join('\n'),/updated 90/);
  ctl2.dispose(); assert.equal(children[5].render,later);
  assert.equal(children[3].render,originalAbove); assert.equal(children[6].render,originalFooter);
});
test('regular empty widgets retain sidebar identity without Context', () => {
  const f=fixture(); f.widget.render=()=>[];
  const ctl=attachSidebar(f.host,f.marker); assert.match(f.host.render(120).join('\n'),/Pi/); assert.doesNotMatch(f.host.render(120).join('\n'),/Context/); assert.match(f.host.render(120).join('\n'),/chat 84/); ctl.dispose();
});
test('width limits, ANSI, unicode and cursor marker', () => {
  for (const width of [0,1,40,79,80,90,99,100,120,200]) {
    const size = columns(width,true);
    assert.ok(size.chat >= 0);
    assert.equal(size.side === 0, width < 80);
    if(width >= 80 && width < 100) assert.deepEqual(size,{chat:width-28,side:26});
    if (size.side) {
      const lines = joinColumns(['\x1b[31m界é👩‍💻' + CURSOR_MARKER], ['\x1b[32m界'.repeat(60)],size.chat,size.side);
      assert.ok(lines.every(l => visibleWidth(l) <= width));
      assert.ok(lines[0].includes(CURSOR_MARKER));
    }
  }
});
test('live updates, toggle, narrow, focus and reversible cleanup', () => {
  const f = fixture(), original = f.host.render, aboveRender = f.above.render, focus = f.host.focusedComponent;
  const ctl = attachSidebar(f.host, f.marker);
  assert.ok(ctl);
  assert.match(f.host.render(120).join('\n'), /GOAL 30/);
  assert.equal(f.above.render,aboveRender);
  f.update('TODO UPDATED');
  assert.match(f.host.render(120).join('\n'), /TODO UPDATED/);
  ctl.toggle();
  const hidden = f.host.render(120).join('\n');
  assert.match(hidden,/chat 120/); assert.doesNotMatch(hidden,/TODO|R999|NATIVE PATH|Workflow active|Background running/);
  assert.match(plain(hidden),/Tokens \? · Usage \?  test-model · high/);
  ctl.toggle();
  assert.match(f.host.render(99).join('\n'),/TODO/);
  assert.equal(f.host.focusedComponent,focus);
  assert.ok(f.host.render(120).join('\n').includes(CURSOR_MARKER));
  ctl.dispose(); ctl.dispose();
  assert.equal(f.host.render,original);
  assert.match(f.host.render(120).join('\n'),/TODO UPDATED/);
});
test('fullscreen/unknown layouts fail closed, mode switch leaves widgets intact', () => {
  const f = fixture(); f.host.mode = 'fullscreen';
  assert.equal(attachSidebar(f.host,f.marker),undefined);
  f.host.mode = 'regular'; const ctl = attachSidebar(f.host,f.marker);
  f.host.mode = 'fullscreen';
  assert.match(f.host.render(120).join('\n'), /GOAL 120/);
  ctl.dispose(); f.host.children.pop();
  assert.equal(attachSidebar(f.host,f.marker),undefined);
});
test('exceptions restore widget render and tall panels remain bounded', () => {
  const f = fixture();
  f.host.render = () => {throw new Error('render failure')};
  const originalAbove = f.above.render, originalBelow = f.host.children[5].render, originalFooter = f.host.children[6].render;
  const ctl = attachSidebar(f.host,f.marker);
  assert.throws(() => f.host.render(120), /render failure/);
  assert.equal(f.above.render,originalAbove); assert.equal(f.host.children[5].render,originalBelow); assert.equal(f.host.children[6].render,originalFooter); ctl.dispose();
  const g = fixture(); g.widget.render = () => Array(100).fill('task');
  const c = attachSidebar(g.host,g.marker);
  assert.equal(g.host.render(120).length,24); c.dispose();
});
test('extension starts hidden, toggles via command/shortcut and resets on reload', async () => {
  const extension = (await jiti.import('../index.ts')).default;
  const events = new Map(), commands = new Map(), shortcuts = new Map();
  extension({events:{on:()=>()=>{},emit(){}},on:(k,v)=>events.set(k,v),registerCommand:(k,v)=>commands.set(k,v),registerShortcut:(k,v)=>shortcuts.set(k,v)});
  const f = fixture(), original = f.host.render;
  const notifications=[];
  const ctx = {mode:'tui', ui:{setWidget(key,content) {f.above.children = f.above.children.filter(c => c !== this.marker); if(content) {this.marker = content(f.host); f.above.children.push(this.marker);}},notify(message){notifications.push(message)}}};
  let usage={tokens:24800,percent:12}; ctx.getContextUsage=()=>usage;
  events.get('session_start')({},ctx);
  assert.match(f.host.render(80).map(plain).join('\n'),/24\.8k · 12%/);
  usage={tokens:0,percent:0}; assert.match(f.host.render(80).map(plain).join('\n'),/0 · 0%/);
  assert.notEqual(f.host.render,original);
  const hidden=plain(f.host.render(120).join('\n'));
  assert.doesNotMatch(hidden,/GOAL|R999|NATIVE PATH/);
  assert.match(hidden,/0 · 0%  test-model · high/);
  assert.match(hidden,/chat 120/);
  await commands.get('sidebar').handler('',ctx);
  assert.match(notifications.at(-1),/below 80 columns/);
  assert.match(f.host.render(120).join('\n'),/GOAL/);
  await shortcuts.get('ctrl+shift+b').handler(ctx);
  assert.match(notifications.at(-1),/Sidebar hidden/);
  assert.doesNotMatch(f.host.render(120).join('\n'),/GOAL/);
  await commands.get('sidebar').handler('',ctx);
  events.get('session_shutdown')(); assert.equal(f.host.render,original);
  assert.equal(f.above.children.length,2);
  events.get('session_start')({},ctx);
  assert.doesNotMatch(f.host.render(120).join('\n'),/GOAL/);
  events.get('session_shutdown')();
  assert.equal(f.host.render,original);
});

const { createPanel, normalizeWidgets } = await jiti.import('../panel.ts');
const { stripVTControlCharacters: plain } = await import('node:util');
const { homedir } = await import('node:os');
test('clean panel: full height, surface, padding, labeled cost and bottom path', () => {
  const theme = {fg: (_token, s) => `\x1b[37m${s}\x1b[0m`, bold: s => `\x1b[1m${s}\x1b[0m`};
  const render = createPanel(() => ({ title:'Session title', cwd:homedir()+'/project', spent:0.05,theme }));
  const lines=render(34,24,['╭── Goal ──╮','│ ✓ Keep status │','╰──────────╯']);
  assert.equal(lines.length,24); assert.ok(lines.every(l=>visibleWidth(l)===34));
  assert.ok(lines.every(l=>l.startsWith('\x1b[48;2;25;27;32m')));
  assert.ok(lines.every(l=>! /\x1b\[0m(?!\x1b\[48|$)/.test(l)));
  assert.equal(plain(lines[0]),' '.repeat(34));
  assert.equal(plain(lines[1]),'  Session title'+' '.repeat(19));
  assert.doesNotMatch(lines.join('\n'),/Context|8\.8k|1%/); assert.match(lines.join('\n'),/Cost/); assert.match(lines.join('\n'),/\$0.05 spent/);
  assert.equal(plain(lines.at(-1)).trim(),'~/project');
  assert.match(plain(lines.join('\n')),/Goal/); assert.match(plain(lines.join('\n')),/✓ Keep status/);
  assert.doesNotMatch(plain(lines.join('\n')),/[╭╮╰╯│─]/);
});
test('sidebar cost availability, fallback title and live reads', () => {
  let state={cwd:'/tmp/project'};
  const render=createPanel(()=>state);
  let text=plain(render(34,18,[]).join('\n'));
  assert.match(text,/project/); assert.doesNotMatch(text,/Tokens|Usage|Context|Cost|spent|% used/);
  state={...state,spent:0};
  text=plain(render(34,18,[]).join('\n'));
  assert.doesNotMatch(text,/Context|0 · 0%/); assert.match(text,/Cost/); assert.match(text,/\$0.00 spent/);
});
test('raw border normalization retains headings, status, useful text and section gaps', () => {
  assert.deepEqual(normalizeWidgets(['\x1b[31m╭── Goal ──╮\x1b[0m','│ Fix render │','│ ✓ task done │','╰──────────╯','','Todos','[ ] next','Ctrl+B toggle details']),['Goal','Fix render','✓ task done','','Todos','[ ] next']);
  assert.deepEqual(normalizeWidgets(['╭─ pi-goal-x ─ Build a sidebar ─╮', '╰─ Ctrl+Shift+T: expand tasks ─╯']), ['Goal · Build a sidebar']);
});
test('long widget content wraps instead of silently clipping', () => {
  const phrase = 'Verify rendering in both narrow and wide terminal layouts';
  const lines = createPanel(() => ({cwd:'/tmp/project'}))(34, 24, [phrase]).map(plain);
  const content = lines.slice(0, -1).map(line => line.trim()).join(' ');
  assert.ok(content.includes(phrase));
  assert.ok(lines.every(line => visibleWidth(line) === 34));
});

test('compact footer moves live statuses, omits cache counters, keeps working and exact fallback', () => {
  const f=fixture(), footer=f.host.children[6], original=footer.render;
  f.host.children[2].render=()=>['Working · Esc cancel'];
  f.host.children[5].render=()=>[];
  const statuses=footer.children[0].footerData.getExtensionStatuses();
  const ctl=attachSidebar(f.host,f.marker);
  let lines=f.host.render(140).map(plain), text=lines.join('\n');
  assert.match(text,/test-model · high/); assert.match(text,/test-provider/);
  assert.match(text,/Workflow active/); assert.match(text,/Background running/);
  assert.match(text,/Working · Esc cancel/); assert.doesNotMatch(text,/R999|W888|CH50/);
  assert.match(lines[lines.findIndex(l=>l.includes('edit'))+1],/test-model · high/);
  statuses.set('workflow','Workflow updated');
  footer.children[0].session.state.thinkingLevel='low';
  text=plain(f.host.render(140).join('\n'));
  assert.match(text,/Workflow updated/); assert.match(text,/test-model · low/);
  assert.equal(footer.render,original);
  for (const width of [79,60]) {
    text=plain(f.host.render(width).join('\n'));
    assert.match(text,/GOAL/); assert.match(text,/R999 W888 CH50%/);
  }
  ctl.toggle(); assert.doesNotMatch(f.host.render(140).join('\n'),/NATIVE PATH|R999|Workflow active|Background running/);
  ctl.dispose(); assert.equal(footer.render,original);
});
test('actual installed FooterComponent identity is supported and preserved', async () => {
  const {FooterComponent}=await jiti.import(root+'pi-coding-agent/dist/modes/interactive/components/footer.js');
  const f=fixture(), container=f.host.children[6];
  const component=new FooterComponent({state:{model:{id:'real-footer-model',provider:'provider'},thinkingLevel:'medium'}}, {getExtensionStatuses:()=>new Map([['status','Real provider status']])});
  container.children=[component]; const render=component.render;
  const ctl=attachSidebar(f.host,f.marker); assert.ok(ctl);
  const text=plain(f.host.render(140).join('\n'));
  assert.match(text,/real-footer-model · medium/); assert.match(text,/Real provider status/);
  ctl.dispose(); assert.equal(component.render,render); assert.equal(container.children[0],component);
});
test('blue user message surfaces cannot tint sidebar; context removed', () => {
  const lines=createPanel(()=>({theme:{colors:{userMessageBg:'#0000ff'}}}))(34,20,[]);
  assert.ok(lines.every(l=>l.startsWith('\x1b[48;2;25;27;32m')));
  assert.doesNotMatch(plain(lines.join('\n')),/Context|24\.8k · 12%/);
});
test('below widgets preserve text, update live, restore on fallback and guard replacement', () => {
  const f=fixture(), below=f.host.children[5], original=below.render;
  let value='Observer off /observer on';
  below.addChild({render:()=>[value,'Ctrl+B toggle details'],invalidate(){}});
  let received;
  const panel=createPanel(()=>({}));
  const ctl=attachSidebar(f.host,f.marker,(w,h,a,d,b)=>{received=b; return panel(w,h,a,d,b)});
  for(const width of [79,80,90,99,100]) {
    const lines=f.host.render(width).map(plain), text=lines.join('\n');
    if(width>=80) {
      assert.deepEqual(received,[value,'Ctrl+B toggle details']);
      const chat=columns(width,true).chat;
      assert.doesNotMatch(lines.map(l=>l.slice(0,chat)).join('\n'),/Observer|observer on|Ctrl\+B/);
      assert.match(text,/Ctrl\+B toggle details/);
    } else assert.match(text,/Observer off \/observer on/);
    assert.equal(below.render,original);
  }
  value='Observer running'; assert.match(f.host.render(100).join('\n'),/Observer running/);
  ctl.toggle(); assert.doesNotMatch(f.host.render(100).join('\n'),/Observer running|Ctrl\+B|GOAL|R999/);
  ctl.toggle();
  const replacement=new Container(); replacement.addChild({render:()=>['replacement below'],invalidate(){}});
  f.host.children[5]=replacement;
  assert.match(f.host.render(100).join('\n'),/replacement below/);
  assert.match(f.host.render(100).join('\n'),/R999 W888/);
  ctl.dispose(); assert.equal(below.render,original);
});
test('extension reads live Conductor branch data without changing task state', async () => {
  const extension=(await jiti.import('../index.ts')).default, events=new Map(), commands=new Map();
  extension({events:{on:()=>()=>{},emit(){}},on:(key,handler)=>events.set(key,handler),registerCommand:(key,command)=>commands.set(key,command),registerShortcut(){}});
  const f=fixture(); f.host.terminal.rows=60;
  installFooter(f.host.children[6]).statuses.set('automatic-workflows','Conductor · Plan · selected');
  const task={taskId:'test',projectRoot:'/tmp/project',route:'plan',scope:'Review the layout',stage:'selected'};
  let branch=[{type:'custom',customType:'automatic-workflows',data:{schemaVersion:1,action:'selected',task}}];
  const ctx={cwd:'/tmp/project',mode:'tui',sessionManager:{getBranch:()=>branch,getEntries:()=>[]},ui:{
    setWidget(key,content){if(content) {this.marker=content(f.host); f.above.children.push(this.marker);} else f.above.children=f.above.children.filter(c=>c!==this.marker);},notify(){}
  }};
  events.get('session_start')({},ctx);
  await commands.get('sidebar').handler('',ctx);
  assert.match(plain(f.host.render(120).join('\n')),/Review the layout/);
  branch=[...branch,{type:'custom',customType:'automatic-workflows',data:{schemaVersion:1,action:'updated',task:{...task,scope:'Updated layout goal',stage:'verification'}}}];
  const updated=plain(f.host.render(120).join('\n'));
  assert.match(updated,/Updated layout goal/);
  assert.doesNotMatch(updated,/Stage|Latest check|Why this playbook|verification/);
  assert.equal(task.scope,'Review the layout');
  branch=[];
  assert.doesNotMatch(plain(f.host.render(120).join('\n')),/Review the layout|Playbook/);
  events.get('session_shutdown')();
});
test('Conductor fields use current branch snapshots, optional data and settings', async () => {
  const {conductorFields}=await jiti.import('../conductor.ts');
  const task={taskId:'a',projectRoot:'/tmp/project',route:'bug-fix',scope:'Fix the sidebar',stage:'verify',reason:'A reproducible defect',constraints:['Read only'],verification:[{result:'passed',check:'Sidebar tests'}],externalState:'pending-review',waits:[{status:'scheduled',check:'Review response'},{status:'cancelled',check:'Old response'}]};
  const record=(action,task)=>({type:'custom',customType:'automatic-workflows',data:{schemaVersion:1,action,task}});
  const branch=[record('selected',task),record('updated',{...task,stage:'implementation'})];
  assert.deepEqual(conductorFields(branch,'/tmp/project'),[
    {label:'Playbook',lines:['Bug fix']},{label:'Goal',lines:['Fix the sidebar']},
    {label:'Constraints',lines:['Read only']},
    {label:'Waiting on',lines:['pending-review','scheduled · Review response']},
  ]);
  assert.deepEqual(conductorFields(branch,'/other'),[]);
  assert.deepEqual(conductorFields([],'/tmp/project'),[]);
  assert.deepEqual(conductorFields([record('updated',task)],'/tmp/project'),[]);
  const next={taskId:'b',projectRoot:'/tmp/project',route:'plan',scope:'Next goal',stage:'selected'};
  const switched=[...branch,record('selected',next),record('updated',task)];
  assert.deepEqual(conductorFields(switched,'/tmp/project').map(f=>f.label),['Playbook','Goal']);
  assert.equal(conductorFields(switched,'/tmp/project')[1].lines[0],'Next goal');
  assert.deepEqual(conductorFields([...branch,{type:'custom',customType:'automatic-workflows',data:{schemaVersion:1,action:'setting',enabled:false}}],'/tmp/project'),[]);
  assert.doesNotThrow(()=>conductorFields([null,record('selected',{...next,constraints:[null,1],verification:[null],waits:[null]})],'/tmp/project'));
});
test('detailed Conductor fields wrap, hide unavailable data and never orphan labels', () => {
  const state={cwd:'/tmp/project',conductor:[{label:'Playbook',lines:['Architect']},{label:'Goal',lines:['Keep the current sidebar clear']},{label:'Constraints',lines:['Display only']},{label:'Waiting on',lines:['approval-needed']}]};
  const render=createPanel(()=>state), details={model:['test'],conductor:['Conductor · Architect · selected'],activity:['Background running']};
  for(const width of [26,34]) {
    const lines=render(width,50,[],details,['Observer off']), text=plain(lines.join('\n'));
    let previous=-1;
    for(const label of ['Model','Conductor','Playbook','Goal','Constraints','Waiting on','Activity','Workspace']) {
      const index=lines.findIndex(line=>plain(line).trim()===label);
      assert.ok(index>previous,label); previous=index;
      assert.ok(lines[index].includes('\x1b[1m'+label+'\x1b[22m'));
    }
    assert.doesNotMatch(text,/Stage|Latest check|Why this playbook|Conductor · Architect/);
    assert.match(text,/Display only/); assert.match(text,/Background running/);
    for(let height=1;height<=35;height++) {
      const small=render(width,height,[],details).map(line=>plain(line).trim());
      assert.equal(small.length,height);
      for(const label of ['Conductor','Playbook','Goal','Constraints','Waiting on']) {
        const index=small.indexOf(label);
        if(index>=0) assert.ok(small[index+1] && !/^(?:…|Workspace$)/.test(small[index+1]),label);
      }
    }
    state.conductor[1].lines=['Long goal '.repeat(50)];
    const long=render(width,50,[],details);
    assert.ok(long.every(line=>visibleWidth(line)===width));
    assert.match(plain(long.join('\n')),/…/); assert.match(plain(long.join('\n')),/\/conductor status/);
    assert.match(plain(long.join('\n')),/Display only/);
    state.conductor[1].lines=['Keep the current sidebar clear'];
    assert.doesNotMatch(plain(render(width,50,[],{...details,conductor:[]}).join('\n')),/Playbook|Display only/);
    const off=plain(render(width,50,[],{...details,conductor:['Conductor:off']}).join('\n'));
    assert.match(off,/Conductor:off/); assert.doesNotMatch(off,/Playbook|Display only/);
  }
});
test('Conductor status is grouped by extension key and updates live', async () => {
  const {nativeFooter}=await jiti.import('../footer.ts');
  const container=new Container(), {statuses}=installFooter(container);
  const native=nativeFooter(container);
  statuses.set('other','Conductor mentioned elsewhere');
  for(const status of ['Conductor:auto','Conductor:off','Conductor · Architect · verification']) {
    statuses.set('automatic-workflows',status);
    const details=native.details();
    assert.deepEqual(details.conductor,[status]);
    assert.deepEqual(details.activity,['Background running','Conductor mentioned elsewhere','Workflow active']);
  }
  statuses.delete('automatic-workflows');
  assert.deepEqual(native.details().conductor,[]);
  statuses.set('automatic-workflows','');
  const text=plain(createPanel(()=>({}))(26,30,[],native.details()).join('\n'));
  assert.ok(!text.split('\n').some(line=>line.trim()==='Conductor'));
});
test('semantic sections have ordered bold headings and no empty or duplicate headings', async () => {
  const {nativeFooter}=await jiti.import('../footer.ts');
  const container=new Container(), {footer,statuses}=installFooter(container);
  statuses.set('automatic-workflows','Conductor · Architect · verification');
  footer.session.routedModel={model:{provider:'routed',id:'destination'},thinkingLevel:'low'};
  const details=nativeFooter(container).details();
  assert.deepEqual(details.model,['test-provider/test-model','→ routed/destination · low']);
  assert.deepEqual(details.activity,['Background running','Workflow active']);
  const render=createPanel(()=>({cwd:'/tmp/project',spent:0.05}));
  for(const width of [26,34]) {
    const lines=render(width,45,['[ ] keep task'],details,['Observer off /observer on']);
    const text=plain(lines.join('\n'));
    const headings=['Cost','Model','Conductor','Activity','Tasks','Workspace'];
    let previous=-1;
    for(const heading of headings) {
      const index=lines.findIndex(l=>plain(l).trim()===heading);
      assert.ok(index>previous,heading); previous=index;
      assert.ok(lines[index].includes('\x1b[1m'+heading+'\x1b[22m'),heading+' bold');
    }
    assert.match(text,/\$0.05 spent/);
    assert.equal(plain(lines.at(-2)).trim(),'Workspace');
    assert.equal(plain(lines.at(-1)).trim(),'/tmp/project');
    const labeled=plain(render(width,45,['Goal','Build sidebar','','Todos','[ ] next'],details,[]).join('\n'));
    assert.doesNotMatch(labeled,/\n  Tasks\s*\n/);
    assert.equal(labeled.split('\n').filter(l=>l.trim()==='Goal').length,1);
    const empty=plain(createPanel(()=>({}))(width,20,[],{model:[],activity:[]},['']).join('\n'));
    assert.doesNotMatch(empty,/Model|Conductor|Activity|Tasks|Workspace/);
    for(let height=1;height<=12;height++) {
      const small=render(width,height,['Goal','Task content'],details,['Observer']);
      assert.equal(small.length,height); assert.ok(small.every(l=>visibleWidth(l)===width));
      assert.equal(plain(small.at(-1)).trim(),'/tmp/project');
      if(height>=2) assert.equal(plain(small.at(-2)).trim(),'Workspace');
      const rows=small.map(l=>plain(l).trim());
      for(let i=0;i<rows.length;i++) if(['Cost','Model','Conductor','Activity','Tasks','Goal','Todos'].includes(rows[i])) {
        assert.ok(rows[i+1] && !/^(?:…|Workspace$)/.test(rows[i+1]),'no orphan '+rows[i]);
      }
    }
  }
});
test('live context belongs to compact chat footer, never sidebar, with Cost heading', async () => {
  const f=fixture(); let usage={tokens:24800,percent:12};
  const ctl=attachSidebar(f.host,f.marker,createPanel(()=>({spent:0.25})),()=>usage);
  for(const width of [80,100,140]) {
    const size=columns(width,true), rows=f.host.render(width).map(plain);
    const chat=rows.map(l=>l.slice(0,size.chat)).join('\n');
    const side=rows.map(l=>l.slice(size.chat+2)).join('\n');
    assert.match(chat,/24\.8k · 12%/); assert.doesNotMatch(side,/Context|24\.8k|12%/);
    assert.match(side,/Cost/); assert.match(side,/\$0.25 spent/);
    const footer=rows[rows.findIndex(l=>l.startsWith('edit'))+1];
    assert.match(footer,/24\.8k · 12%/);
  }
  usage={tokens:0,percent:0}; assert.match(f.host.render(80).map(plain).join('\n'),/0 · 0%/);
  usage=undefined; assert.match(f.host.render(80).map(plain).join('\n'),/Tokens \? · Usage \?/);
  ctl.toggle();
  let hidden=f.host.render(80).map(plain).join('\n');
  assert.match(hidden,/Tokens \? · Usage \?  test-model · high/);
  assert.doesNotMatch(hidden,/R999|NATIVE PATH|GOAL|Workflow active|Background running|Cost|\$0.25/);
  assert.equal(hidden.split('\n').length,5);
  assert.doesNotMatch(f.host.render(60).map(plain).join('\n'),/R999|GOAL|Workflow active/);
  usage={tokens:31000,percent:15}; hidden=f.host.render(80).map(plain).join('\n');
  assert.match(hidden,/31k · 15%  test-model · high/);
  ctl.toggle();
  const shown=f.host.render(80).map(plain).join('\n');
  assert.match(shown,/31k · 15%  test-model · high/);
  assert.doesNotMatch(shown,/R999 W888/);
  ctl.dispose();
  const {nativeFooter}=await jiti.import('../footer.ts');
  f.host.children[6].children[0].session.state.model.id='very-long-model-name-'.repeat(8);
  const native=nativeFooter(f.host.children[6],()=>({tokens:24800,percent:12}));
  const lines=native.render(52); assert.equal(lines.length,1);
  assert.ok(visibleWidth(lines[0])<=52); assert.match(plain(lines[0]),/24\.8k · 12%/);
  assert.ok(lines[0].startsWith('\x1b[90m'));
  for(const value of [undefined,{tokens:null,percent:null},{tokens:NaN,percent:Infinity}]) {
    const unknown=nativeFooter(f.host.children[6],()=>value).render(52);
    assert.match(plain(unknown[0]),/Tokens \? · Usage \?/);
  }
});
test('custom footer and replaced native footer fail safe without losing widgets', () => {
  const f=fixture(); f.host.children[6].children=[{render:()=>['custom'],invalidate(){}}];
  const original=f.host.render;
  assert.equal(attachSidebar(f.host,f.marker),undefined); assert.equal(f.host.render,original);
  const g=fixture(), ctl=attachSidebar(g.host,g.marker);
  g.host.children[6].children=[{render:()=>['replacement footer'],invalidate(){}}];
  assert.match(g.host.render(120).join('\n'),/replacement footer/);
  assert.match(g.host.render(120).join('\n'),/GOAL 120/); ctl.dispose();
});
