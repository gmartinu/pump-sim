// The UI talks to the simulator only through the control API: commands over the WebSocket
// (`{id, comando, args, origem: 'ui'}`), live events pushed on the same socket, a few GET routes and
// the `/api/mcp` switch (POST).

export class Api {
  constructor() {
    this.ws = null;
    this.estado = 'conectando'; // conectando | ok | off
    this.pend = new Map();
    this.seq = 1;
    this.ouvintes = new Set();
    this.aoMudar = () => {};
    this.parado = false;
  }

  /** Stops reconnecting (the process was ended from the UI: there is nothing to reconnect to). */
  parar() {
    this.parado = true;
    this.ws?.close();
  }

  conectar() {
    if (this.parado) return;
    const ws = new WebSocket(`ws://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => this.mudar('ok');
    ws.onmessage = (m) => {
      let msg;
      try {
        msg = JSON.parse(m.data);
      } catch {
        return;
      }
      if (msg.id !== undefined && this.pend.has(msg.id)) {
        const p = this.pend.get(msg.id);
        this.pend.delete(msg.id);
        if (msg.ok) p.ok(msg.resultado);
        else p.erro(new Error(msg.erro ?? 'erro'));
        return;
      }
      if (msg.tipo) for (const f of this.ouvintes) f(msg);
    };
    ws.onclose = () => {
      for (const p of this.pend.values()) p.erro(new Error('conexão com a API caiu'));
      this.pend.clear();
      this.mudar('off');
      if (!this.parado) setTimeout(() => this.conectar(), 1500);
    };
  }

  mudar(e) {
    if (this.estado === e) return;
    this.estado = e;
    this.aoMudar(e);
  }

  /** Runs a catalog command. Rejects with the API's error text. */
  chamar(comando, args = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('API de controle desconectada'));
    const id = this.seq++;
    return new Promise((ok, erro) => {
      this.pend.set(id, { ok, erro });
      this.ws.send(JSON.stringify({ id, comando, args, origem: 'ui' }));
    });
  }

  async get(caminho) {
    const r = await fetch(caminho);
    const j = await r.json();
    if (!j.ok) throw new Error(j.erro ?? `HTTP ${r.status}`);
    return j.resultado;
  }

  /** JSON POST to a control route (e.g. `/api/mcp`). Rejects with the API's error text. */
  async post(caminho, corpo) {
    const r = await fetch(caminho, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.erro ?? `HTTP ${r.status}`);
    return j.resultado;
  }

  ouvir(f) {
    this.ouvintes.add(f);
  }
}
