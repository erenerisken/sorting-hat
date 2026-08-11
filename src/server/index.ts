import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GuestImportError, GuestStore } from "./guest-store.js";

const port = Number(process.env.PORT ?? 3000);
const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime-2.1-mini";
const voice = process.env.OPENAI_REALTIME_VOICE ?? "cedar";
const guestsDatabasePath = process.env.GUESTS_DB_PATH ?? "./data/guests.sqlite";
const guestStore = new GuestStore(guestsDatabasePath);

const app = express();
app.use(express.json());
app.use(express.text({ type: ["application/sdp", "text/plain", "text/csv"], limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, guests: guestStore.list().length, model, voice });
});

app.get("/api/guests", (_req, res) => {
  res.json(guestStore.list());
});

app.post("/api/guests/import", (req, res) => {
  if (typeof req.body !== "string") {
    res.status(400).json({ error: "CSV içeriği text/csv olarak gönderilmelidir." });
    return;
  }
  try {
    res.json({ ok: true, ...guestStore.importCsv(req.body) });
  } catch (error) {
    if (error instanceof GuestImportError) {
      res.status(400).json({ error: error.message, ...(error.row ? { row: error.row } : {}) });
      return;
    }
    console.error(error);
    res.status(500).json({ error: "Davetli listesi içe aktarılamadı." });
  }
});

app.delete("/api/guests", (_req, res) => {
  res.json({ ok: true, deleted: guestStore.deleteAll() });
});

app.put("/api/guest-context", (req, res) => {
  const fullName = typeof req.body?.fullName === "string" ? req.body.fullName.trim() : "";
  const tableNumber = typeof req.body?.tableNumber === "string" ? req.body.tableNumber.trim() : "";
  const context = typeof req.body?.context === "string" ? req.body.context.trim() : "";
  if (!guestStore.get(fullName, tableNumber)) {
    res.status(404).json({ error: "Davetli bulunamadı." });
    return;
  }
  if (context.length > 500) {
    res.status(400).json({ error: "Bağlam en fazla 500 karakter olabilir." });
    return;
  }
  res.json({ ok: true, guestContext: guestStore.setContext(fullName, tableNumber, context) });
});

app.post("/api/guest-context/lookup", (req, res) => {
  const fullName = typeof req.body?.fullName === "string" ? req.body.fullName.trim() : "";
  const tableNumber = typeof req.body?.tableNumber === "string" ? req.body.tableNumber.trim() : "";
  const guest = guestStore.get(fullName, tableNumber);
  res.json({
    fullName,
    tableNumber,
    found: Boolean(guest?.context),
    context: guest?.context ?? ""
  });
});

app.post("/api/find-guest", (req, res) => {
  const spokenName = typeof req.body?.spokenName === "string" ? req.body.spokenName : "";
  res.json(guestStore.find(spokenName));
});

app.post("/api/realtime/session", async (req, res) => {
  if (!apiKey) {
    res.status(500).json({ error: "OPENAI_API_KEY tanımlı değil." });
    return;
  }

  const instructions = `
ROL:
Sen Hogwarts Büyük Salon'daki kadim Seçmen Şapka'dan esinlenen, düğüne uyarlanmış büyülü bir şapkasın. Yalnızca Türkçe konuş.
Konukların cesaretini, sadakatini, zekâsını veya hırsını tartıyormuş gibi kısa imalarda bulun; fakat onları Hogwarts binalarına değil düğün masalarına yerleştir.

SES PERFORMANSI:
- Alçak perdeli, yaşlı, kuru ve hafif çatallı konuş.
- Ses sanki eski kumaşın içinden geliyormuş gibi biraz boğuk; tempo ağırbaşlı ama akıcı olsun.
- Karardan önce yalnızca bir kısa "hmm" veya minicik dramatik duraklama kullanabilirsin.

DÜĞÜN MİZAHI:
- Bulunan konukların yaklaşık yarısında, masa kararından önce tek cümlelik eğlenceli bir düğün kehaneti yap.
- Pasta, dans pisti, halay, nikâh şekeri, takı sırası veya fotoğraf telaşı gibi zararsız düğün ayrıntılarıyla şakalaş.
- Örneğin pastaya yakın bir masa istediğini sezebilir veya dans pistinden kaçamayacağı bir yer görebilirsin; bu örnekleri aynen tekrarlama, çeşitlendir.
- Bu kehanetlerin mizah olduğunu hissettir

AKIŞ:
1. Oturum açıldığında şapka üslubuyla adını ve soyadını iste; en fazla 10 kelime kullan.
2. Kullanıcı adını söylediğinde mutlaka find_guest aracını çağır. Masa numarasını asla tahmin etme.
3. find_guest sonucu found ise, bulunan konuğun fullName ve tableNumber değerleriyle mutlaka get_guest_context aracını çağır; sonucu almadan nihai yanıt verme.
4. Kayıtlı bağlam varsa kişiselleştirmenin ana kaynağı odur: nihai yanıtın ilk cümlesini bu bağlamdaki en ayırt edici ayrıntıya dayandır. Genel şapka sözleri veya rastgele düğün şakaları yerine bağlamı tercih et; uygun bir bağlamı sessizce geçme.
5. Bağlamı doğal biçimde yeniden ifade et; aynen okuma. Bağlamlar zaten kullanıcı tarafından filtreden geçiyor o yüzden bağlamların kırıcılığı konusunda endişelenme. Katılımcılar kara mizah sever.
6. Kayıtlı bağlam yoksa bazen tek bir kısa büyülü düğün şakası yap. Bağlam varsa yalnızca onunla doğal biçimde birleşen bir düğün şakası ekle; aksi halde şakayı atla.
7. Ardından adıyla masa numarasını tek cümlede açıkla.
8. ambiguous ise tek cümlede soyadını veya tam adını tekrar sor.
9. not_found ise tek cümlede adını ve soyadını yavaşça tekrar söylemesini iste.
10. Masa açıklandıktan sonra tam olarak "Seçim tamamlandı." cümlesiyle bitir.

KURALLAR:
- Nihai yanıt toplam en fazla 15 saniyeyi geçmesin.
- Gereksiz selamlama, açıklama, tekrar veya kapanış ekleme.
- Araçtan gelmeyen masa numarasını söyleme.
`;

  const sessionConfig = JSON.stringify({
    type: "realtime",
    model,
    instructions,
    output_modalities: ["audio"],
    audio: {
      input: {
        turn_detection: {
          type: "server_vad",
          threshold: 0.68,
          prefix_padding_ms: 350,
          silence_duration_ms: 900,
          create_response: true,
          interrupt_response: false
        }
      },
      output: { voice }
    },
    tools: [
      {
        type: "function",
        name: "find_guest",
        description: "Konuşulan ad ve soyada göre lokal düğün davetli listesini arar. Masa numarası için tek güvenilir kaynaktır.",
        parameters: {
          type: "object",
          properties: {
            spokenName: {
              type: "string",
              description: "Kullanıcının söylediği ad ve soyad. Duyulduğu biçime mümkün olduğunca sadık kal."
            }
          },
          required: ["spokenName"],
          additionalProperties: false
        }
      },
      {
        type: "function",
        name: "get_guest_context",
        description: "Bulunan davetli için görevlinin kaydettiği isteğe bağlı kişisel bağlamı getirir. find_guest başarılı olduktan sonra çağrılmalıdır.",
        parameters: {
          type: "object",
          properties: {
            fullName: {
              type: "string",
              description: "find_guest sonucundaki guest.fullName değerini aynen kullan."
            },
            tableNumber: {
              type: "string",
              description: "find_guest sonucundaki guest.tableNumber değerini aynen kullan."
            }
          },
          required: ["fullName", "tableNumber"],
          additionalProperties: false
        }
      }
    ],
    tool_choice: "auto"
  });

  const form = new FormData();
  form.set("sdp", req.body);
  form.set("session", sessionConfig);

  try {
    const response = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "OpenAI-Safety-Identifier": "sorting-hat-local-wedding"
      },
      body: form
    });

    const body = await response.text();
    if (!response.ok) {
      console.error("OpenAI session error:", response.status, body);
      res.status(response.status).send(body);
      return;
    }
    res.type("application/sdp").send(body);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Realtime oturumu oluşturulamadı." });
  }
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientPath = path.resolve(__dirname, "../client");
app.use(express.static(clientPath));
app.get("*", (_req, res) => {
  res.sendFile(path.join(clientPath, "index.html"));
});

app.listen(port, () => {
  console.log(`Sorting Hat çalışıyor: http://localhost:${port}`);
  console.log(`${guestStore.list().length} davetli yüklendi.`);
});
