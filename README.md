# Bordrom Web

Tek seferlik maaş ve görev (harcırah) hesabı. Ana sayfada Maaş hesapla ya da Görev hesapla seçilir; uygulamadaki sihirbaz gibi her ekranda tek soru sorulur, sonuç gösterilir, PDF (tarayıcının "PDF olarak kaydet"i) alınır.
Sunucu tarafı yok; hiçbir veri saklanmaz, çerez ve yerel depolama kullanılmaz. Dosyalar olduğu gibi herhangi bir statik barındırmaya yüklenebilir.

- `app.js`: ana sayfa, iki soru akışı (`FLOWS.maas`, `FLOWS.gorev`), sonuç ve PDF. Adres `#maas` / `#gorev` ile doğrudan açılır.
- `engine.js`: `Harcirah/Engine/*.swift` motorunun birebir JavaScript karşılığı. Swift motoru değişince burası da güncellenmeli.
- `tests/run.sh`: rastgele örneklerde iki motoru kuruşu kuruşuna karşılaştırır (`./web/tests/run.sh 3000`).
- `build.sh`: tarifeleri (`Harcirah/Resources/rates.json`) `rates.js` olarak kopyalar.
- Vergi iki yoldan girilir: dilim seçilir (dilimin alt sınırı kümülatif matrah kabul edilir) ya da önceki ayın bordrosundaki kümülatif matrah elle yazılır (dilim ondan bulunur). Ocak'ta matrah sıfırdır.
- İzin, rapor ve tatil günleri dönem takviminden seçilir; görev tarihleri uygulamadaki gibi önce gidiş, sonra dönüş günüyle seçilir.
- `img/`: uygulama simgesi (`Harcirah/Assets.xcassets/AppIcon`). `app-store-badge.svg`: Apple'ın resmî "Download on the App Store" rozeti (developer.apple.com), değiştirilmeden kullanılmalı.
- CSS/JS bağlantılarındaki `?v=` sürümü her yayında artırılmalı (tarayıcı önbelleği).
- Yerelde açmak: `python3 -m http.server 8765 --directory web`
