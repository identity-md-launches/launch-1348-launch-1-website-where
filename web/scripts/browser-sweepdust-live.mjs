// Read-only production-browser check. It never installs a wallet fixture or invokes a signer.
// IMD_PLAYWRIGHT=/path/to/playwright/index.mjs node web/scripts/browser-sweepdust-live.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const out=path.join(root,'test/scratch/sweepdust-live-browser');fs.mkdirSync(out,{recursive:true});
const {chromium}=await import(process.env.IMD_PLAYWRIGHT?pathToFileURL(process.env.IMD_PLAYWRIGHT).href:'playwright');
const server=http.createServer((req,res)=>{let name=new URL(req.url,'http://x').pathname;if(!name.startsWith('/preview/')){res.writeHead(404).end();return;}name=name.slice(9)||'index.html';const file=path.resolve(root,'dist',name);if(!file.startsWith(path.join(root,'dist')+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'})[path.extname(file)]??'application/octet-stream'});fs.createReadStream(file).pipe(res);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:390,height:844}});
const consoleErrors=[],scriptErrors=[],failedRequests=[];let firstHoldingMs=null,firstRouteMs=null;
page.on('pageerror',error=>scriptErrors.push(error.message));page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});page.on('requestfailed',request=>failedRequests.push({origin:new URL(request.url()).origin,error:request.failure()?.errorText}));
const report={kind:'production browser, live read-only public services',at:new Date().toISOString(),account:'0x0ace1dbe8aab293cd58d5e3ea38814f0ccb74782',width:390,mainnetTransactionsSent:0};
try{
 await page.goto(`http://127.0.0.1:${server.address().port}/preview/`);
 await page.getByLabel('Ethereum wallet address',{exact:true}).fill(report.account);const started=Date.now();await page.getByRole('button',{name:'Scan wallet',exact:true}).click();
 await page.locator('[data-token]').first().waitFor({timeout:45000});firstHoldingMs=Date.now()-started;
 await page.locator('[data-token] input[type="checkbox"]:enabled').first().waitFor({timeout:60000});firstRouteMs=Date.now()-started;
 report.visibleRowsAtCapture=await page.locator('[data-token]').count();report.firstHoldingMs=firstHoldingMs;report.firstRouteMs=firstRouteMs;
 assert.ok(report.visibleRowsAtCapture>0);assert.ok(await page.getByRole('button',{name:/Review sweep/}).isDisabled());
 if(await page.getByRole('button',{name:'Stop scan',exact:true}).count())await page.getByRole('button',{name:'Stop scan',exact:true}).click();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:path.join(out,'390-live-holdings.png'),fullPage:false});
 await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:path.join(out,'1440-live-holdings.png'),fullPage:false});
 report.passed=true;
}catch(error){report.passed=false;report.error=String(error);await page.screenshot({path:path.join(out,'failure.png'),fullPage:false});throw error;}
finally{report.scriptErrors=scriptErrors;report.consoleErrors=consoleErrors;report.failedRequests=failedRequests;await fs.promises.writeFile(path.join(out,'results.json'),JSON.stringify(report,null,2));await browser.close();await new Promise(r=>server.close(r));console.log(JSON.stringify(report,null,2));}
