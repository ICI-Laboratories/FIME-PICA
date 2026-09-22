import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {parseHTML} from 'linkedom';
const root = new URL('../../../', import.meta.url);
const source=readFileSync(new URL('services/landing/js/chatbot.js', root), 'utf8');
const markup=readFileSync(new URL('services/landing/index.html', root), 'utf8');
function setup(fetchImpl) {
  const {document}=parseHTML(markup);
  const timers=[];
  const context=vm.createContext({document,window:{location:{origin:'https://fime.ici-labs.com'},innerWidth:1280},URL,AbortController,TextDecoder,TypeError,fetch:fetchImpl,setTimeout(fn,delay){const t={fn,delay,cleared:false};timers.push(t);return t;},clearTimeout(t){t.cleared=true;},setInterval(){},console});
  vm.runInContext(source+`;globalThis.api={renderMarkdown,handleChat,generateResponse,createChatLi,setSending,get history(){return chatHistory},get sending(){return isSending}};`,context);
  return {document,context,api:context.api,timers};
}
function response(message){return new Response(JSON.stringify({message:{content:message}}),{headers:{'content-type':'application/json'}})}
async function tick(){await new Promise(resolve=>setImmediate(resolve));}
async function send(env,text) {
  env.document.querySelector('textarea').value=text;
  env.api.handleChat();
  env.timers.findLast(t=>t.delay===100&&!t.cleared).fn();
  for(let i=0;i<50&&env.api.sending;i++)await tick();
  assert.equal(env.api.sending,false);
}

test('HTML and unsafe URLs stay inert; official and same-origin links remain usable',()=>{
  const {api,document}=setup();const output=document.createElement('div');
  const unsafe=['javascript:alert(1)','data:text/html;base64,PHNjcmlwdD4=','https://ucol.mx.evil.example/path','https://ucol.mx@evil.example/path','//evil.example/path','http://ucol.mx/path'];
  api.renderMarkdown(output,`<img src=x onerror=alert(1)> <script>alert(1)</script>\n**Carreras**\n- [Oficial](https://www.ucol.mx/oferta-educativa/oferta-superior.htm)\n- [Mapa](/mapa?from=landing)\n${unsafe.map(url=>`[Bloqueado](${url})`).join('\n')}`);
  assert.equal(output.querySelectorAll('img,script,iframe').length,0);
  assert.equal(output.querySelectorAll('a').length,2);
  assert.equal(output.querySelector('strong').textContent,'Carreras');
  for(const a of output.querySelectorAll('a')) {assert.equal(a.target,'_blank');assert.equal(a.rel,'noopener noreferrer');}
  assert.match(output.textContent,/<img src=x onerror=alert\(1\)>/);
});

test('long history stays alternating and inside backend message/content limits',async()=>{
  const payloads=[];
  const env=setup(async (_url,options)=>{payloads.push(JSON.parse(options.body));return response('Información oficial: '+ 'á'.repeat(9000));});
  for(let i=0;i<18;i++)await send(env,`Consulta ${i}: `+'ó'.repeat(1180));
  for(const payload of payloads) {
    assert.equal(payload.messages[0].role,'user');assert.equal(payload.messages.at(-1).role,'user');
    assert.ok(payload.messages.length<=13);
    assert.ok(payload.messages.reduce((sum,item)=>sum+item.content.length,0)<=32000);
    assert.ok(Buffer.byteLength(JSON.stringify(payload))<=65536);
    payload.messages.forEach((item,i)=>assert.equal(item.role,i%2?'assistant':'user'));
  }
  assert.equal(env.api.history.length,12);
  assert.equal(env.document.querySelectorAll('.chat.outgoing').length,18);
});

test('pending requests disable controls, block duplicate send, then enable all controls',async()=>{
  let resolveFetch;let calls=0;
  const env=setup(()=>{calls++;return new Promise(resolve=>resolveFetch=resolve);});
  const input=env.document.querySelector('textarea');input.value='Carreras';env.api.handleChat();
  assert.equal(env.document.querySelector('#send-btn').disabled,true);
  assert.equal(input.disabled,true);
  for(const button of env.document.querySelectorAll('[data-question]'))assert.equal(button.disabled,true);
  assert.equal(env.document.querySelector('.chatbox').getAttribute('aria-busy'),'true');
  env.api.handleChat();
  env.timers.find(t=>t.delay===100).fn();assert.equal(calls,1);
  resolveFetch(response('Respuesta oficial'));await tick();await tick();
  assert.equal(env.api.sending,false);assert.equal(input.disabled,false);
  assert.equal(env.document.querySelector('#send-btn').disabled,false);
  for(const button of env.document.querySelectorAll('[data-question]'))assert.equal(button.disabled,false);
  assert.equal(env.document.querySelector('.chatbox').getAttribute('aria-busy'),'false');
});

test('network failure removes failed history turn and permits successful retry',async()=>{
  const payloads=[];let calls=0;
  const env=setup(async(_url,options)=>{payloads.push(JSON.parse(options.body));if(++calls===1)throw new TypeError('Failed to fetch');return response('Carreras FIME');});
  await send(env,'Pregunta que falla');
  assert.equal(env.api.history.length,0);
  assert.match(env.document.querySelector('.chat-bubble.error').textContent,/No hay conexión/);
  await send(env,'¿Qué carreras ofrece FIME?');
  assert.equal(env.api.history.length,2);
  assert.equal(payloads[1].messages.length,1);
  assert.equal(payloads[1].messages[0].content,'¿Qué carreras ofrece FIME?');
});

test('rate limiting and abort timeout restore UI without storing failed turn',async()=>{
  const limited=setup(async()=>new Response('{}',{status:429}));
  await send(limited,'Becas');assert.equal(limited.api.history.length,0);assert.match(limited.document.querySelector('.error').textContent,/Espera un minuto/);
  const timed=setup((_url,options)=>new Promise((_,reject)=>options.signal.addEventListener('abort',()=>{const err=new Error('abort');err.name='AbortError';reject(err)})));
  timed.document.querySelector('textarea').value='Becas';timed.api.handleChat();timed.timers.find(t=>t.delay===100).fn();
  timed.timers.find(t=>t.delay===20000).fn();await tick();
  assert.equal(timed.api.sending,false);assert.equal(timed.api.history.length,0);assert.match(timed.document.querySelector('.error').textContent,/tardó demasiado/);
});

test('SSE handles split UTF-8/JSON chunks and renders safe markdown',async()=>{
  const message='Mecatrónica **FIME** [sitio](https://portal.ucol.mx/fime/) <script>test</script>';
  const encoded=new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:{content:message}}]})+'\n\ndata: [DONE]\n\n');
  const stream=new ReadableStream({start(controller){for(let i=0;i<encoded.length;i+=3)controller.enqueue(encoded.slice(i,i+3));controller.close();}});
  const env=setup(async()=>new Response(stream,{headers:{'content-type':'text/event-stream'}}));
  await send(env,'Mecatrónica');
  assert.equal(env.api.history.at(-1).content,message);
  const bubble=env.document.querySelector('.chat.incoming:last-child .chat-bubble');
  assert.equal(bubble.querySelectorAll('script').length,0);assert.equal(bubble.querySelector('strong').textContent,'FIME');assert.equal(bubble.querySelectorAll('a').length,1);
});

test('map write APIs reject unauthenticated and forged-cookie requests without consuming input',async()=>{
  for(const name of ['save-space','delete-space']){
    const {POST}=await import(new URL(`services/student-hub/src/pages/api/${name}.js`, root).href);
    let read=false;const reply=await POST({request:{json(){read=true;throw new Error('must not read');}},cookies:{get(){return {value:'admin'}}}});
    assert.equal(reply.status,403);assert.equal(reply.headers.get('cache-control'),'no-store');assert.equal(read,false);
    assert.match((await reply.json()).error,/deshabilitada/);
  }
});
