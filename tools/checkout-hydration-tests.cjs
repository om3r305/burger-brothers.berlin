const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const {renderToString} = require('react-dom/server');
const source = fs.readFileSync('app/checkout/page.tsx','utf8');
const wrapper = source.slice(source.indexOf('export default function CheckoutPage()'),source.indexOf('\nfunction CheckoutContent()'));
let contentReads=0;
function cachedCheckout() {contentReads++;return React.createElement('div',null,'Cached pickup: 35; cart: 6.50');}
function load(hooks) {
 const mod={exports:{}};
 vm.runInNewContext(ts.transpileModule(wrapper,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,
 {module:mod,exports:mod.exports,require,useState:hooks.useState,useEffect:hooks.useEffect,Link:props=>React.createElement('a',{href:props.href},props.children),CheckoutContent:cachedCheckout});
 return mod.exports.default;
}
const Page=load(React);
const server=renderToString(React.createElement(Page));
// A first client render has the same state even if its device cache differs.
const firstClient=load({useState:()=>[false,()=>{}],useEffect:()=>{}});
assert.equal(renderToString(React.createElement(firstClient)),server);
assert.equal(contentReads,0,'device-dependent content must not render before hydration');
assert.match(server,/aria-busy="true"/);
const mountedClient=load({useState:()=>[true,()=>{}],useEffect:()=>{}});
assert.match(renderToString(React.createElement(mountedClient)),/Cached pickup: 35; cart: 6.50/);
assert.equal(contentReads,1,'cart/settings render after hydration');
console.log('Checkout server and first client snapshots match; cached cart/settings render after hydration.');
