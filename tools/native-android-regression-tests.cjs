const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync("lib/client/native-android.ts", "utf8");
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: exportsObject });
const detect = exportsObject.isNativeAndroidWebView;
for (const kind of ["main", "driver", "schnell"]) assert.equal(detect(`Mozilla/5.0 Android 13 Chrome/130 BurgerBrothers-Android/${kind}`), true);
for (const ua of ["", "Mozilla/5.0 Android 13 Chrome/130", "BurgerBrothers-iOS/main", "BurgerBrothers-Android/other", "BurgerBrothers-Android/mainly", "BurgerBrothers-Android/main-legacy", "BurgerBrothers-Android/main/extra"]) assert.equal(detect(ua), false);
assert.equal(detect(), false, "SSR has no navigator");
console.log("Native Android detection: PASS (installed-app UX, browser fallback, SSR)");

// Execute the actual private installation guards, not copies of their conditions.
function guardModule(file,names){
  const code=fs.readFileSync(file,"utf8");const ast=ts.createSourceFile(file,code,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const functions=ast.statements.filter(node=>ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
  assert.equal(functions.length,names.length,`Missing install guard in ${file}`);
  const context={navigator:{userAgent:"",standalone:false},window:{matchMedia:()=>({matches:false})}};
  vm.createContext(context);
  const detector=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  context.exports={};vm.runInContext(detector,context);context.isNativeAndroidWebView=context.exports.isNativeAndroidWebView;
  vm.runInContext(ts.transpileModule(functions.map(fn=>fn.getText(ast)).join("\n"),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  return context;
}
for(const [file,names,installedName] of [
  ["components/schnellbestellung/SchnellEnterClient.tsx",["isStandaloneDisplayMode"],"isStandaloneDisplayMode"],
  ["components/schnellbestellung/SchnellInstallClient.tsx",["isStandaloneMode"],"isStandaloneMode"],
  ["components/schnellbestellung/SchnellClient.tsx",["isInstalledAppContext","isAndroidBrowserWithoutInstalledMode"],"isInstalledAppContext"],
]){
  const context=guardModule(file,names);
  context.navigator.userAgent="Mozilla/5.0 (Linux; Android 13; wv) BurgerBrothers-Android/schnell";
  assert.equal(context[installedName](),true,`${file}: Native Schnell must not be redirected to installation`);
  if(context.isAndroidBrowserWithoutInstalledMode)assert.equal(context.isAndroidBrowserWithoutInstalledMode(),false);
  context.navigator.userAgent="Mozilla/5.0 (Linux; Android 13) Chrome/150 Mobile";
  assert.equal(context[installedName](),false,`${file}: A normal browser keeps the installation requirement`);
  if(context.isAndroidBrowserWithoutInstalledMode)assert.equal(context.isAndroidBrowserWithoutInstalledMode(),true);
  context.window.matchMedia=()=>({matches:true});assert.equal(context[installedName](),true);
}
console.log("Schnell installation guards: PASS (native entry/install/menu, normal browser restriction, installed PWA)");
