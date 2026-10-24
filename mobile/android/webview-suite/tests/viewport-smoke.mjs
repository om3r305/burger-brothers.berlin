import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { connect } from './cdp.mjs';

// Run against a debug customer WebView on /menu with the order-type dialog open.
// Never clicks an order-submit/payment button or changes the restaurant configuration.
const client = await connect(Number(process.env.CDP_PORT || 9223));
const folder = new URL('../build/emulator-evidence/', import.meta.url);
await mkdir(folder, { recursive:true });
const results = [];
try {
  assert.equal(await client.evaluate(`location.pathname`), '/menu');
  for (const [width,height] of [[360,640],[360,800],[390,844]]) {
    await client.send('Emulation.setDeviceMetricsOverride', { width,height,deviceScaleFactor:2,mobile:true });
    await new Promise(r => setTimeout(r, 300));
    const result = await client.evaluate(`(() => {
      const dialog = document.querySelector('[role=dialog][aria-label="Bestellart wählen"]') || [...document.querySelectorAll('[role=dialog]')].find(e=>e.textContent.includes('Wie möchten Sie bestellen?'));
      if (!dialog) throw new Error('Order-type dialog missing');
      const buttons = [...dialog.querySelectorAll('button')];
      buttons[buttons.length-1].scrollIntoView({block:'nearest'});
      return {viewport:[innerWidth,innerHeight], buttons:buttons.map(b=>({text:b.textContent.trim(),disabled:b.disabled,top:b.getBoundingClientRect().top,bottom:b.getBoundingClientRect().bottom}))};
    })()`);
    for (const button of result.buttons) {
      assert.ok(button.top >= -1 && button.bottom <= height+1, `${width}x${height}: ${button.text} outside viewport`);
    }
    const screenshot = await client.send('Page.captureScreenshot', { format:'png' });
    await writeFile(new URL(`order-type-${width}x${height}.png`,folder), Buffer.from(screenshot.data,'base64'));
    results.push({size:`${width}x${height}`,status:'PASS',...result});
  }
  await writeFile(new URL('viewport-results.json',folder), JSON.stringify(results,null,2));
  console.log(JSON.stringify(results,null,2));
} finally {
  await client.send('Emulation.clearDeviceMetricsOverride');
  client.close();
}
