// Read-only Ethereum verification. No signing, private key, account unlock or deployment.
// node --experimental-strip-types web/scripts/verify-sweepdust.mjs [--account=0x…] [--deep] [--out=test/scratch/live-sweepdust.json]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createPublicClient, fallback, http } from 'viem';
import { mainnet } from 'viem/chains';
import { scanWallet } from '../src/lib/inventory.ts';
const account = process.argv.find(a=>a.startsWith('--account='))?.split('=')[1] ?? '0x0ace1dbe8aab293cd58d5e3ea38814f0ccb74782';
const out = process.argv.find(a=>a.startsWith('--out='))?.split('=')[1] ?? 'test/scratch/live-sweepdust.json';
const deep = process.argv.includes('--deep');
const counts={}; const originalFetch=globalThis.fetch;
globalThis.fetch=(input,init)=>{const url=new URL(typeof input==='string'?input:input.url??input); counts[url.origin]=(counts[url.origin]??0)+1; return originalFetch(input,init);};
const client=createPublicClient({chain:mainnet,batch:{multicall:{wait:20,batchSize:16384}},transport:fallback(['https://ethereum-rpc.publicnode.com','https://eth.drpc.org'].map(url=>http(url,{timeout:10000,retryCount:0,batch:{wait:20,batchSize:24}})))});
const snapshot=JSON.parse(await readFile(new URL('../public/launches.json',import.meta.url),'utf8'));
const poolSnapshot=JSON.parse(await readFile(new URL('../public/pools.json',import.meta.url),'utf8'));
const started=Date.now();let firstHoldingsMs=null,firstRouteMs=null,lastPrinted=0;
const state=await scanWallet(client,account,{snapshot,poolSnapshot,deep,onUpdate:s=>{if(firstHoldingsMs===null){firstHoldingsMs=Date.now()-started;console.log(`Holdings ready in ${firstHoldingsMs} ms`);}if(firstRouteMs===null&&s.tokens.some(t=>t.sellable)){firstRouteMs=Date.now()-started;console.log(`First live route in ${firstRouteMs} ms`);}},progress:message=>{if(Date.now()-lastPrinted>5000){console.log(message);lastPrinted=Date.now();}}});
const report={at:new Date().toISOString(),kind:'live read-only Ethereum scan',account,chainId:1,blockNumber:state.blockNumber.toString(),deep,firstHoldingsMs,firstRouteMs,durationMs:Date.now()-started,networkRequests:counts,candidates:state.discovered,balancesRead:state.balancesRead,held:state.tokens.length,quoted:state.tokens.filter(t=>t.sellable).length,partial:state.tokens.filter(t=>t.liveRoute&&t.liveRoute.amountIn<t.balance).length,complete:state.complete,imdUsd:state.pricing?.imdUsd??null,warnings:state.warnings,tokens:state.tokens.map(t=>({address:t.address,symbol:t.symbol,decimals:t.decimals,balance:t.balance.toString(),usdValue:t.usdValue,sellable:t.sellable,reason:t.routeReason,liveRoute:t.liveRoute?{...t.liveRoute,amountIn:t.liveRoute.amountIn.toString(),amountOut:t.liveRoute.amountOut.toString(),blockNumber:t.liveRoute.blockNumber.toString(),pools:t.liveRoute.pools.map(p=>({...p,liquidity:p.liquidity?.toString()})),bridge:t.liveRoute.bridge?{...t.liveRoute.bridge,amountOut:t.liveRoute.bridge.amountOut.toString()}:undefined}:undefined}))};
await mkdir(path.dirname(out),{recursive:true});await writeFile(out,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,tokens:undefined,warnings:report.warnings.length},null,2));
if(!report.held||!report.quoted)throw Error('No live holdings or executable quotes were returned for this test wallet. See the recorded report.');
