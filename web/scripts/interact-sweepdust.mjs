// Serves the committed production export at /preview/ and exercises isolated, simulated
// EIP-6963/RPC/indexer fixtures. No real wallet, signature, transaction or balance is used.
// IMD_PLAYWRIGHT=/path/to/playwright/index.mjs node --experimental-strip-types web/scripts/interact-sweepdust.mjs [--webkit]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { parseAbi, decodeFunctionData, encodeFunctionResult, encodeAbiParameters, decodeAbiParameters, parseAbiParameters, encodeEventTopics, parseUnits, toHex, keccak256 } from 'viem';
import { erc20Abi } from '../src/abi/erc20.ts';
import { swarmExitAbi } from '../src/abi/swarmExit.ts';
import { poolId, POOL_MANAGER, PERMIT2, UNIVERSAL_ROUTER, V4_QUOTER, STATE_VIEW, quoterAbi, stateAbi } from '../src/lib/routes.ts';
import { V2_FACTORY, V3_FACTORY, v2FactoryAbi, v3FactoryAbi } from '../src/lib/markets.ts';
import { routerAbi, permitAbi, transferAbi } from '../src/lib/directSale.ts';
import { IMD_ADDRESS as IMD, SWARM_EXIT_ADDRESS as EXIT, TREASURY_ADDRESS } from '../src/deployment.ts';
import { REGISTRIES } from '../src/lib/discovery.ts';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const ENGINE=process.argv.includes('--webkit')?'webkit':'chromium';
const OUT=path.join(ROOT,`test/scratch/sweepdust-${ENGINE}`);fs.mkdirSync(OUT,{recursive:true});
const pw=await import(process.env.IMD_PLAYWRIGHT?pathToFileURL(process.env.IMD_PLAYWRIGHT).href:'playwright');
const USER='0x1000000000000000000000000000000000000001',ZERO='0x0000000000000000000000000000000000000000',HASH='0x'+'ab'.repeat(32);
const A='0x1111111111111111111111111111111111111111',B='0x2222222222222222222222222222222222222222',C='0x3333333333333333333333333333333333333333',D='0x4444444444444444444444444444444444444444',R='0x5555555555555555555555555555555555555555',F='0x6666666666666666666666666666666666666666';
const meta={
 [A]:{symbol:'ALPHA',decimals:18,balance:parseUnits('100',18),price:'0.05',gross:parseUnits('100',18)},
 [B]:{symbol:'BETA',decimals:6,balance:2500000n,price:'0.16',gross:parseUnits('50',18)},
 [C]:{symbol:'UNPRICED',decimals:18,balance:parseUnits('9000',18),price:null,gross:0n},
 [D]:{symbol:'FLAGGED',decimals:18,balance:parseUnits('1',18),price:'12',gross:parseUnits('5',18),reputation:'scam'},
 [R]:{symbol:'REFUND',decimals:18,balance:0n,price:null,gross:0n},
 [F]:{symbol:'MANUAL',decimals:18,balance:parseUnits('5',18),price:null,gross:0n},
};
const pool=(a,b)=>{const [currency0,currency1]=[a,b].sort();const p={currency0,currency1,fee:3000,tickSpacing:60,hooks:ZERO,blockNumber:1,transactionHash:HASH};return {...p,id:poolId(p)};};
const pools={version:1,chainId:1,blockNumber:16,blockHash:HASH,pools:[pool(A,IMD),pool(B,IMD),pool(D,IMD)]};
const snapshot={version:1,chainId:1,blockNumber:16,blockHash:HASH,registries:REGISTRIES.map(r=>({...r,count:1})),tokens:[A,R].map((address,i)=>({address,launchNumber:i+1,blockNumber:1,transactionHash:HASH}))};
const multiAbi=parseAbi(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns((bool success,bytes returnData)[] returnData)']);
const checks=[];
const check=(condition,label)=>{assert.ok(condition,label);checks.push({label,passed:true});};
const server=http.createServer((req,res)=>{let name=new URL(req.url,'http://x').pathname;if(!name.startsWith('/preview/')){res.writeHead(404).end();return;}name=name.slice(9)||'index.html';const file=path.resolve(ROOT,'dist',name);if(!file.startsWith(path.join(ROOT,'dist')+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json'})[path.extname(file)]??'application/octet-stream'});fs.createReadStream(file).pipe(res);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/preview/`;
const launch=ENGINE==='webkit'&&process.env.SWEEP_WEBKIT_EXECUTABLE?{executablePath:process.env.SWEEP_WEBKIT_EXECUTABLE,env:process.env}:{};
const browser=await pw[ENGINE].launch(launch);
let lastPage;
async function open(width=390,{injected=true,atomic=false,mobile=false}={}){
 const context=await browser.newContext({viewport:{width,height:844},userAgent:mobile?'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1':undefined,reducedMotion:'reduce'});const page=await context.newPage();lastPage=page;const errors=[],requests=[],signatures=[],sends=[],erc=new Map(),permits=new Map(),receipts=new Map(),balances=new Map(Object.entries(meta).map(([a,m])=>[a,m.balance]));let mode='normal',receiptMode='success';
 page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
 const block={number:'0x10',hash:HASH,parentHash:HASH,timestamp:toHex(Math.floor(Date.now()/1000)),baseFeePerGas:'0x3b9aca00',gasLimit:'0x1c9c380',gasUsed:'0x0',miner:USER,transactions:[],nonce:'0x0000000000000000',difficulty:'0x0',extraData:'0x',logsBloom:'0x'+'00'.repeat(256),mixHash:HASH,receiptsRoot:HASH,sha3Uncles:HASH,size:'0x0',stateRoot:HASH,totalDifficulty:'0x0',transactionsRoot:HASH,uncles:[]};
 function ethCall({to,data}){
  const target=to.toLowerCase();
  if(target==='0xca11bde05977b3631167028862be2a173976ca11'){const {args}=decodeFunctionData({abi:multiAbi,data});return encodeFunctionResult({abi:multiAbi,functionName:'aggregate3',result:args[0].map(c=>{try{return {success:true,returnData:ethCall({to:c.target,data:c.callData})};}catch{return {success:false,returnData:'0x'};}})});}
  if(target===STATE_VIEW)return encodeFunctionResult({abi:stateAbi,functionName:'getLiquidity',result:100000n});
  if(target===V3_FACTORY||target===V2_FACTORY){const abi=target===V3_FACTORY?v3FactoryAbi:v2FactoryAbi;const {functionName}=decodeFunctionData({abi,data});return encodeFunctionResult({abi,functionName,result:ZERO});}
  if(target===V4_QUOTER){if(mode==='quote-error')throw Error('RPC quote unavailable');const {args}=decodeFunctionData({abi:quoterAbi,data});const t=args[0].exactCurrency.toLowerCase();if(!meta[t]?.gross)throw Error('execution reverted');return encodeFunctionResult({abi:quoterAbi,functionName:'quoteExactInput',result:[meta[t].gross,100000n]});}
  if(target===PERMIT2){const {args}=decodeFunctionData({abi:permitAbi,data});return encodeFunctionResult({abi:permitAbi,functionName:'allowance',result:permits.get(args[1].toLowerCase())??[0n,0,0]});}
  if(target===UNIVERSAL_ROUTER)return '0x';
  if(target===EXIT){const {functionName,args}=decodeFunctionData({abi:swarmExitAbi,data});if(functionName==='heldRefunds')return encodeFunctionResult({abi:swarmExitAbi,functionName,result:args[1].toLowerCase()===R&&mode!=='index-empty'?parseUnits('3',18):0n});throw Error('unmocked legacy read');}
  if(meta[target]){const {functionName,args}=decodeFunctionData({abi:erc20Abi,data});if(mode==='balance-error'&&functionName==='balanceOf')throw Error('Balance RPC failure');const result=functionName==='balanceOf'?(args[0].toLowerCase()===USER&&mode!=='index-empty'?balances.get(target):0n):functionName==='decimals'?meta[target].decimals:functionName==='symbol'?meta[target].symbol:erc.get(target)??0n;return encodeFunctionResult({abi:erc20Abi,functionName,result});}
  throw Error(`Unmocked eth_call ${to}`);
 }
 function record(to,data){to=to.toLowerCase();const hash=keccak256(toHex(`test-${requests.length+1}-${Date.now()}`));const logs=[];requests.push({hash,to,data});
  if(meta[to]){const {functionName,args}=decodeFunctionData({abi:erc20Abi,data});if(functionName==='approve')erc.set(to,args[1]);}
  if(to===PERMIT2){const {args}=decodeFunctionData({abi:permitAbi,data});permits.set(args[0].toLowerCase(),[args[2],args[3],0]);}
  if(to===UNIVERSAL_ROUTER&&receiptMode!=='reverted'){
   const {args}=decodeFunctionData({abi:routerAbi,data});for(let i=0;i<args[1].length;i++){if(args[0].slice(2+i*2,4+i*2)!=='10')continue;const [,params]=decodeAbiParameters(parseAbiParameters('bytes,bytes[]'),args[1][i]);const [swap]=decodeAbiParameters(parseAbiParameters('(address currencyIn,(address intermediateCurrency,uint24 fee,int24 tickSpacing,address hooks,bytes hookData)[] path,uint128 amountIn,uint128 amountOutMinimum)'),params[0]);const a=swap.currencyIn.toLowerCase(),gross=meta[a].gross,fee=gross*200n/10000n;
    for(const [address,from,destination,value] of [[a,USER,POOL_MANAGER,swap.amountIn],[IMD,POOL_MANAGER,TREASURY_ADDRESS,fee],[IMD,POOL_MANAGER,USER,gross-fee]])logs.push({address,topics:encodeEventTopics({abi:transferAbi,eventName:'Transfer',args:{from,to:destination}}),data:encodeAbiParameters(parseAbiParameters('uint256'),[value]),blockNumber:'0x10',blockHash:HASH,transactionHash:hash,transactionIndex:'0x0',logIndex:toHex(logs.length),removed:false});
    balances.set(a,balances.get(a)-swap.amountIn);
   }
  }
  receipts.set(hash,{transactionHash:hash,transactionIndex:'0x0',blockHash:HASH,blockNumber:'0x10',from:USER,to,cumulativeGasUsed:'0x30000',gasUsed:'0x30000',effectiveGasPrice:'0x1',contractAddress:null,logs,status:to===UNIVERSAL_ROUTER&&receiptMode==='reverted'?'0x0':'0x1',logsBloom:'0x'+'00'.repeat(256),type:'0x2'});return hash;
 }
 function rpc({method,params=[]}){
  switch(method){case 'eth_chainId':return '0x1';case 'net_version':return '1';case 'eth_blockNumber':return '0x10';case 'eth_getBlockByNumber':return block;case 'eth_getLogs':return [];case 'eth_call':return ethCall(params[0]);case 'eth_estimateGas':return '0x50000';case 'eth_gasPrice':case 'eth_maxPriorityFeePerGas':return '0x3b9aca00';case 'eth_getBalance':return '0x56bc75e2d63100000';case 'eth_getCode':return '0x';case 'eth_getTransactionCount':return '0x0';case 'eth_getTransactionReceipt':return receiptMode==='pending'?null:receipts.get(params[0])??null;case 'eth_accounts':case 'eth_requestAccounts':return [USER];case 'wallet_requestPermissions':return [{parentCapability:'eth_accounts'}];case 'wallet_revokePermissions':return null;
   case 'eth_sendTransaction':if(mode==='reject')throw Object.assign(Error('User rejected request'),{code:4001});return record(params[0].to,params[0].data);
   case 'eth_signTypedData_v4':if(mode==='reject')throw Object.assign(Error('User rejected request'),{code:4001});signatures.push(JSON.parse(params[1]));return '0x'+'11'.repeat(65);
   case 'wallet_getCapabilities':return {'0x1':{atomic:{status:atomic?'supported':'unsupported'}}};
   case 'wallet_sendCalls':if(mode==='reject')throw Object.assign(Error('User rejected request'),{code:4001});sends.push(params[0]);for(const c of params[0].calls)record(c.to,c.data);return {id:params[0].id};
   case 'wallet_getCallsStatus':return {version:'2.0.0',id:params[0],chainId:'0x1',atomic:true,status:receiptMode==='pending'?100:200,receipts:receiptMode==='pending'?[]:[...receipts.values()].slice(-1)};
   case 'eth_simulateV1':throw Object.assign(Error('eth_simulateV1 method not supported'),{code:-32601});
   default:throw Error(`Unmocked RPC ${method}`);
  }
 }
 await page.route('**/*',async route=>{const url=route.request().url();if(url.startsWith(base)){if(url.endsWith('/launches.json'))return route.fulfill({json:snapshot});if(url.endsWith('/pools.json'))return route.fulfill({json:pools});return route.continue();}
  if(url.startsWith('https://eth.blockscout.com')){if(url.includes('/api/v2/tokens/'))return route.fulfill({json:{exchange_rate:'2'}});if(url.includes('/tokens?')){if(mode==='index-empty')return route.fulfill({status:403,json:{message:'Index unavailable'}});const second=url.includes('id=1');const addresses=second?[C,D]:[A,B];return route.fulfill({json:{items:addresses.map(address=>({token:{address_hash:address,symbol:meta[address].symbol,name:`${meta[address].symbol} token`,type:'ERC-20',exchange_rate:meta[address].price,reputation:meta[address].reputation??'ok'},value:meta[address].balance.toString()})),next_page_params:second?null:{id:1}}});}return route.fulfill({json:{status:'0',message:'No logs found',result:[]}});}
  if(/ethereum-rpc.publicnode.com|eth.drpc.org/.test(url)){const body=JSON.parse(route.request().postData()??'{}');const answer=q=>{try{return {jsonrpc:'2.0',id:q.id,result:rpc(q)};}catch(error){return {jsonrpc:'2.0',id:q.id,error:{code:error.code??-32000,message:error.message}};}};return route.fulfill({contentType:'application/json',json:Array.isArray(body)?body.map(answer):answer(body)});}
  return route.abort();
 });
 await page.addInitScript(()=>{const original=setTimeout;window.setTimeout=(fn,delay,...args)=>original(fn,delay===90000?100:delay,...args);});
 if(injected)await page.addInitScript(({user})=>{const events={};window.__authorized=false;window.__walletChain=1;window.__emit=(event,value)=>{if(event==='chainChanged')window.__walletChain=Number(value);for(const listener of events[event]??[])listener(value);};const provider={request:async({method,params})=>{if(method==='eth_accounts'&&!window.__authorized)return [];if(method==='eth_chainId')return '0x'+window.__walletChain.toString(16);if(method==='wallet_switchEthereumChain'){window.__emit('chainChanged',params[0].chainId);return null;}if(method==='eth_requestAccounts')window.__authorized=true;const response=await fetch('https://ethereum-rpc.publicnode.com/',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:params??[]})});const result=await response.json();if(result.error)throw Object.assign(Error(result.error.message),{code:result.error.code});return result.result;},on:(event,listener)=>(events[event]??=[]).push(listener),removeListener:()=>{}};const detail=Object.freeze({info:{uuid:'0b1d4b6a-2c0e-4c4a-9a1a-000000000001',name:'Test Wallet',icon:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"%3E%3Crect width="28" height="28" rx="5" fill="%2317352b"/%3E%3C/svg%3E',rdns:'test.sweepdust'},provider});const announce=()=>dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail}));addEventListener('eip6963:requestProvider',announce);announce();void user;},{user:USER});
 await page.goto(base);await page.getByRole('button',{name:'Scan wallet',exact:true}).waitFor();
 const scan=async()=>{await page.getByLabel('Ethereum wallet address',{exact:true}).fill(USER);await page.getByRole('button',{name:'Scan wallet',exact:true}).click();await page.getByText('Scan complete',{exact:false}).first().waitFor({timeout:20000});};
 const connect=async()=>{await page.getByRole('button',{name:'Connect wallet',exact:true}).click();await page.getByRole('button',{name:'Test Wallet',exact:true}).click();await page.getByRole('button',{name:/Connected as/}).waitFor();await page.getByText('Scan complete',{exact:false}).first().waitFor({timeout:20000});};
 return {context,page,errors,requests,signatures,sends,scan,connect,setMode:v=>mode=v,setReceipt:v=>receiptMode=v};
}
try{
 if(!process.argv.includes('--long-only')) {
 for(const width of [320,390,768,1440]){
  const h=await open(width),{page}=h;
  check(await page.title()==='SweepDust · Turn wallet dust into IMD',`${width}: product title`);
  const rect=await page.getByRole('button',{name:'Scan wallet',exact:true}).boundingBox();check(rect.y+rect.height<844,`${width}: scanner action on first screen`);
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}: no initial horizontal overflow`);
  if(width===390)await page.screenshot({path:path.join(OUT,'390-first-screen.png')});
  await page.getByRole('button',{name:'Scan wallet',exact:true}).click();check(await page.getByText('Enter a valid Ethereum wallet address, starting with 0x.').isVisible(),`${width}: invalid address explained`);
  await h.scan();check(await page.locator('[data-token]').count()===5,`${width}: all indexed holdings plus legacy refund listed`);
  check(await page.locator(`[data-token="${B}"]`).isVisible(),`${width}: token outside Swarm is discovered`);
  check(await page.locator(`[data-token="${C}"]`).innerText().then(t=>t.includes('Unpriced')),`${width}: unpriced balance remains visible`);
  await page.getByLabel('Max value (USD)',{exact:true}).fill('1');check(await page.locator('[data-token]').count()===1,`${width}: maximum USD filter`);
  await page.getByLabel('Min value (USD)',{exact:true}).fill('1');check(await page.getByRole('heading',{name:'No tokens match these filters'}).isVisible(),`${width}: minimum USD filter`);
  await page.getByLabel('Min value (USD)',{exact:true}).fill('2');check(await page.getByText('Maximum value must be at least the minimum.').isVisible(),`${width}: invalid bounds are explained`);
  await page.getByRole('button',{name:'Reset filters',exact:true}).first().click();
  await page.getByRole('searchbox').fill('beta');check(await page.locator('[data-token]').count()===1,`${width}: case-insensitive search`);await page.getByRole('searchbox').fill('');
  await page.getByRole('button',{name:/^Ready/}).click();check(await page.locator('[data-token]').count()===3,`${width}: ready-only filter`);await page.getByRole('button',{name:/^All tokens/}).click();
  await page.getByLabel('Select shown tokens with routes').check();check(await page.getByText('2 tokens selected',{exact:true}).isVisible(),`${width}: select shown skips flagged tokens`);
  check(await page.getByRole('button',{name:/Review sweep/}).isDisabled(),`${width}: read-only scan cannot sell`);
  await h.connect();check(await page.getByText('2 tokens selected',{exact:true}).isVisible(),`${width}: connecting the inspected wallet preserves selections`);
  await page.getByLabel('Select shown tokens with routes').check();await page.getByLabel('Max value (USD)',{exact:true}).fill('1');check(await page.getByText('2 tokens selected · 1 hidden by filters').isVisible(),`${width}: hidden selections disclosed`);
  await page.getByRole('button',{name:/Review sweep/}).click();const dialog=page.getByRole('dialog',{name:'Review your sweep'});await dialog.waitFor();
  check(await dialog.getByText('About 4 wallet requests',{exact:true}).isVisible(),`${width}: accurate standard request estimate`);
  check(await dialog.getByText('Minimum you receive',{exact:true}).isVisible(),`${width}: minimum net proceeds disclosed`);
  check(await page.locator('#page').evaluate(e=>e.inert),`${width}: review makes background inert`);
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}: review has no horizontal overflow`);
  if(width===320||width===390)await page.screenshot({path:path.join(OUT,`${width}-review.png`)});
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();check(await page.getByRole('button',{name:/Review sweep/}).evaluate(e=>e===document.activeElement),`${width}: review returns keyboard focus`);
  await page.evaluate(()=>window.__emit('chainChanged','0x2105'));await page.getByRole('button',{name:'Switch to Ethereum',exact:true}).waitFor();check(await page.getByRole('button',{name:/Review sweep/}).isDisabled(),`${width}: wrong network blocks sale`);await page.getByRole('button',{name:'Switch to Ethereum',exact:true}).click();
  await page.getByRole('button',{name:/Review sweep/}).click();await page.getByRole('button',{name:'Confirm sweep · 2 tokens',exact:true}).click();await page.getByText('Sweep confirmed: 2 tokens, 147 IMD received after fees. Scan again for fresh balances.',{exact:true}).waitFor({timeout:20000});
  check(h.requests.filter(r=>r.to===UNIVERSAL_ROUTER).length===1,`${width}: both tokens use one sale transaction`);check(h.signatures.length===1,`${width}: both router authorizations use one PermitBatch signature`);check(h.requests.filter(r=>r.to===A||r.to===B).length===2,`${width}: only required token approvals sent`);
  check(h.errors.length===0,`${width}: no script or local-resource errors`);if(width===1440)await page.screenshot({path:path.join(OUT,'1440-confirmed.png'),fullPage:true});await h.context.close();
 }
 {
  const h=await open(390,{atomic:true});await h.connect();await h.page.getByLabel('Select shown tokens with routes').check();await h.page.getByRole('button',{name:/Review sweep/}).click();await h.page.getByText('About 1 wallet request',{exact:true}).waitFor();check(true,'atomic: estimate is one request for two tokens');await h.page.getByRole('button',{name:'Confirm sweep · 2 tokens',exact:true}).click();await h.page.getByText('Sweep confirmed: 2 tokens, 147 IMD received after fees. Scan again for fresh balances.',{exact:true}).waitFor({timeout:20000});check(h.sends.length===1&&h.sends[0].atomicRequired===true,'atomic: one wallet_sendCalls with required atomicity');check(h.signatures.length===0,'atomic: no separate typed signatures');check(h.sends[0].calls.length===5,'atomic: two token approvals, two router allowances, one sale');check(h.errors.length===0,'atomic: no script errors');await h.context.close();
 }
 {
  const h=await open();await h.connect();await h.page.getByLabel('Select shown tokens with routes').check();h.setMode('reject');await h.page.getByRole('button',{name:/Review sweep/}).click();await h.page.getByRole('button',{name:'Confirm sweep · 2 tokens',exact:true}).click();await h.page.getByText('No sale is confirmed. Check token details and your wallet before retrying.',{exact:true}).waitFor();check(h.requests.length===0,'rejection: stops with no sale or approval');check(await h.page.evaluate(()=>Object.values(localStorage).every(value=>!value.includes('"kind":"pending"'))),'rejection: no pending lock remains');await h.context.close();
 }
 {
  const h=await open();await h.scan();h.setMode('balance-error');await h.page.getByRole('button',{name:'Scan wallet',exact:true}).click();await h.page.getByText('Wallet scan interrupted',{exact:true}).waitFor();check(await h.page.getByText('Holdings are unknown. Use Scan wallet to retry.').isVisible(),'RPC failure: not reported as empty wallet');h.setMode('normal');await h.scan();check(await h.page.locator('[data-token]').count()===5,'RPC failure: retry recovers holdings');await h.page.getByText('Scan coverage & deeper search',{exact:true}).click();await h.page.getByLabel('Add a missing token contract',{exact:true}).fill(F);await h.page.getByRole('button',{name:'Add & rescan',exact:true}).click();await h.page.getByText('Scan complete',{exact:false}).first().waitFor();check(await h.page.locator(`[data-token="${F}"]`).isVisible(),'manual import: verifies a token absent from index');await h.context.close();
 }
 {
  const h=await open(390,{injected:false,mobile:true});await h.page.getByRole('button',{name:'Connect wallet',exact:true}).click();for(const name of ['MetaMask','Coinbase Wallet','Rabby','Phantom'])check(await h.page.getByRole('link',{name:`Open in ${name}`,exact:true}).isVisible(),`phone: ${name} deep link available`);check(await h.page.getByRole('button',{name:'Coinbase Smart Wallet',exact:true}).isVisible(),'phone: passkey wallet available');await h.page.keyboard.press('Escape');check(await h.page.getByRole('dialog').count()===0,'phone: Escape dismisses connect sheet');check(await h.page.getByRole('button',{name:'Connect wallet',exact:true}).evaluate(e=>e===document.activeElement),'phone: connect focus restored');await h.page.screenshot({path:path.join(OUT,'390-no-extension.png')});await h.context.close();
 }
 {
  const h=await open();await h.connect();await h.page.getByLabel('Select shown tokens with routes').check();await h.page.getByRole('button',{name:/Review sweep/}).click();h.setReceipt('pending');await h.page.getByRole('button',{name:'Confirm sweep · 2 tokens',exact:true}).click();await h.page.getByText('No sale is confirmed. Check token details and your wallet before retrying.',{exact:true}).waitFor({timeout:10000});check(await h.page.locator('.pending-banner').isVisible(),'pending: unresolved approval is disclosed');check(h.requests.length===1,'pending: no later approval or sale is sent');await h.page.reload();await h.page.getByRole('button',{name:'Connect wallet',exact:true}).waitFor();await h.connect();check(await h.page.locator('.pending-banner').isVisible(),'pending: reload retains the lock');check(await h.page.locator(`[data-token="${A}"] input[type="checkbox"]`).isDisabled(),'pending: input cannot be selected again');h.setReceipt('success');await h.page.getByRole('button',{name:'Scan wallet',exact:true}).click();await h.page.getByText('Scan complete',{exact:false}).first().waitFor();check(await h.page.locator('.pending-banner').count()===0,'pending: a confirmed approval releases the lock');check(await h.page.locator(`[data-token="${A}"] input[type="checkbox"]`).isEnabled(),'pending: fresh quote can be selected after receipt recovery');await h.context.close();
 }
 {
  const h=await open(390,{atomic:true});await h.connect();await h.page.getByLabel('Select shown tokens with routes').check();await h.page.getByRole('button',{name:/Review sweep/}).click();h.setReceipt('reverted');await h.page.getByRole('button',{name:'Confirm sweep · 2 tokens',exact:true}).click();await h.page.getByText('No sale is confirmed. Check token details and your wallet before retrying.',{exact:true}).waitFor();check(await h.page.locator('.pending-banner').count()===0,'revert: failed batch is not reported as pending or sold');await h.context.close();
 }
 {
  const h=await open();await h.page.getByLabel('Ethereum wallet address',{exact:true}).fill(USER);await h.page.getByRole('button',{name:'Scan wallet',exact:true}).click();await h.page.getByRole('button',{name:'Stop scan',exact:true}).click();check(await h.page.getByText('Scan stopped. Completed routes can be reviewed; scan again to check the remaining tokens.',{exact:true}).isVisible(),'cancel: interrupted scan is explained');check(await h.page.getByRole('heading',{name:'No positive balances found'}).count()===0,'cancel: unknown wallet is not called empty');await h.context.close();
 }
 }
 for(const width of [320,390]){
  const previous=meta[A];meta[A]={...previous,symbol:'TOKEN_WITH_A_VERY_LONG_SYMBOL_AND_UNUSUALLY_LARGE_BALANCE_1234567890',balance:(1n<<128n)-1n,decimals:6,gross:((1n<<128n)-1n)/2n};
  try{const h=await open(width);await h.connect();await h.page.locator(`[data-token="${A}"] input[type="checkbox"]`).check();await h.page.getByRole('button',{name:/Review sweep/}).click();await h.page.getByRole('dialog',{name:'Review your sweep'}).waitFor();await h.page.screenshot({path:path.join(OUT,`${width}-long-review.png`)});fs.writeFileSync(path.join(OUT,`${width}-overflow.json`),JSON.stringify(await h.page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,elements:[...document.querySelectorAll('*')].map(e=>({tag:e.tagName,class:e.className,text:e.textContent.slice(0,120),right:e.getBoundingClientRect().right,left:e.getBoundingClientRect().left,width:e.getBoundingClientRect().width,display:getComputedStyle(e).display,minWidth:getComputedStyle(e).minWidth})).filter(e=>e.right>innerWidth+1||e.left < -1)})),null,2));check(await h.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}: long symbols and exact values reflow`);check(await h.page.getByRole('dialog').getByText(A,{exact:true}).isVisible(),`${width}: complete token address available in review`);check((await h.page.getByRole('dialog').locator('.plan td').first().textContent()).includes(meta[A].symbol),`${width}: complete long symbol is retained`);await h.page.screenshot({path:path.join(OUT,`${width}-long-review.png`)});await h.context.close();}finally{meta[A]=previous;}
 }
 {
  const h=await open(390);const pairs=await h.page.evaluate(()=>{
   const sample=document.createElement('span');document.body.append(sample);const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const context=canvas.getContext('2d');
   const rgb=(token)=>{sample.style.color=`var(${token})`;context.clearRect(0,0,1,1);context.fillStyle=getComputedStyle(sample).color;context.fillRect(0,0,1,1);return [...context.getImageData(0,0,1,1).data].slice(0,3);};
   const luminance=(rgb)=>rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
   const pairs=[['primary text','--color-text','--color-bg-surface'],['secondary on page','--color-text-secondary','--color-bg'],['secondary on surface','--color-text-secondary','--color-bg-surface'],['secondary on mint','--color-text-secondary','--color-accent-soft'],['button text','--color-on-accent','--color-accent'],['button hover text','--color-on-accent','--color-accent-hover'],['disabled text','--color-text-secondary','--color-bg-muted'],['ready label','--color-ok','--color-bg-surface'],['selected ready label','--color-ok','--color-accent-soft'],['error text','--color-bad','--color-bg-surface'],['pending text','--color-warning','--color-warning-bg'],['focus on surface','--color-focus','--color-bg-surface'],['focus on mint','--color-focus','--color-accent-soft']].map(([name,fg,bg])=>{const a=rgb(fg),b=rgb(bg),x=luminance(a),y=luminance(b);return {name,foreground:a,background:b,ratio:(Math.max(x,y)+.05)/(Math.min(x,y)+.05)};});sample.remove();return pairs;
  });fs.writeFileSync(path.join(OUT,'contrast.json'),JSON.stringify(pairs,null,2));check(pairs.every(pair=>pair.ratio>=4.5),'contrast: all 13 rendered solid token pairs meet 4.5:1');await h.context.close();
 }
 {
  const h=await open(390),{page}=h;
  await page.keyboard.press('Tab');check(await page.locator('.skip-link').evaluate(e=>e===document.activeElement),'keyboard: first focus is the visible skip link');
  await page.keyboard.press('Tab');await page.keyboard.press('Tab');check(await page.getByRole('button',{name:'Connect wallet',exact:true}).evaluate(e=>e===document.activeElement),'keyboard: header connect is reachable');
  await page.keyboard.press('Enter');await page.getByRole('dialog').waitFor();await page.keyboard.press('Tab');check(await page.getByRole('button',{name:'Test Wallet',exact:true}).evaluate(e=>e===document.activeElement),'keyboard: wallet row is reachable');await page.keyboard.press('Enter');await page.getByText('Scan complete',{exact:false}).first().waitFor();check(await page.getByRole('button',{name:/Connected as/}).evaluate(e=>e===document.activeElement),'keyboard: connection restores focus to the connected control');
  const tabTo=async selector=>{for(let i=0;i<80;i++){if(await page.locator(selector).evaluate(e=>e===document.activeElement))return;await page.keyboard.press('Tab');}throw Error(`Keyboard could not reach ${selector}`);};
  await tabTo('input[aria-label="Select shown tokens with routes"]');await page.keyboard.press('Space');await page.getByText('2 tokens selected',{exact:true}).waitFor();check(true,'keyboard: tokens selected without a pointer');await tabTo('.review-button');await page.screenshot({path:path.join(OUT,'390-keyboard-focus.png')});await page.keyboard.press('Enter');await page.getByRole('dialog',{name:'Review your sweep'}).waitFor();check(await page.evaluate(()=>document.body.style.overflow==='hidden'),'keyboard: modal locks background scrolling');await page.keyboard.press('Shift+Tab');check(await page.getByRole('button',{name:'Confirm sweep · 2 tokens',exact:true}).evaluate(e=>e===document.activeElement),'keyboard: modal wraps backwards');await page.keyboard.press('Tab');check(await page.getByRole('button',{name:'Close',exact:true}).evaluate(e=>e===document.activeElement),'keyboard: modal wraps forwards');await page.keyboard.press('Escape');check(await page.locator('.review-button').evaluate(e=>e===document.activeElement),'keyboard: Escape returns focus to review');await h.context.close();
 }
 {
  const h=await open();h.setMode('index-empty');await h.scan();check(await h.page.getByRole('heading',{name:'Wallet scan interrupted'}).isVisible()&&await h.page.getByRole('heading',{name:'No positive balances found'}).count()===0,'index failure: zero fallback balances do not imply an empty wallet');h.setMode('normal');await h.scan();check(await h.page.locator('[data-token]').count()===5,'index failure: retry recovers the full indexed inventory');await h.context.close();
 }
 if(process.env.IMD_AXE){
  const {default:AxeBuilder}=await import(pathToFileURL(process.env.IMD_AXE).href);const h=await open(390);
  for(const state of ['disconnected','connected','review']){
   if(state==='connected')await h.connect();if(state==='review'){await h.page.getByLabel('Select shown tokens with routes').check();await h.page.getByRole('button',{name:/Review sweep/}).click();await h.page.getByRole('dialog').waitFor();}
   const result=await new AxeBuilder({page:h.page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();fs.writeFileSync(path.join(OUT,`axe-${state}.json`),JSON.stringify({violations:result.violations,incomplete:result.incomplete.map(x=>({id:x.id,impact:x.impact,nodes:x.nodes.length})),passes:result.passes.length},null,2));check(result.violations.length===0,`accessibility: no automated violations in ${state}`);
  }
  await h.context.close();
 }
 fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({engine:ENGINE,productionSubpath:'/preview/',simulated:true,mainnetTransactionsSent:0,checks},null,2));console.log(`${ENGINE}: ${checks.length} interaction checks passed`);
}catch(error){if(lastPage&&!lastPage.isClosed())await lastPage.screenshot({path:path.join(OUT,'failure.png'),fullPage:true});fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({engine:ENGINE,checks,error:String(error)},null,2));throw error;}
finally{await browser.close();await new Promise(r=>server.close(r));}
