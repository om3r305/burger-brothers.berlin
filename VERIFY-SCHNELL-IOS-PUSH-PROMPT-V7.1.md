# VERIFY — iOS Push Prompt V7.1

1. iPhone'daki eski Burger Brothers Home Screen ikonunu silin.
2. QR'ı Safari ile okutun.
3. `Fertig-Benachrichtigung aktivieren` seçin.
4. Safari Paylaş → `Zum Home-Bildschirm` → `Hinzufügen`.
5. Safari'yi kapatın.
6. Ana ekrandaki Burger Brothers ikonunu açın.
7. Adres çubuğu görünmemelidir.
8. `Benachrichtigungen aktivieren` düğmesine dokunun.
9. iOS sistem izin penceresi görünmelidir.
10. İzin verilince uygulama menüyü açmalıdır.
11. Ayarlar → Bildirimler altında Burger Brothers görünmelidir.
12. Sipariş verin, uygulamayı arka plana alın, telefonu kilitleyin ve TV'de
    Fertig yapın.

İzin penceresi çıkmazsa yeni ekran artık nedeni açıkça gösterecektir:
server yapılandırılmamış, servis worker başlatılamadı, abonelik başarısız veya
cihaz desteklemiyor.

Kontroller:
- Targeted TypeScript syntax: OK
- Schnellbestellung regression tests: OK
- TV refactor regression tests: OK
- Secret scan: OK
- ZIP content validation: OK
