import { useCallback, useEffect, useRef, useState } from "react";

type Status =
  | "IDLE"
  | "CONNECTING"
  | "GREETING"
  | "LISTENING"
  | "PROCESSING"
  | "SPEAKING"
  | "FINISHED"
  | "ERROR";

type LogEntry = { time: string; message: string };

type GuestTableMapping = {
  fullName: string;
  tableNumber: string;
  context: string;
};

type GuestImportResult = {
  uniqueGuests: number;
  inserted: number;
  updated: number;
  unchanged: number;
};

type RealtimeOutputItem = {
  type?: string;
  name?: string;
  call_id?: string;
  arguments?: string;
  content?: Array<{ transcript?: string; text?: string }>;
};

type RealtimeEvent = {
  type: string;
  response?: {
    status?: string;
    output?: RealtimeOutputItem[];
  };
  transcript?: string;
  error?: { message?: string };
};

const labels: Record<Status, string> = {
  IDLE: "Hazır — Space ile başlat",
  CONNECTING: "OpenAI bağlantısı kuruluyor…",
  GREETING: "Şapka konuşuyor…",
  LISTENING: "Dinliyorum…",
  PROCESSING: "Hmmm… düşünüyorum",
  SPEAKING: "Karar açıklanıyor…",
  FINISHED: "Seçim tamamlandı",
  ERROR: "Bir hata oluştu"
};

export function App() {
  const [status, setStatus] = useState<Status>("IDLE");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [lastTranscript, setLastTranscript] = useState("");
  const [guestTables, setGuestTables] = useState<GuestTableMapping[]>([]);
  const [guestTablesError, setGuestTablesError] = useState(false);
  const [guestTablesLoading, setGuestTablesLoading] = useState(true);
  const [guestImporting, setGuestImporting] = useState(false);
  const [guestImportMessage, setGuestImportMessage] = useState("");
  const [guestImportError, setGuestImportError] = useState("");
  const [guestSearch, setGuestSearch] = useState("");
  const [editingGuestKey, setEditingGuestKey] = useState<string | null>(null);
  const [contextDraft, setContextDraft] = useState("");
  const [savingGuestKey, setSavingGuestKey] = useState<string | null>(null);
  const [contextSaveError, setContextSaveError] = useState("");
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const finishingRef = useRef(false);
  const completionPendingRef = useRef(false);
  const sessionTimeoutRef = useRef<number | null>(null);
  const statusRef = useRef<Status>("IDLE");

  const updateStatus = (next: Status) => {
    statusRef.current = next;
    setStatus(next);
  };

  const log = useCallback((message: string) => {
    setLogs((current) => [
      { time: new Date().toLocaleTimeString("tr-TR"), message },
      ...current
    ].slice(0, 12));
  }, []);

  const loadGuests = useCallback(async (signal?: AbortSignal) => {
    setGuestTablesLoading(true);
    try {
      const response = await fetch("/api/guests", { signal });
      if (!response.ok) throw new Error("Davetli listesi alınamadı.");
      setGuestTables(await response.json() as GuestTableMapping[]);
      setGuestTablesError(false);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setGuestTablesError(true);
    } finally {
      if (!signal?.aborted) setGuestTablesLoading(false);
    }
  }, []);

  const uploadGuestCsv = async (file: File) => {
    setGuestImporting(true);
    setGuestImportMessage("");
    setGuestImportError("");
    try {
      const response = await fetch("/api/guests/import", {
        method: "POST",
        headers: { "Content-Type": "text/csv" },
        body: await file.text()
      });
      const result = await response.json() as GuestImportResult & { error?: string; row?: number };
      if (!response.ok) {
        throw new Error(`${result.error ?? "CSV yüklenemedi."}${result.row ? ` (satır ${result.row})` : ""}`);
      }
      await loadGuests();
      setGuestImportMessage(
        `${result.uniqueGuests} davetli işlendi: ${result.inserted} yeni, ${result.updated} güncellendi, ${result.unchanged} değişmedi.`
      );
      log(`${file.name} içe aktarıldı; ${result.uniqueGuests} davetli işlendi.`);
    } catch (error) {
      setGuestImportError(error instanceof Error ? error.message : "CSV yüklenemedi.");
    } finally {
      setGuestImporting(false);
    }
  };

  const setMicrophoneEnabled = (enabled: boolean) => {
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
  };

  const send = (event: unknown) => {
    const channel = channelRef.current;
    if (channel?.readyState === "open") channel.send(JSON.stringify(event));
  };

  const stopSession = useCallback((finalStatus: Status = "IDLE") => {
    finishingRef.current = true;
    completionPendingRef.current = false;
    if (sessionTimeoutRef.current !== null) {
      window.clearTimeout(sessionTimeoutRef.current);
      sessionTimeoutRef.current = null;
    }
    channelRef.current?.close();
    peerRef.current?.close();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.srcObject = null;
    }
    channelRef.current = null;
    peerRef.current = null;
    streamRef.current = null;
    updateStatus(finalStatus);
    window.setTimeout(() => {
      finishingRef.current = false;
      if (finalStatus === "FINISHED") updateStatus("IDLE");
    }, finalStatus === "FINISHED" ? 2500 : 300);
  }, []);

  const handleToolCall = useCallback(async (item: RealtimeOutputItem) => {
    if (!item.call_id) return;
    let args: Record<string, string> = {};
    try {
      args = JSON.parse(item.arguments ?? "{}") as Record<string, string>;
    } catch {
      log("Tool argümanları çözülemedi.");
    }

    try {
      let result: unknown;
      if (item.name === "find_guest") {
        const spokenName = args.spokenName ?? "";
        setLastTranscript(spokenName);
        log(`Duyulan isim: ${spokenName || "—"}`);
        const response = await fetch("/api/find-guest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ spokenName })
        });
        if (!response.ok) throw new Error("Davetli araması başarısız oldu.");
        result = await response.json();
        const match = result as { best?: { guest?: GuestTableMapping } };
        const best = match.best?.guest;
        log(best ? `En iyi eşleşme: ${best.fullName} — Masa ${best.tableNumber}` : "Eşleşme bulunamadı.");
      } else if (item.name === "get_guest_context") {
        const response = await fetch("/api/guest-context/lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fullName: args.fullName ?? "", tableNumber: args.tableNumber ?? "" })
        });
        if (!response.ok) throw new Error("Davetli bağlamı alınamadı.");
        result = await response.json();
        const lookup = result as { found?: boolean };
        log(lookup.found ? `${args.fullName} için bağlam bulundu.` : `${args.fullName} için kayıtlı bağlam yok.`);
      } else {
        return;
      }

      send({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: item.call_id,
          output: JSON.stringify(result)
        }
      });
      send({ type: "response.create" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tool çağrısı başarısız oldu.";
      log(message);
      send({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: item.call_id, output: JSON.stringify({ error: message }) }
      });
      send({ type: "response.create" });
    }
  }, [log]);

  const guestKey = (guest: GuestTableMapping) => `${guest.fullName}\u0000${guest.tableNumber}`;

  const normalizedGuestSearch = guestSearch.trim().toLocaleLowerCase("tr-TR");
  const visibleGuestTables = normalizedGuestSearch
    ? guestTables.filter((guest) =>
        guest.fullName.toLocaleLowerCase("tr-TR").includes(normalizedGuestSearch) ||
        guest.tableNumber.toLocaleLowerCase("tr-TR").includes(normalizedGuestSearch)
      )
    : guestTables;

  const editGuestContext = (guest: GuestTableMapping) => {
    setEditingGuestKey(guestKey(guest));
    setContextDraft(guest.context);
    setContextSaveError("");
  };

  const saveGuestContext = async (guest: GuestTableMapping) => {
    const key = guestKey(guest);
    setSavingGuestKey(key);
    setContextSaveError("");
    try {
      const response = await fetch("/api/guest-context", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: guest.fullName,
          tableNumber: guest.tableNumber,
          context: contextDraft
        })
      });
      if (!response.ok) {
        const result = await response.json() as { error?: string };
        throw new Error(result.error ?? "Bağlam kaydedilemedi.");
      }
      const context = contextDraft.trim();
      setGuestTables((current) => current.map((item) => (
        guestKey(item) === key ? { ...item, context } : item
      )));
      setEditingGuestKey(null);
      log(`${guest.fullName} için bağlam ${context ? "kaydedildi" : "silindi"}.`);
    } catch (error) {
      setContextSaveError(error instanceof Error ? error.message : "Bağlam kaydedilemedi.");
    } finally {
      setSavingGuestKey(null);
    }
  };

  const handleEvent = useCallback((event: RealtimeEvent) => {
    switch (event.type) {
      case "session.created":
        log("Realtime oturumu açıldı.");
        updateStatus("GREETING");
        send({
          type: "response.create",
          response: {
            instructions: "Seçmen Şapka üslubuyla kişinin adını ve soyadını iste. En fazla 7 kelime kullan; bipten bahsetme."
          }
        });
        break;
      case "input_audio_buffer.speech_started":
        updateStatus("LISTENING");
        log("Konuşma başladı.");
        break;
      case "input_audio_buffer.speech_stopped":
        updateStatus("PROCESSING");
        log("Konuşma bitti, işleniyor.");
        break;
      case "response.created":
        setMicrophoneEnabled(false);
        updateStatus("SPEAKING");
        break;
      case "response.output_audio_transcript.done":
        if (event.transcript) {
          log(`Şapka: ${event.transcript}`);
          if (event.transcript.includes("Seçim tamamlandı")) finishingRef.current = true;
        }
        break;
      case "output_audio_buffer.stopped":
        if (completionPendingRef.current) {
          completionPendingRef.current = false;
          log("Oturum tamamlandı.");
          stopSession("FINISHED");
        }
        break;
      case "response.done": {
        const outputs = event.response?.output ?? [];
        const calls = outputs.filter((item) => item.type === "function_call");
        if (calls.length > 0) {
          updateStatus("PROCESSING");
          void Promise.all(calls.map(handleToolCall));
          return;
        }
        const transcript = outputs
          .flatMap((item) => item.content ?? [])
          .map((content) => content.transcript ?? content.text ?? "")
          .join(" ");
        if (transcript.includes("Seçim tamamlandı") || finishingRef.current) {
          // response.done is emitted when audio generation finishes. The remote
          // audio can still be buffered and playing, so wait for the playback
          // buffer to stop before closing the peer connection.
          completionPendingRef.current = true;
        } else {
          setMicrophoneEnabled(true);
          updateStatus("LISTENING");
        }
        break;
      }
      case "error":
        log(event.error?.message ?? "Realtime hatası");
        stopSession("ERROR");
        break;
    }
  }, [handleToolCall, log, stopSession]);

  const startSession = useCallback(async () => {
    if (statusRef.current !== "IDLE") return;
    if (sessionTimeoutRef.current !== null) {
      window.clearTimeout(sessionTimeoutRef.current);
      sessionTimeoutRef.current = null;
    }
    updateStatus("CONNECTING");
    setLastTranscript("");
    log("Yeni seçim oturumu başlatılıyor.");

    try {
      const peer = new RTCPeerConnection();
      peerRef.current = peer;
      const audio = document.createElement("audio");
      audio.autoplay = true;
      audioRef.current = audio;
      peer.ontrack = (event) => {
        audio.srcObject = event.streams[0];
      };

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      streamRef.current = stream;
      stream.getAudioTracks()[0].enabled = false;
      peer.addTrack(stream.getAudioTracks()[0], stream);

      const channel = peer.createDataChannel("oai-events");
      channelRef.current = channel;
      channel.addEventListener("message", (message) => {
        handleEvent(JSON.parse(message.data) as RealtimeEvent);
      });
      channel.addEventListener("close", () => log("Realtime veri kanalı kapandı."));

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const response = await fetch("/api/realtime/session", {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: offer.sdp
      });
      if (!response.ok) throw new Error(await response.text());
      await peer.setRemoteDescription({ type: "answer", sdp: await response.text() });

      sessionTimeoutRef.current = window.setTimeout(() => {
        sessionTimeoutRef.current = null;
        if (
          !completionPendingRef.current &&
          !["IDLE", "FINISHED", "ERROR"].includes(statusRef.current)
        ) {
          log("45 saniyelik oturum süresi doldu.");
          stopSession("ERROR");
        }
      }, 45_000);
    } catch (error) {
      console.error(error);
      log(error instanceof Error ? error.message : "Bağlantı kurulamadı.");
      stopSession("ERROR");
    }
  }, [handleEvent, log, stopSession]);

  useEffect(() => {
    const controller = new AbortController();
    void loadGuests(controller.signal);
    return () => controller.abort();
  }, [loadGuests]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, button")) return;
      event.preventDefault();
      if (statusRef.current === "IDLE") void startSession();
      else if (statusRef.current === "ERROR") stopSession("IDLE");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [startSession, stopSession]);

  useEffect(() => () => stopSession("IDLE"), [stopSession]);

  return (
    <main className="shell">
      <aside className="panel guest-panel">
        <h2>Davetli listesi</h2>
        <div className="guest-import">
          <label className={`guest-import-button${guestImporting ? " disabled" : ""}`}>
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={guestImporting}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadGuestCsv(file);
                event.target.value = "";
              }}
            />
            {guestImporting ? "CSV yükleniyor…" : "CSV yükle"}
          </label>
          <small>Mevcut davetliler güncellenir; listede olmayanlar silinmez.</small>
          {guestImportMessage && <p className="import-message">{guestImportMessage}</p>}
          {guestImportError && <p className="context-error">{guestImportError}</p>}
        </div>
        <label className="guest-search">
          <span className="sr-only">Davetli veya masa ara</span>
          <input
            type="search"
            value={guestSearch}
            onChange={(event) => setGuestSearch(event.target.value)}
            placeholder="Davetli veya masa ara…"
          />
        </label>
        <h3>Davetli — Masa</h3>
        <div className="guest-tables">
          {guestTablesLoading ? (
            <p className="muted">Davetli listesi yükleniyor…</p>
          ) : guestTablesError ? (
            <p className="muted">Davetli listesi alınamadı.</p>
          ) : guestTables.length === 0 ? (
            <p className="muted">Henüz davetli yok. Bir CSV yükleyin.</p>
          ) : visibleGuestTables.length === 0 ? (
            <p className="muted">Eşleşen davetli bulunamadı.</p>
          ) : visibleGuestTables.map((guest, index) => (
            <div className="guest-table" key={`${guest.fullName}-${guest.tableNumber}-${index}`}>
              <div className="guest-summary">
                <div className="guest-name">
                  <span>{guest.fullName}</span>
                  <button
                    className={`context-toggle${guest.context ? " has-context" : ""}`}
                    onClick={() => editGuestContext(guest)}
                    title={guest.context || "Bağlam ekle"}
                  >
                    {guest.context ? "Notu düzenle" : "+ Not"}
                  </button>
                </div>
                <strong>Masa {guest.tableNumber}</strong>
              </div>
              {editingGuestKey === guestKey(guest) && (
                <div className="context-editor">
                  <textarea
                    value={contextDraft}
                    onChange={(event) => setContextDraft(event.target.value)}
                    maxLength={500}
                    rows={4}
                    placeholder="Örn. Gelinin üniversiteden arkadaşı; dans etmeyi çok sever."
                    autoFocus
                  />
                  <div className="context-editor-footer">
                    <small>{contextDraft.length}/500</small>
                    <button className="secondary compact" onClick={() => setEditingGuestKey(null)}>Vazgeç</button>
                    <button className="compact" onClick={() => void saveGuestContext(guest)} disabled={savingGuestKey === guestKey(guest)}>
                      {savingGuestKey === guestKey(guest) ? "Kaydediliyor…" : "Kaydet"}
                    </button>
                  </div>
                  {contextSaveError && <p className="context-error">{contextSaveError}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      </aside>

      <section className="hero">
        <div className="eyebrow">DÜĞÜN MASA REHBERİ</div>
        <h1>Büyülü Masa Şapkası</h1>
        <p className="subtitle">Şapkayı takın, görevli Space tuşuna bassın ve adınızı soyadınızı söyleyin.</p>
        <div className={`orb status-${status.toLowerCase()}`} aria-live="polite">
          <span>{labels[status]}</span>
        </div>
        <div className="actions">
          <button onClick={() => void startSession()} disabled={status !== "IDLE"}>Space / Başlat</button>
          <button className="secondary" onClick={() => stopSession("IDLE")} disabled={status === "IDLE"}>Oturumu kapat</button>
        </div>
        <div className="keyhint"><kbd>SPACE</kbd> yeni misafir</div>
      </section>

      <aside className="panel">
        <h2>Görevli paneli</h2>
        <div className="field">
          <span>Duyulan isim</span>
          <strong>{lastTranscript || "Henüz yok"}</strong>
        </div>
        <h3>Olaylar</h3>
        <div className="logs">
          {logs.length === 0 ? <p className="muted">Sistem hazır.</p> : logs.map((entry, index) => (
            <div className="log" key={`${entry.time}-${index}`}>
              <time>{entry.time}</time><span>{entry.message}</span>
            </div>
          ))}
        </div>
      </aside>
    </main>
  );
}
