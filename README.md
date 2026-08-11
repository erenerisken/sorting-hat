# Büyülü Masa Şapkası — OpenAI Realtime MVP

Düğünde misafirin adını dinleyen, lokal SQLite listesinden masasını bulan ve büyülü bir şapka karakteriyle sesli olarak açıklayan tek-repo React + Node.js uygulaması.

## Özellikler

- `Space` tuşuyla yeni oturum başlatma
- Tarayıcı mikrofonu ve hoparlörüyle WebRTC ses akışı
- OpenAI Realtime API ile konuşmadan konuşmaya yanıt
- API anahtarının sadece Node.js sunucusunda tutulması
- Lokal SQLite davetli listesi ve CSV ile içe aktarma
- Türkçe karakterleri normalize eden fuzzy isim eşleştirme
- Masa numarasının yalnızca `find_guest` tool sonucundan alınması
- VAD ile konuşma başlangıcı/bitişi algılama
- Otomatik oturum kapatma ve 45 saniye timeout
- Görevli olay paneli

## Gereksinimler

- Node.js 20+
- Mikrofon ve hoparlör
- OpenAI API anahtarı
- Chrome veya Edge gibi güncel bir tarayıcı

## Kurulum

```bash
cp .env.example .env
# .env içine OPENAI_API_KEY ekleyin
npm install
npm run dev
```

Tarayıcıda `http://localhost:5173` adresini açın. Mikrofon izni verin. Yeni misafir geldiğinde sayfanın odakta olduğundan emin olup `Space` tuşuna basın.

## Production / düğün modu

```bash
npm run build
npm start
```

Ardından `http://localhost:3000` adresini açın.

## Docker ile yerel çalıştırma

Bu proje yerel kullanım için `.env` dosyasını image içine kopyalar. Image'ı paylaşmayın; içindeki OpenAI API anahtarı image erişimi olan kişiler tarafından okunabilir.

```bash
docker compose build
docker compose up -d
```

Ardından `http://localhost:3000` adresini açın. SQLite verileri `guest-data` adlı Docker volume'ünde saklanır. Uygulama logları `docker compose logs -f` ile izlenebilir.

Windows'a image tar dosyasıyla taşırken `sorting-hat-local-amd64.tar`, `compose.yaml` ve `start-windows.bat` dosyalarını aynı klasöre koyup batch dosyasını çalıştırın.

Image'ı sıfırdan yeniden oluşturup Windows arşivini güncellemek için:

```bash
make rebuild
```

`make run` container'ı yeniden oluşturup başlatır; `make stop` durdurur.

## Davetli listesi

Uygulama davetlileri `.env` içindeki `GUESTS_DB_PATH` ile seçilen SQLite veritabanında tutar. Veritabanı ilk açılışta boştur. Sol taraftaki **CSV yükle** düğmesiyle aşağıdaki biçimde bir dosya yükleyin:

```csv
fullName,tableNumber,aliases
Ahmet Yılmaz,12,"Ahmet;Ahmet Bey"
```

- `aliases` isteğe bağlıdır.
- Birden fazla alias `;` ile ayrılır.
- `fullName` benzersiz davetli anahtarıdır.
- Yüklemeler mevcut kayıtları günceller; CSV'de bulunmayan davetlileri silmez ve kaydedilmiş bağlamları korur.
- Aynı dosyadaki birebir tekrarlar tek kayıt sayılır. Aynı ad için çelişen masa veya alias bilgisi varsa dosyanın tamamı reddedilir.
- **Sıfırla** düğmesi, onaydan sonra tüm davetlileri ve kayıtlı bağlamlarını siler.
- **+ Davetli** ile tek kayıt eklenebilir; listedeki **Düzenle** eylemi ad, masa ve alias bilgilerini günceller veya davetliyi silebilir.

## Düğün günü önerileri

1. Laptopu prize bağlayın ve uyku modunu kapatın.
2. Salon Wi-Fi’si yerine telefon hotspot’u veya size ait modem kullanın.
3. Harici, ağza yakın yönlü mikrofon kullanın.
4. Hoparlör sesinin mikrofona dönmesini azaltmak için mikrofon ile hoparlörü fiziksel olarak ayırın.
5. Gerçek davetli listesiyle, salon müziği açıkken prova yapın.
6. İnternet kesintisi için masaları gösteren manuel bir yedek liste bulundurun.

## Ses karakteri

`.env` içindeki `OPENAI_REALTIME_VOICE` değerini değiştirebilirsiniz. Uygulama prompt’u belirli bir film karakterini veya oyuncuyu kopyalamadan yaşlı, gizemli ve teatral bir karakter ister.

## Mimari

```text
React / browser
  ├─ Space trigger
  ├─ microphone + speaker
  ├─ WebRTC → OpenAI Realtime
  └─ tool event → POST /api/find-guest

Node.js / Express
  ├─ React production build
  ├─ OpenAI Realtime session bootstrap
  ├─ API key protection
  └─ SQLite guest store + transactional CSV import + fuzzy matching
```

## Not

OpenAI Realtime API ve model adları zamanla değişebilir. Modeli `.env` içindeki `OPENAI_REALTIME_MODEL` ile değiştirebilirsiniz.
