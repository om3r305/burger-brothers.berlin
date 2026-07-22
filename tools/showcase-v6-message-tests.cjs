const fs = require('fs');
const assert = require('assert');

const stage = fs.readFileSync('components/showcase/ShowcaseStage.tsx', 'utf8');
const css = fs.readFileSync('components/showcase/ShowcaseStage.module.css', 'utf8');
const admin = fs.readFileSync('app/admin/showcase/page.tsx', 'utf8');

assert(stage.includes('className={styles.messageSubtitle}'), 'Duyuru alt basligi ayri render edilmiyor');
assert(stage.includes('className={styles.messageBody}'), 'Duyuru metni ayri render edilmiyor');
assert(!stage.includes('scene.subtitle || scene.body ||'), 'Eski subtitle/body fallback hatasi devam ediyor');
assert(css.includes('.messageBody'), 'Duyuru metni CSS sinifi eksik');
assert(css.includes('white-space: pre-line'), 'Duyuru satir sonlari korunmuyor');
assert(admin.includes('Başlık, alt başlık ve duyuru metni artık ekranda ayrı ayrı gösterilir.'), 'Admin aciklamasi eksik');
assert(admin.includes('label={selected.type === "message" ? "Duyuru metni" : "Ek metin"}'), 'Duyuru alan etiketi eksik');

console.log('Showcase V6 duyuru regresyon testleri gecti.');
