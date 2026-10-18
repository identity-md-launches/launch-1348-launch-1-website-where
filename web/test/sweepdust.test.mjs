import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeEventTopics, parseAbiParameters } from 'viem';
import { batchSaleCall, executeBatchSale, planBatchSale, persistPending, reconcileBatch, resolveBatchPending, storedPending, supportsAtomic } from '../src/lib/batchSale.ts';
import { holdingUsd, indexedHoldings, validPrice } from '../src/lib/holdings.ts';
import { EMPTY_FILTERS, filterTokens, rangeError } from '../src/lib/filters.ts';
import { findFastV4Route, packedPath, WETH } from '../src/lib/markets.ts';
import { scanWallet } from '../src/lib/inventory.ts';
import { limiter, mapConcurrent } from '../src/lib/async.ts';
import { IMD_ADDRESS, TREASURY_ADDRESS, SWARM_EXIT_ADDRESS } from '../src/deployment.ts';
import { poolId, PERMIT2, POOL_MANAGER, UNIVERSAL_ROUTER } from '../src/lib/routes.ts';
import { erc20Abi } from '../src/abi/erc20.ts';
import { permitAbi, transferAbi } from '../src/lib/directSale.ts';
import { REGISTRIES } from '../src/lib/discovery.ts';
const A='0x1111111111111111111111111111111111111111', B='0x2222222222222222222222222222222222222222', C='0x4444444444444444444444444444444444444444';
const USER='0x3333333333333333333333333333333333333333', ZERO='0x0000000000000000000000000000000000000000', HASH='0x'+'ab'.repeat(32);
const storage = new Map();
globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
beforeEach(()=>storage.clear());
const pool=(a,b,fee=3000)=>{const [currency0,currency1]=[a,b].sort(); const p={currency0,currency1,fee,tickSpacing:60,hooks:ZERO,blockNumber:1,transactionHash:HASH,liquidity:100n}; return {...p,id:poolId(p)};};
const token=(address=A,usdValue=2)=>({address,symbol:address===A?'ALPHA':'BETA',name:'Test token',decimals:18,balance:1000n,expectedImd:address===A?10000n:20000n,sellable:true,status:0,route:null,routeLabel:'Uniswap v4 → IMD',heldRefund:0n,usdValue,routeChecked:true,liveRoute:{pools:[pool(address,IMD_ADDRESS)],amountIn:1000n,amountOut:address===A?10000n:20000n,blockNumber:10n,quotedAt:Date.now()}});
const transfer=(address,from,to,value)=>({address,topics:encodeEventTopics({abi:transferAbi,eventName:'Transfer',args:{from,to}}),data:encodeAbiParameters(parseAbiParameters('uint256'),[value])});
const receiptLogs=(items=[token(),token(B)],badFee=false)=>items.flatMap(t=>[transfer(t.address,USER,POOL_MANAGER,1000n),transfer(IMD_ADDRESS,POOL_MANAGER,TREASURY_ADDRESS,t.expectedImd*200n/10000n+(badFee?1n:0n)),transfer(IMD_ADDRESS,POOL_MANAGER,USER,t.expectedImd-t.expectedImd*200n/10000n)]);
function harness({atomic=false,approved=false,badFee=false}={}) {
 const writes=[], signatures=[], sends=[], simulations=[]; const erc=new Map(), permits=new Map(); let serial=0; const receipts=new Map();
 const allowance=t=>erc.get(t)??(approved?1000n:0n);
 const permit=t=>permits.get(t)??[approved?1000n:0n,Math.floor(Date.now()/1000)+(approved?3600:0),0];
 const callItems=call=>{
   const [,inputs]=call.args; const items=[];
   for(const input of inputs){try{const [actions,params]=decodeAbiParameters(parseAbiParameters('bytes,bytes[]'),input);if(actions==='0x070c100f'){const [p]=decodeAbiParameters(parseAbiParameters('(address currencyIn,(address intermediateCurrency,uint24 fee,int24 tickSpacing,address hooks,bytes hookData)[] path,uint128 amountIn,uint128 amountOutMinimum)'),params[0]);items.push(token(p.currencyIn.toLowerCase()));}}catch{}}
   return items;
 };
 const client={
  getChainId:async()=>1,getBlockNumber:async()=>10n,getGasPrice:async()=>2n,estimateContractGas:async()=>100n,
  readContract:async({address,functionName,args})=>functionName==='balanceOf'?1000n:address===PERMIT2?permit(args[1]):allowance(address),
  simulateContract:async(call)=>{simulations.push(call);return {result:call.functionName==='quoteExactInput'?[call.args[0].exactCurrency.toLowerCase()===A?10000n:20000n,1n]:undefined};},
  simulateCalls:async({calls})=>({results:calls.map(()=>({status:'success',gasUsed:100n}))}),
  getTransactionReceipt:async({hash})=>receipts.get(hash)??{status:'success',logs:receiptLogs(undefined,badFee)},
  waitForTransactionReceipt:async({hash})=>receipts.get(hash)??{status:'success',logs:receiptLogs(undefined,badFee)},
 };
 const apply=call=>{
  if(call.functionName==='approve'){if(call.address===PERMIT2)permits.set(call.args[0],[call.args[2],call.args[3],0]);else erc.set(call.address,call.args[1]);}
 };
 const wallet={chain:{id:1},getChainId:async()=>1,getAddresses:async()=>[USER],getCapabilities:async()=>({atomic:{status:atomic?'supported':'unsupported'}}),
  signTypedData:async data=>{signatures.push(data);return '0x'+'11'.repeat(65);},
  writeContract:async call=>{writes.push(call);apply(call);const hash='0x'+(++serial).toString(16).padStart(64,'0');receipts.set(hash,{status:'success',logs:call.functionName==='execute'?receiptLogs(callItems(call),badFee):[]});return hash;},
  sendCalls:async request=>{sends.push(request);for(const c of request.calls){if(c.to===UNIVERSAL_ROUTER){const decoded=decodeFunctionData({abi:[{type:'function',name:'execute',stateMutability:'payable',inputs:[{type:'bytes'},{type:'bytes[]'},{type:'uint256'}],outputs:[]}],data:c.data});receipts.set(HASH,{status:'success',logs:receiptLogs(callItems({args:decoded.args}),badFee)});}else{const decoded=decodeFunctionData({abi:c.to===PERMIT2?permitAbi:erc20Abi,data:c.data});apply({address:c.to,...decoded});}}return {id:request.id};},
  waitForCallsStatus:async()=>({status:'success',statusCode:200,atomic:true,receipts:[{transactionHash:HASH}]}),
  getCallsStatus:async()=>({status:'success',atomic:true,receipts:[{transactionHash:HASH}]}),
 };
 return {client,wallet,writes,signatures,sends,simulations,erc,permits,receipts};
}

test('USD filters include both boundaries and zero; unpriced holdings remain until a range is active',()=>{
 const values=[token(A,0),token(B,10),token(C,null)];
 assert.equal(filterTokens(values,EMPTY_FILTERS).length,3);
 assert.deepEqual(filterTokens(values,{...EMPTY_FILTERS,minUsd:'0',maxUsd:'10'}).map(t=>t.usdValue),[10,0]);
 assert.equal(filterTokens(values,{...EMPTY_FILTERS,minUsd:'10',maxUsd:'10'}).length,1);
 assert.equal(filterTokens(values,{...EMPTY_FILTERS,minUsd:'0',maxUsd:'0'}).length,1);
});
test('invalid and inverted USD bounds do not silently pass tokens',()=>{
 for(const filters of [{minUsd:'-1'},{minUsd:'Infinity'},{minUsd:'11',maxUsd:'10'}]){assert.ok(rangeError({...EMPTY_FILTERS,...filters}));assert.equal(filterTokens([token()],{...EMPTY_FILTERS,...filters}).length,0);}
});
test('search handles a contract address, name, case and a ready-only selection',()=>{
 const items=[token(),{...token(B),sellable:false}];
 assert.equal(filterTokens(items,{...EMPTY_FILTERS,search:'ALpHa'}).length,1);
 assert.equal(filterTokens(items,{...EMPTY_FILTERS,search:B}).length,1);
 assert.equal(filterTokens(items,{...EMPTY_FILTERS,search:'test token'}).length,2);
 assert.equal(filterTokens(items,{...EMPTY_FILTERS,route:'ready'}).length,1);
});
test('prices are finite and decimals are respected; missing metadata is never guessed',()=>{
 assert.equal(holdingUsd(1234567n,6,2),2.469134);assert.equal(holdingUsd(1n,null,2),null);
 assert.equal(holdingUsd(1n,18,null),null);assert.equal(validPrice('NaN'),null);assert.equal(validPrice('0'),0);
});
test('wallet-wide index follows all pages, deduplicates addresses, and ignores NFTs',async()=>{
 const previous=global.fetch; const urls=[];let call=0;
 global.fetch=async url=>{urls.push(String(url));return {ok:true,json:async()=>++call===1?{items:[{token:{address_hash:A,symbol:'ONE',type:'ERC-20',exchange_rate:'2'}},{token:{address_hash:B,type:'ERC-721'}}],next_page_params:{items_count:50,value:'123',id:1}}:{items:[{token:{address_hash:B,symbol:'TWO',type:'ERC-20',exchange_rate:null}},{token:{address_hash:A,symbol:'ONE',type:'ERC-20',exchange_rate:'2'}}],next_page_params:null}};};
 try{const result=await indexedHoldings(USER);assert.equal(result.tokens.length,2);assert.equal(result.complete,true);assert.match(urls[1],/items_count=50/);assert.equal(result.tokens[1].usdPrice,null);}finally{global.fetch=previous;}
});
test('index failures retain successful pages and explicitly mark incomplete coverage',async()=>{
 const previous=global.fetch;let calls=0;
 global.fetch=async()=>++calls===1?{ok:true,json:async()=>({items:[{token:{address_hash:A,type:'ERC-20'}}],next_page_params:{id:1}})}:{ok:false,status:403};
 try{const result=await indexedHoldings(USER);assert.equal(result.tokens.length,1);assert.equal(result.complete,false);assert.match(result.warnings[0],/403/);}finally{global.fetch=previous;}
});
test('a repeated pagination cursor cannot loop forever or claim completion',async()=>{
 const previous=global.fetch;global.fetch=async()=>({ok:true,json:async()=>({items:[],next_page_params:{id:1}})});
 try{const result=await indexedHoldings(USER);assert.equal(result.complete,false);assert.match(result.warnings[0],/repeated/);}finally{global.fetch=previous;}
});
test('global limiter respects its cap even when callers enqueue more work as tasks finish',async()=>{
 const limit=limiter(3);let active=0,max=0;
 await Promise.all(Array.from({length:40},()=>limit(async()=>{max=Math.max(max,++active);await new Promise(r=>setTimeout(r,1));active--;return 1;})));
 assert.equal(max,3);assert.deepEqual(await mapConcurrent([1,2,3],2,async n=>n*2),[2,4,6]);
});
test('parallel route search reaches candidate 25 and does not keep a sequential bottleneck',async()=>{
 const pools=Array.from({length:25},(_,i)=>pool(A,IMD_ADDRESS,100+i));let calls=0,active=0,max=0;
 const client={simulateContract:async()=>{const i=++calls;max=Math.max(max,++active);await new Promise(r=>setTimeout(r,1));active--;if(i<25)throw Error('execution reverted');return {result:[1000n,1n]};}};
 const found=await findFastV4Route(client,USER,A,1000n,pools,10n);assert.ok(found.route);assert.equal(calls,25);assert.equal(max,3);
});
test('quick route search discloses its limit and leaves a deeper search available',async()=>{
 const pools=Array.from({length:30},(_,i)=>pool(A,IMD_ADDRESS,100+i));let calls=0;
 const result=await findFastV4Route({simulateContract:async()=>{calls++;throw Error('execution reverted');}},USER,A,1000n,pools,10n,undefined,{maxPaths:6,partialAttempts:4});
 assert.equal(calls,6);assert.equal(result.incomplete,true);assert.match(result.reason,/6 of 30/);
});
test('two-token standard sweep uses two exact approvals, one PermitBatch signature, and one sale',async()=>{
 const h=harness();const plan=await planBatchSale(h.client,USER,[token(),token(B)],h.wallet);
 assert.equal(plan.batch.mode,'standard');assert.equal(plan.batch.confirmations,4);assert.equal(plan.batch.tokenApprovals,2);
 const outcomes=await executeBatchSale(h.wallet,h.client,USER,plan,()=>{});
 assert.equal(h.writes.filter(c=>c.functionName==='approve').length,2);assert.equal(h.signatures.length,1);assert.equal(h.signatures[0].message.details.length,2);
 assert.equal(h.signatures[0].domain.verifyingContract,PERMIT2);assert.equal(h.signatures[0].message.spender,UNIVERSAL_ROUTER);
 assert.ok(h.signatures[0].message.details.every(d=>d.amount===1000n));
 assert.equal(h.writes.filter(c=>c.functionName==='execute').length,1);assert.equal(h.writes.at(-1).args[0],'0x031010');
 assert.equal(outcomes.get(A).kind,'sold');assert.equal(outcomes.get(A).imdOut,10000n);assert.equal(outcomes.get(B).imdOut,20000n);
 assert.equal(storedPending(USER).size,0);
});
test('an atomic wallet sends exact approvals and both sales in one request with no fallback',async()=>{
 const h=harness({atomic:true});const plan=await planBatchSale(h.client,USER,[token(),token(B)],h.wallet);
 assert.equal(plan.batch.confirmations,1);assert.equal(plan.batch.mode,'atomic');
 const outcomes=await executeBatchSale(h.wallet,h.client,USER,plan,()=>{});
 assert.equal(h.sends.length,1);assert.equal(h.sends[0].forceAtomic,true);assert.equal(h.sends[0].experimental_fallback,false);
 assert.equal(h.sends[0].calls.length,5);assert.equal(h.writes.length,0);assert.equal(h.signatures.length,0);assert.equal(outcomes.get(B).kind,'sold');
});
test('already sufficient allowances reuse authorization and need only one sale request',async()=>{
 const h=harness({approved:true});const plan=await planBatchSale(h.client,USER,[token(),token(B)],h.wallet);
 assert.equal(plan.batch.confirmations,1);await executeBatchSale(h.wallet,h.client,USER,plan,()=>{});
 assert.equal(h.writes.length,1);assert.equal(h.signatures.length,0);
});
test('nonzero insufficient token approval resets to zero before approving the exact amount',async()=>{
 const h=harness();h.erc.set(A,1n);const plan=await planBatchSale(h.client,USER,[token()],h.wallet);
 assert.equal(plan.batch.tokenApprovals,2);await executeBatchSale(h.wallet,h.client,USER,plan,()=>{});
 assert.deepEqual(h.writes.filter(c=>c.functionName==='approve').map(c=>c.args[1]),[0n,1000n]);
});
test('rejection of an atomic request releases the pending lock and never triggers standard prompts',async()=>{
 const h=harness({atomic:true});h.wallet.sendCalls=async()=>{throw Object.assign(Error('User rejected request'),{code:4001});};
 const plan=await planBatchSale(h.client,USER,[token(),token(B)],h.wallet);const result=await executeBatchSale(h.wallet,h.client,USER,plan,()=>{});
 assert.equal(result.get(A).kind,'unsold');assert.equal(h.writes.length,0);assert.equal(storedPending(USER).size,0);
});
test('unknown sale receipt is stored across reload and prevents another sale',async()=>{
 const h=harness({approved:true});const plan=await planBatchSale(h.client,USER,[token()],h.wallet);
 h.client.waitForTransactionReceipt=async()=>{throw Error('RPC timeout');};
 const results=await executeBatchSale(h.wallet,h.client,USER,plan,()=>{});assert.equal(results.get(A).kind,'pending');assert.equal(storedPending(USER).size,1);
 await assert.rejects(planBatchSale(h.client,USER,[token()],h.wallet),/unresolved/);
 const resolved=await resolveBatchPending(h.client,h.wallet,USER,A,storedPending(USER).get(A));assert.equal(resolved.kind,'sold');
 persistPending(USER,new Map([[A,resolved]]));assert.equal(storedPending(USER).size,0);
});
test('the approval hash is persisted before waiting, protecting reload during an approval',async()=>{
 const h=harness();const plan=await planBatchSale(h.client,USER,[token()],h.wallet);
 h.client.waitForTransactionReceipt=async()=>{assert.equal(storedPending(USER).get(A).phase,'approval');throw Error('RPC timeout');};
 const results=await executeBatchSale(h.wallet,h.client,USER,plan,()=>{});assert.equal(results.get(A).phase,'approval');assert.equal(h.writes.length,1);
});
test('unreconciled fee or wrong payout source cannot be reported as sold',async()=>{
 const h=harness({approved:true,badFee:true});const plan=await planBatchSale(h.client,USER,[token()],h.wallet);
 const result=await executeBatchSale(h.wallet,h.client,USER,plan,()=>{});assert.equal(result.get(A).kind,'pending');
 const logs=receiptLogs([token()]).map(l=>l.address===IMD_ADDRESS?{...l,topics:encodeEventTopics({abi:transferAbi,eventName:'Transfer',args:{from:B,to:USER}})}:l);
 assert.equal(reconcileBatch(logs,USER,[A],A,1000n,9700n,HASH).kind,'pending');
});
test('a reverted atomic transaction releases all inputs and charges no sale fee',async()=>{
 const h=harness({approved:true});const plan=await planBatchSale(h.client,USER,[token(),token(B)],h.wallet);
 h.client.waitForTransactionReceipt=async()=>({status:'reverted',logs:[]});const result=await executeBatchSale(h.wallet,h.client,USER,plan,()=>{});
 assert.equal(result.get(A).kind,'unsold');assert.match(result.get(B).reason,/no sale fee/);assert.equal(storedPending(USER).size,0);
});
test('price deterioration after review preserves the reviewed floor and sends no wallet request',async()=>{
 const h=harness({approved:true});const plan=await planBatchSale(h.client,USER,[token()],h.wallet);
 h.client.simulateContract=async()=>({result:[9000n,1n]});const result=await executeBatchSale(h.wallet,h.client,USER,plan,()=>{});
 assert.equal(h.writes.length,0);assert.match(result.get(A).reason,/reviewed minimum/);
});
test('account, chain and complete simulation failures prevent sale submission',async()=>{
 for(const kind of ['account','chain','simulation']){
 const h=harness({approved:true});const plan=await planBatchSale(h.client,USER,[token()],h.wallet);
 if(kind==='account')h.wallet.getAddresses=async()=>[B];if(kind==='chain')h.wallet.getChainId=async()=>8453;if(kind==='simulation')h.client.simulateContract=async call=>{if(call.functionName==='execute')throw Error('Hook rejected sender');return {result:[10000n,1n]};};
 try{const result=await executeBatchSale(h.wallet,h.client,USER,plan,()=>{});assert.equal(result.get(A).kind,'unsold');}catch(error){assert.match(error.message,/account|Ethereum/);}
 assert.equal(h.writes.length,0);}
});
test('atomic readiness does not silently upgrade an account; standard mode can be chosen explicitly',async()=>{
 const h=harness({atomic:true});h.wallet.getCapabilities=async()=>({atomic:{status:'ready'}});assert.equal(await supportsAtomic(h.wallet,USER),false);
 h.wallet.getCapabilities=async()=>({atomic:{status:'supported'}});assert.equal((await planBatchSale(h.client,USER,[token()],h.wallet,false)).batch.mode,'standard');
});
test('batch calldata bounds tokens, rejects duplicate inputs and pays the original treasury',()=>{
 assert.throws(()=>batchSaleCall(USER,[],100n));assert.throws(()=>batchSaleCall(USER,[{token:token(),imdOut:10000n},{token:token(),imdOut:10000n}],100n));
 const call=batchSaleCall(USER,[{token:token(),imdOut:10000n},{token:token(B),imdOut:20000n}],100n);
 assert.equal(call.args[0],'0x1010');assert.equal(call.value,0n);
 const [,params]=decodeAbiParameters(parseAbiParameters('bytes,bytes[]'),call.args[1][0]);const [,treasury,fee]=decodeAbiParameters(parseAbiParameters('address,address,uint256'),params[2]);
 assert.equal(treasury.toLowerCase(),TREASURY_ADDRESS.toLowerCase());assert.equal(fee,200n);
 assert.throws(()=>batchSaleCall(USER,Array.from({length:21},(_,i)=>({token:token('0x'+(i+10).toString(16).padStart(40,'0')),imdOut:10000n})),100n));
});
test('v2, v3 and WETH bridging encode native credit settlement with a gross output floor',()=>{
 for(const kind of ['v2','v3','weth']){
 const t=token(kind==='weth'?WETH:A);t.liveRoute={...t.liveRoute,pools:[pool(ZERO,IMD_ADDRESS)],bridge:{kind,path:kind==='weth'?[WETH]:[A,WETH],fees:kind==='v3'?[3000]:[],amountOut:500n}};
 const call=batchSaleCall(USER,[{token:t,imdOut:10000n}],100n);assert.equal(call.args[0],kind==='v2'?'0x080c10':kind==='v3'?'0x000c10':'0x020c10');
 const [actions,params]=decodeAbiParameters(parseAbiParameters('bytes,bytes[]'),call.args[1].at(-1));assert.equal(actions,'0x0b07100f');
 const [,amount,payer]=decodeAbiParameters(parseAbiParameters('address,uint256,bool'),params[0]);assert.equal(amount,1n<<255n);assert.equal(payer,false);
 }
 assert.throws(()=>packedPath([A,WETH],[]));
});
test('new inventory scans all indexed ERC-20s, batches refunds, streams balances before quotes, and retains unpriced tokens',async()=>{
 const previous=global.fetch;global.fetch=async()=>({ok:true,json:async()=>({exchange_rate:'2'})});
 const calls=[],events=[];const snapshot={version:1,chainId:1,blockNumber:10,blockHash:HASH,registries:REGISTRIES.map(r=>({...r,count:1})),tokens:[{address:A,launchNumber:1,blockNumber:1,transactionHash:HASH}]};
 const pools=[pool(A,IMD_ADDRESS),pool(B,IMD_ADDRESS)];
 const client={getChainId:async()=>1,getBlockNumber:async()=>10n,getBlock:async()=>({hash:HASH}),multicall:async({contracts})=>{calls.push(contracts);return contracts.map(c=>({status:'success',result:c.functionName==='balanceOf'?1000n:c.functionName==='heldRefunds'?0n:c.functionName==='decimals'?18:c.functionName==='symbol'?(c.address===A?'ALPHA':'OUTSIDE_SWARM'):100n}));},simulateContract:async()=>{events.push('quote');return {result:[10000n,1n]};}};
 try{const state=await scanWallet(client,USER,{indexed:{tokens:[{address:B,usdPrice:null}],complete:true,warnings:[]},snapshot,poolSnapshot:{version:1,chainId:1,blockNumber:10,blockHash:HASH,pools},onUpdate:s=>{if(s.tokens.every(t=>!t.routeChecked))events.push('holdings');}});
 assert.equal(state.tokens.length,2);assert.equal(state.tokens.find(t=>t.address===B).usdValue,null);assert.equal(state.tokens.find(t=>t.address===B).sellable,true);assert.equal(events[0],'holdings');assert.ok(calls.flat().some(c=>c.functionName==='heldRefunds'&&c.address===SWARM_EXIT_ADDRESS));assert.ok(calls.flat().some(c=>c.address===B&&c.functionName==='balanceOf'));
 }finally{global.fetch=previous;}
});
test('cancelled inventory scans stop before token/indexer work',async()=>{
 const abort=new AbortController();abort.abort();let reads=0;
 await assert.rejects(scanWallet({getChainId:async()=>1,getBlockNumber:async()=>{reads++;return 1n;}},USER,{signal:abort.signal}));assert.equal(reads,0);
});

test('every execution and quote target is a valid Ethereum address',async()=>{
 const {isAddress}=await import('viem');const markets=await import('../src/lib/markets.ts');const routes=await import('../src/lib/routes.ts');
 for(const key of ['V2_ROUTER','V2_FACTORY','V3_FACTORY','V3_QUOTER','WETH','USDC'])assert.ok(isAddress(markets[key],{strict:false}),key);
 for(const key of ['PERMIT2','POOL_MANAGER','UNIVERSAL_ROUTER','V4_QUOTER','STATE_VIEW'])assert.ok(isAddress(routes[key],{strict:false}),key);
});

test('explicit rejection of unsupported atomic RPC releases its request lock without fallback',async()=>{
 const h=harness({atomic:true});const plan=await planBatchSale(h.client,USER,[token()],h.wallet);
 h.wallet.sendCalls=async()=>{throw Object.assign(Error('wallet_sendCalls not supported'),{code:4200});};
 const result=await executeBatchSale(h.wallet,h.client,USER,plan,()=>{});assert.equal(result.get(A).kind,'unsold');assert.equal(storedPending(USER).size,0);assert.equal(h.writes.length,0);
});
test('a definitive wallet batch failure is reported as failed rather than unknown',async()=>{
 const h=harness({atomic:true});const plan=await planBatchSale(h.client,USER,[token()],h.wallet);
 h.wallet.waitForCallsStatus=async()=>({status:'failure',statusCode:400,atomic:true,receipts:[]});
 const result=await executeBatchSale(h.wallet,h.client,USER,plan,()=>{});assert.equal(result.get(A).kind,'unsold');assert.equal(storedPending(USER).size,0);
});

test('quick-search coverage limits are grouped once while each token retains its detailed reason',async()=>{
 const previous=global.fetch;global.fetch=async()=>({ok:true,json:async()=>({exchange_rate:'2'})});
 const snapshot={version:1,chainId:1,blockNumber:10,blockHash:HASH,registries:REGISTRIES.map(r=>({...r,count:1})),tokens:[A,B].map((address,i)=>({address,launchNumber:i+1,blockNumber:1,transactionHash:HASH}))};
 const pools=[A,B].flatMap(address=>Array.from({length:10},(_,i)=>pool(address,IMD_ADDRESS,100+i)));
 const client={getChainId:async()=>1,getBlockNumber:async()=>10n,getBlock:async()=>({hash:HASH}),multicall:async({contracts})=>contracts.map(c=>({status:'success',result:c.functionName==='balanceOf'?1000n:c.functionName==='heldRefunds'?0n:c.functionName==='decimals'?18:c.functionName==='symbol'?'TEST':100n})),readContract:async()=>ZERO,simulateContract:async()=>{throw Error('execution reverted');}};
 try{const state=await scanWallet(client,USER,{indexed:{tokens:[],complete:true,warnings:[]},snapshot,poolSnapshot:{version:1,chainId:1,blockNumber:10,blockHash:HASH,pools}});assert.equal(state.tokens.length,2);assert.equal(state.complete,false);assert.equal(state.incompleteRoutes,2);assert.equal(state.warnings.length,1);assert.match(state.warnings[0],/^2 token route searches/);assert.ok(state.tokens.every(t=>t.routeReason.includes('6 of 10')));}finally{global.fetch=previous;}
});
