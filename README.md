# Büyülü Masa Şapkası — OpenAI Realtime MVP

Düğünde misafirin adını dinleyen, lokal CSV listesinden masasını bulan ve büyülü bir şapka karakteriyle sesli olarak açıklayan tek-repo React + Node.js uygulaması.

## Özellikler

- `Space` tuşuyla yeni oturum başlatma
- Tarayıcı mikrofonu ve hoparlörüyle WebRTC ses akışı
- OpenAI Realtime API ile konuşmadan konuşmaya yanıt
- API anahtarının sadece Node.js sunucusunda tutulması
- Lokal CSV davetli listesi
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

## Davetli listesi

`data/guests.csv`:

```csv
firstName,lastName,tableNumber,aliases
Ahmet,Yılmaz,12,"Ahmet;Ahmet Bey"
```

- `aliases` isteğe bağlıdır.
- Birden fazla alias `;` ile ayrılır.
- Aynı isimden birden fazla varsa tam isim ve ayırt edici alias ekleyin.

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
  └─ local CSV fuzzy matching
```

## Not

OpenAI Realtime API ve model adları zamanla değişebilir. Modeli `.env` içindeki `OPENAI_REALTIME_MODEL` ile değiştirebilirsiniz.

## Paket doğrulama notu

Repo standart npm paketlerini kullanır. Oluşturulduğu çalışma ortamındaki özel npm aynası `@types/express` paketini sunmadığı için burada tam `npm install`/build testi tamamlanamadı. Normal npm registry kullanan yerel bilgisayarda yukarıdaki kurulum komutlarıyla çalıştırılmak üzere hazırlanmıştır.
