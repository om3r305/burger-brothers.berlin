# Security Policy

Güvenlik açığını herkese açık issue olarak yayımlamayın. GitHub deposundaki
“Report a vulnerability” özel bildirim kanalını kullanın. Bildirimde etkilenen
rota/sürüm, tekrar üretim adımları ve olası etkiyi belirtin; gerçek müşteri
verisi, token, PIN veya parola eklemeyin.

Desteklenen sürüm yalnız `main` dalındaki son production sürümüdür. Kritik
bildirimler için ilk değerlendirme hedefi 48 saat, yüksek bulgular için 5 iş
günüdür. Düzeltme doğrulanana kadar ayrıntıları gizli tutun.

Production secret’ları Vercel/Supabase/işletim sistemi secret store'unda
tutulur. Bir ZIP, log veya mesaj içinde paylaşılan her secret sızmış kabul
edilir ve derhal rotate edilir.
