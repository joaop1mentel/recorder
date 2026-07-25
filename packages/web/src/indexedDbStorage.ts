import {
  resumo,
  type DepositoFalas,
  type FalaGravada,
  type Session,
  type SessionMeta,
  type Storage,
} from "@rt/core";

const DB = "recorder-translator";
const STORE = "sessions";
/** Falas cruas do modo "transcrever depois", apagadas assim que transcritas. */
const STORE_FALAS = "falas";
const VERSAO = 2;

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSAO);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_FALAS)) {
        const loja = db.createObjectStore(STORE_FALAS, { keyPath: "id" });
        // busca por sessão: é sempre assim que as falas são lidas e apagadas
        loja.createIndex("sessionId", "sessionId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function comLoja<T>(
  store: string,
  modo: IDBTransactionMode,
  fn: (loja: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return abrir().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, modo);
        const req = fn(tx.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
      }),
  );
}

/** Persistência local das sessões via IndexedDB (sem dependência externa). */
export class IndexedDbStorage implements Storage {
  async saveSession(s: Session): Promise<void> {
    await comLoja(STORE, "readwrite", (loja) => loja.put(s));
  }
  async getSession(id: string): Promise<Session | undefined> {
    const s = await comLoja<Session | undefined>(STORE, "readonly", (loja) =>
      loja.get(id),
    );
    return s ?? undefined;
  }
  async list(): Promise<SessionMeta[]> {
    const todas = await comLoja<Session[]>(STORE, "readonly", (loja) =>
      loja.getAll(),
    );
    return todas.map(resumo).sort((a, b) => b.criadoEm - a.criadoEm);
  }
  async deleteSession(id: string): Promise<void> {
    await comLoja(STORE, "readwrite", (loja) => loja.delete(id));
  }
}

/** Linha do store de falas: a fala mais a sessão a que pertence. */
type LinhaFala = FalaGravada & { sessionId: string };

/**
 * Depósito das falas cruas no modo "transcrever depois".
 *
 * Fica no IndexedDB, e não em memória, porque no celular a transcrição é mais
 * lenta que a fala: uma gravação de uma hora acumularia centenas de MB de PCM
 * antes de qualquer texto sair.
 */
export class IndexedDbDeposito implements DepositoFalas {
  async guardar(sessionId: string, fala: FalaGravada): Promise<void> {
    const linha: LinhaFala = { ...fala, sessionId };
    await comLoja(STORE_FALAS, "readwrite", (loja) => loja.put(linha));
  }

  async listar(sessionId: string): Promise<FalaGravada[]> {
    const linhas = await comLoja<LinhaFala[]>(STORE_FALAS, "readonly", (loja) =>
      loja.index("sessionId").getAll(sessionId),
    );
    return linhas.sort((a, b) => a.t0 - b.t0);
  }

  async limpar(sessionId: string): Promise<void> {
    const linhas = await comLoja<LinhaFala[]>(STORE_FALAS, "readonly", (loja) =>
      loja.index("sessionId").getAll(sessionId),
    );
    for (const l of linhas) {
      await comLoja(STORE_FALAS, "readwrite", (loja) => loja.delete(l.id));
    }
  }
}
