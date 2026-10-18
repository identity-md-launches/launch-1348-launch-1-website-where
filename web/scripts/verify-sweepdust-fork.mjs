// Executes only against a disposable local Anvil fork. No contracts are deployed.
// The temporary signing key is generated in memory and is never printed or saved.
// node --experimental-strip-types web/scripts/verify-sweepdust-fork.mjs [--upstream=https://…] [--out=test/scratch/sweepdust-fork.json]
// Run verify-sweepdust.mjs --out=test/scratch/live-sweepdust-fast.json first.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { createPublicClient, createWalletClient, http, parseAbi, parseUnits } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';
import assert from 'node:assert/strict';
import { batchSaleCall, executeBatchSale, planBatchSale } from '../src/lib/batchSale.ts';
import { quoteLiveRoute, quoteBridge, WETH, USDC, V2_ROUTER } from '../src/lib/markets.ts';
import { findFastV4Route } from '../src/lib/markets.ts';
import { MAX_INPUT, NATIVE, PERMIT2, UNIVERSAL_ROUTER } from '../src/lib/routes.ts';
import { permitAbi } from '../src/lib/directSale.ts';
import { erc20Abi } from '../src/abi/erc20.ts';
import { IMD_ADDRESS, TREASURY_ADDRESS } from '../src/deployment.ts';
const upstream=process.argv.find(a=>a.startsWith('--upstream='))?.slice(11)??'https://eth.drpc.org';
const out=process.argv.find(a=>a.startsWith('--out='))?.slice(6)??'test/scratch/sweepdust-fork.json';
const evidence=JSON.parse(await readFile(new URL('../../test/scratch/live-sweepdust-fast.json',import.meta.url),'utf8'));
const snapshot=JSON.parse(await readFile(new URL('../public/pools.json',import.meta.url),'utf8'));
const listener=createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
const cwd=await mkdtemp('/tmp/sweepdust-fork-');
const child=spawn('anvil',['--fork-url',upstream,'--fork-block-number',evidence.blockNumber,'--chain-id','1','--port',String(port),'--silent','--no-storage-caching'],{cwd,stdio:['ignore','ignore','pipe']});let launchError;child.on('error',e=>launchError=e);
const endpoint=`http://127.0.0.1:${port}`;
const client=createPublicClient({chain:mainnet,transport:http(endpoint,{retryCount:0,timeout:30000})});
const account=privateKeyToAccount(generatePrivateKey());
const wallet=createWalletClient({account,chain:mainnet,transport:http(endpoint,{retryCount:0,timeout:30000})});
const owner=evidence.account;
const holder=createWalletClient({account:owner,chain:mainnet,transport:http(endpoint,{retryCount:0,timeout:30000})});
const writes=[],signatureRequests=[];
const originalWrite=wallet.writeContract;wallet.writeContract=async call=>{writes.push({functionName:call.functionName,address:call.address});return originalWrite({...call,account});};
const originalSign=wallet.signTypedData;wallet.signTypedData=async message=>{signatureRequests.push({type:message.primaryType,tokens:message.message.details.length});return originalSign({...message,account});};
const report={kind:'disposable local Ethereum fork',at:new Date().toISOString(),blockNumber:evidence.blockNumber,mainnetTransactionsSent:0,contractsDeployed:0,checks:[]};
const check=(condition,name)=>{assert.ok(condition,name);report.checks.push({name,passed:true});console.log(name);};
const balance=(token,address)=>client.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[address]});
const wait=async hash=>{const receipt=await client.waitForTransactionReceipt({hash,timeout:30000});assert.equal(receipt.status,'success');return receipt;};
const routeFromJson=r=>({...r,amountIn:BigInt(r.amountIn),amountOut:BigInt(r.amountOut),blockNumber:BigInt(r.blockNumber),pools:r.pools.map(p=>({...p,liquidity:p.liquidity===undefined?undefined:BigInt(p.liquidity)})),bridge:r.bridge?{...r.bridge,amountOut:BigInt(r.bridge.amountOut)}:undefined});
const convert=(t,amount,route)=>({address:t.address,symbol:t.symbol,decimals:t.decimals,balance:amount,expectedImd:route.amountOut,sellable:true,status:0,route:null,routeLabel:'fork check',heldRefund:0n,liveRoute:route});
async function runSale(tokens,name){
 const beforeUser=await balance(IMD_ADDRESS,account.address),beforeFee=await balance(IMD_ADDRESS,TREASURY_ADDRESS);
 const beforeWrites=writes.length,beforeSignatures=signatureRequests.length;
 const plan=await planBatchSale(client,account.address,tokens,wallet,false);
 assert.equal(plan.items.length,tokens.length,JSON.stringify(plan.excluded.map(x=>({symbol:x.token.symbol,reason:x.reason}))));
 const result=await executeBatchSale(wallet,client,account.address,plan,p=>{if(p.step==='sign')console.log(`Confirming local ${name}`);});
 assert.ok([...result.values()].every(r=>r.kind==='sold'),JSON.stringify([...result.values()],(_k,v)=>typeof v==='bigint'?String(v):v));
 const received=await balance(IMD_ADDRESS,account.address)-beforeUser,fee=await balance(IMD_ADDRESS,TREASURY_ADDRESS)-beforeFee;
 const gross=[...result.values()].reduce((s,r)=>s+r.imdOut,0n),expectedFee=[...result.values()].reduce((s,r)=>s+r.imdOut*200n/10000n,0n);
 check(received===gross-expectedFee&&fee===expectedFee,`${name}: actual IMD recipient and exact 2% per-token treasury fee`);
 check(writes.slice(beforeWrites).filter(w=>w.functionName==='execute').length===1,`${name}: one combined sale transaction`);
 check(signatureRequests.length-beforeSignatures===1,`${name}: one real PermitBatch typed signature`);
 check((await Promise.all(tokens.map(t=>balance(t.address,account.address)))).every(x=>x===0n),`${name}: only the exact reviewed input balances spent`);
 report[name]={tokens:tokens.map(t=>t.address),receivedImd:received.toString(),treasuryImd:fee.toString(),transactionHashes:[...new Set([...result.values()].map(r=>r.txHash))]};
}
try{
 for(let attempt=0;;attempt++){try{if(await client.getChainId()===1)break;}catch{if(launchError)throw launchError;if(attempt>80)throw Error('Local fork did not start');await new Promise(r=>setTimeout(r,200));}}
 await client.request({method:'anvil_setBalance',params:[account.address,'0x56bc75e2d63100000']});
 await client.request({method:'anvil_setBalance',params:[owner,'0x56bc75e2d63100000']});
 await client.request({method:'anvil_impersonateAccount',params:[owner]});
 const selected=evidence.tokens.filter(t=>t.sellable&&!t.liveRoute.bridge).slice(0,2);
 assert.equal(selected.length,2,'two real quoted holdings are required for the batch check');
 const tokens=[];
 const transferAbi=parseAbi(['function transfer(address recipient,uint256 amount) returns (bool)']);
 for(const t of selected){const prior=routeFromJson(t.liveRoute);const amount=prior.amountIn/1000n||1n;await wait(await holder.writeContract({address:t.address,abi:transferAbi,functionName:'transfer',args:[account.address,amount],chain:mainnet}));const held=await balance(t.address,account.address);assert.ok(held>0n);const fresh=await quoteLiveRoute(client,account.address,t.address,held,prior,await client.getBlockNumber({cacheTime:0}));tokens.push(convert(t,held,fresh));}
 const before=await client.request({method:'evm_snapshot'});
 await runSale(tokens,'two-token-batch');
 // Exercise the new WETH -> native ETH -> IMD settlement against actual deployed bytecode.
 const amount=parseUnits('0.000001',18);
 await wait(await wallet.writeContract({address:WETH,abi:parseAbi(['function deposit() payable']),functionName:'deposit',value:amount,chain:mainnet}));
 const native=await findFastV4Route(client,account.address,NATIVE,amount,snapshot.pools,await client.getBlockNumber({cacheTime:0}));assert.ok(native.route,'native ETH -> IMD quote');
 const wrapped={...native.route,amountIn:amount,bridge:{kind:'weth',path:[WETH],fees:[],amountOut:amount}};
 await runSale([convert({address:WETH,symbol:'WETH',decimals:18},amount,wrapped)],'wrapped-eth-bridge');
 // Buy a small real USDC balance locally, then verify the v2 first leg followed by v4 IMD.
 const v2SwapAbi=parseAbi(['function swapExactETHForTokens(uint256 amountOutMin,address[] path,address to,uint256 deadline) payable returns (uint256[] amounts)']);
 await wait(await wallet.writeContract({address:V2_ROUTER,abi:v2SwapAbi,functionName:'swapExactETHForTokens',args:[1n,[WETH,USDC],account.address,BigInt(Math.floor(Date.now()/1000)+600)],value:parseUnits('0.00001',18),chain:mainnet}));
 const usdc=await balance(USDC,account.address);
 const bridge={kind:'v2',path:[USDC,WETH],fees:[],amountOut:0n};bridge.amountOut=await quoteBridge(client,account.address,usdc,bridge,await client.getBlockNumber({cacheTime:0}));
 const viaEth=await findFastV4Route(client,account.address,NATIVE,bridge.amountOut,snapshot.pools,await client.getBlockNumber({cacheTime:0}));assert.ok(viaEth.route);
 await runSale([convert({address:USDC,symbol:'USDC',decimals:6},usdc,{...viaEth.route,amountIn:usdc,bridge})],'v2-to-v4-bridge');
 const v3Token=evidence.tokens.find(t=>t.sellable&&t.liveRoute.bridge?.kind==='v3');
 assert.ok(v3Token,'a real non-Swarm v3 route is required');
 const previousRoute=routeFromJson(v3Token.liveRoute),v3Amount=previousRoute.amountIn/1000n||1n;
 await wait(await holder.writeContract({address:v3Token.address,abi:transferAbi,functionName:'transfer',args:[account.address,v3Amount],chain:mainnet}));
 const v3Held=await balance(v3Token.address,account.address),v3Route=await quoteLiveRoute(client,account.address,v3Token.address,v3Held,previousRoute,await client.getBlockNumber({cacheTime:0}));
 await runSale([convert(v3Token,v3Held,v3Route)],'v3-to-v4-bridge');
 await client.request({method:'evm_revert',params:[before]});
 for(const t of tokens){await wait(await wallet.writeContract({address:t.address,abi:erc20Abi,functionName:'approve',args:[PERMIT2,t.balance],chain:mainnet}));await wait(await wallet.writeContract({address:PERMIT2,abi:permitAbi,functionName:'approve',args:[t.address,UNIVERSAL_ROUTER,t.balance,Math.floor(Date.now()/1000)+600],chain:mainnet}));}
 const userBefore=await balance(IMD_ADDRESS,account.address),feeBefore=await balance(IMD_ADDRESS,TREASURY_ADDRESS),inputBefore=await Promise.all(tokens.map(t=>balance(t.address,account.address)));
 const impossible=tokens.map((token,i)=>({token,imdOut:i===1?MAX_INPUT:token.expectedImd}));
 const bad=batchSaleCall(account.address,impossible,BigInt(Math.floor(Date.now()/1000)+600));
 const hash=await wallet.writeContract({...bad,chain:mainnet,gas:3_000_000n});const receipt=await client.waitForTransactionReceipt({hash});
 check(receipt.status==='reverted','one failed output floor reverts the entire batch');
 check((await Promise.all(tokens.map(t=>balance(t.address,account.address)))).every((value,i)=>value===inputBefore[i]),'reverted batch leaves both input tokens in the wallet');
 check(await balance(IMD_ADDRESS,account.address)===userBefore&&await balance(IMD_ADDRESS,TREASURY_ADDRESS)===feeBefore,'reverted batch changes no IMD balance and charges no sale fee');
 report.passed=true;
}catch(error){report.passed=false;report.error=error instanceof Error?error.message.split('\n')[0]:String(error);throw error;}
finally{await writeFile(out,JSON.stringify(report,null,2)+'\n');child.kill('SIGTERM');await new Promise(r=>{child.once('exit',r);setTimeout(r,2000);});}
