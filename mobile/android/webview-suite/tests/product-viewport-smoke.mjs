import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { connect } from './cdp.mjs';

// Precondition: an All American product configuration is open in the debug app.
// Measures real scrolling and hit testing; never sends an order.
const client = await connect(Number(process.env.CDP_PORT || 9223));
const folder = new URL('../build/emulator-evidence/', import.meta.url);
await mkdir(folder,{recursive:true});
const results = [];
try {
  for (const [width,height] of [[360,640],[360,800],[390,844]]) {
    await client.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:2,mobile:true});
    await new Promise(r=>setTimeout(r,300));
    const result = await client.evaluate(`(() => {
      const dialog = document.querySelector('[role=dialog][aria-label$="konfigurieren"]');
      if (!dialog) throw new Error('Product dialog missing');
      const scroll = dialog.querySelector('.bb-modal-scroll');
      if (!scroll) throw new Error('Product scroll container missing');
      scroll.scrollTo({top:scroll.scrollHeight,behavior:'instant'});
      const note = [...dialog.querySelectorAll('input,textarea')].find(e=>e.type==='text' || e.tagName==='TEXTAREA');
      const buttons = [...dialog.querySelectorAll('button')].filter(e=>/gleicher Einstellung|einzeln hinzufügen/.test(e.textContent));
      return {viewport:[innerWidth,innerHeight],scrollTop:scroll.scrollTop,scrollHeight:scroll.scrollHeight,clientHeight:scroll.clientHeight,noteVisible:!!note && note.getBoundingClientRect().top>=scroll.getBoundingClientRect().top && note.getBoundingClientRect().bottom<=scroll.getBoundingClientRect().bottom+1,buttons:buttons.map(b=>{const r=b.getBoundingClientRect();return {text:b.textContent,top:r.top,bottom:r.bottom,hit:b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})};
    })()`);
    console.log(JSON.stringify({size:`${width}x${height}`,measurement:result}));
    assert.equal(result.buttons.length,2);
    assert.ok(result.scrollHeight<=result.clientHeight || result.scrollTop>0,'Inner product content cannot scroll');
    assert.ok(result.noteVisible,'Note field not reachable by scrolling');
    for (const b of result.buttons) assert.ok(b.top>=0 && b.bottom<=height && b.hit,`${width}x${height}: covered product action`);
    results.push({size:`${width}x${height}`,status:'PASS',...result});
    const image = await client.send('Page.captureScreenshot',{format:'png'});
    await writeFile(new URL(`product-${width}x${height}.png`,folder),Buffer.from(image.data,'base64'));
  }
  await writeFile(new URL('product-results.json',folder),JSON.stringify(results,null,2));
  console.log(JSON.stringify(results,null,2));
} finally { await client.send('Emulation.clearDeviceMetricsOverride'); client.close(); }
