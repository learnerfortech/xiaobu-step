/* 小步 · mock 传输层 —— 逐行移植自交接包 source/outer.js 的 newState() / list() / getPack() / demoTransport()
   合同（路径、请求体、返回体、错误码、版本与 operation_id 语义）保持原样，只做了这些改动：
   1) 不再依赖外层 iframe：demo:* 媒体映射到 assets/ 下的本地文件；
   2) 场景/故障注入改由 window.MockControl 控制（测试与 ?scenario= 参数用），原 demo 是外壳上的下拉框；
   3) 每次调用加 0~MOCK_LATENCY 毫秒延迟，用来让“保存中”状态可见（可设为 0）；
   4) 状态存在本机浏览器 localStorage（键 xb.mock.state.v4）+ 照片二进制在 IndexedDB：
      同机刷新不丢；多标签用 rev/合并/storage 事件避免后写无脑盖前写；换设备不同步；不联网。
      persist() 失败返回 false，调用方必须当失败（不得报成功）。 */
(() => {
  if (window.APP_CONFIG.TRANSPORT !== 'mock') return; // 共享模式不初始化或修改本机存档。
  var LIMITS = {
    image: 8 * 1024 * 1024,
    total: 32 * 1024 * 1024,
    count: 12,
    pixels: 24e6,
  };
  var cat = (parts) => {
    const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
    let i = 0;
    for (const p of parts) {
      out.set(p, i);
      i += p.length;
    }
    return out;
  };
  var crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 3988292384 : 0);
    return c >>> 0;
  });
  function crc32(bytes) {
    let c = 4294967295;
    for (const x of bytes) c = (c >>> 8) ^ crcTable[(c ^ x) & 255];
    return (c ^ 4294967295) >>> 0;
  }
  function zipStored(files) {
    const records = [],
      central = [];
    let offset = 0;
    const enc = new TextEncoder();
    for (const f of files) {
      if (!/^[a-zA-Z0-9._-]+$/.test(f.name))
        throw Error("ZIP\u6587\u4EF6\u540D\u65E0\u6548");
      const name = enc.encode(f.name),
        data = new Uint8Array(f.bytes),
        crc = crc32(data),
        head = new Uint8Array(30 + name.length),
        v2 = new DataView(head.buffer);
      v2.setUint32(0, 67324752, true);
      v2.setUint16(4, 20, true);
      v2.setUint16(6, 2048, true);
      v2.setUint16(12, 33, true);
      v2.setUint32(14, crc, true);
      v2.setUint32(18, data.length, true);
      v2.setUint32(22, data.length, true);
      v2.setUint16(26, name.length, true);
      head.set(name, 30);
      records.push(head, data);
      const ch = new Uint8Array(46 + name.length),
        cv = new DataView(ch.buffer);
      cv.setUint32(0, 33639248, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 2048, true);
      cv.setUint16(14, 33, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      ch.set(name, 46);
      central.push(ch);
      offset += head.length + data.length;
    }
    const body = cat(central),
      end = new Uint8Array(22),
      v = new DataView(end.buffer);
    v.setUint32(0, 101010256, true);
    v.setUint16(8, files.length, true);
    v.setUint16(10, files.length, true);
    v.setUint32(12, body.length, true);
    v.setUint32(16, offset, true);
    return cat([...records, body, end]);
  }


  var ASSETS = {
    audio: "assets/audio-0.wav",
    sheet: "assets/sheet-0.png",
    reading: "assets/reading-0.html",
    photos: ["assets/photos-0.jpg", "assets/photos-1.jpg"],
  };
  var payload = { day: (window.APP_CONFIG && window.APP_CONFIG.DEMO_DAY) || "2026-01-14" };
  var id = (n) => "10000000-0000-4000-8000-" + String(n).padStart(12, "0");
  var scenario = "normal";
  function newState() {
    /* 新鲜种子跟本机「今天」；已迁移存档保留各自 day */
    const day =
      window.APP_CONFIG && typeof window.APP_CONFIG.today === "function"
        ? window.APP_CONFIG.today()
        : payload.day;
    const mk = (n, child, kind, title, first_step, parent_note, extra = {}) => ({
      id: id(n),
      day,
      child_id: child,
      task_kind: kind,
      assignment_state: extra.assignment_state || (kind === "legacy" ? "legacy_assigned" : "verified"),
      title,
      first_step,
      parent_note,
      material_url: extra.material_url || "",
      audio_url: extra.audio_url || "",
      status: extra.status || "todo",
      version: 0,
    });
    /* PU4 + 10.22：哥哥 child_a；弟弟 child_b 挂节目提醒 */
    const tasks = [
      mk(
        1,
        "child_a",
        "paper",
        "KET青少版真题1：听力第3部分（P22 P37 P53 P69）",
        "打开纸质真题书，完成听力第3部分：第22、37、53、69页。做完后拍照或扫描交给家长。",
        "纸质真题完成；孩子提交后请核对拍照/扫描是否清晰完整。",
      ),
      mk(
        2,
        "child_a",
        "reading",
        "KET听力精听 Part3（乐翼英语）",
        "打开乐翼英语网站完成听力 Part3。必做：Test1、Test2；选做：Test3、Test4。网站做完可直接提交。网址：https://www.joywingenglish.cn/index.html",
        "网站任务；必做 Test1/Test2 Part3，选做 Test3/Test4 Part3。",
        { material_url: "https://www.joywingenglish.cn/index.html" },
      ),
      mk(
        3,
        "child_a",
        "paper",
        "看图写作练习",
        "按三格图在英语纸上完成看图写作。写完后拍照或扫描交给家长。",
        "按三格图在英语纸上写；完成后核对照片/扫描是否清晰完整。",
        { material_url: "assets/homework/看图写作-三格.png" },
      ),
      mk(
        4,
        "child_a",
        "audio",
        "App 朗读录音",
        "打开英语朗读 App，按要求朗读并录音提交。",
        "核对 App 里是否已提交朗读录音。",
      ),
      mk(
        5,
        "child_a",
        "paper",
        "10.22 学校作业",
        "英语：听读 P40~41；语文：预习第11课；数学：卷子第18~26题（第26题有能力就写）。对照手写作业条完成，做完拍照交给家长。",
        "对照手写条核对三项：英听读 P40~41、语预11课、数卷子18~26题（26题量力而行）。",
        { material_url: "assets/homework/10.22-手写作业.png" },
      ),
      mk(
        6,
        "child_b",
        "paper",
        "班级节目：两首歌《巡光》《气势如虹》",
        "家长群说月底（约10月底）有演出，具体日期未定。两首歌：《巡光》《气势如虹》。可先跟家长一起练。",
        "一年级班级节目提醒；群聊截图见附图。具体日期待定。",
        { material_url: "assets/homework/一年级-节目群聊.png" },
      ),
    ];
    return {
      rev: 0,
      _baseRev: 0,
      tasks: scenario === "normal" ? [] : tasks,
      records: [],
      drafts: /* @__PURE__ */ new Map(),
      photos: /* @__PURE__ */ new Map(),
      packs: /* @__PURE__ */ new Map(),
      ops: /* @__PURE__ */ new Map(),
      history: [],
      tombstones: {},
      failRead: 0,
      failWrite: 0,
      calls: [],
    };
  }
  var STORAGE_KEY = "xb.mock.state.v4";
  var LEGACY_KEYS = ["xb.mock.state.v1", "xb.mock.state.v2", "xb.mock.state.v3"];
  var IDB_NAME = "xb.mock.photos.v1";
  var IDB_STORE = "blobs";
  var failPersistLeft = 0;
  var persistListeners = new Set();
  var applyingRemote = false;

  function mapToJson(m, photoMetaOnly) {
    const out = [];
    for (const [k, v] of m.entries()) {
      if (photoMetaOnly && Array.isArray(v)) {
        out.push([
          k,
          v.map((im) => ({
            id: im.id,
            sha256: im.sha256,
            size: im.size,
            width: im.width,
            height: im.height,
            created_at: im.created_at,
          })),
        ]);
      } else {
        out.push([k, v]);
      }
    }
    return out;
  }
  function jsonToMap(entries) {
    return new Map(entries || []);
  }
  function serializeState(state) {
    return {
      rev: state.rev || 0,
      tasks: state.tasks,
      records: state.records,
      drafts: mapToJson(state.drafts || new Map(), false),
      photos: mapToJson(state.photos || new Map(), true),
      packs: mapToJson(state.packs || new Map(), false),
      ops: mapToJson(state.ops || new Map(), false),
      history: state.history || [],
      tombstones: state.tombstones || {},
      failRead: state.failRead || 0,
      failWrite: state.failWrite || 0,
    };
  }
  function deserializeState(raw) {
    if (!raw || !Array.isArray(raw.tasks)) return null;
    return {
      rev: raw.rev || 0,
      _baseRev: raw.rev || 0,
      tasks: raw.tasks,
      records: Array.isArray(raw.records) ? raw.records : [],
      drafts: jsonToMap(raw.drafts),
      photos: jsonToMap(raw.photos),
      packs: jsonToMap(raw.packs),
      ops: jsonToMap(raw.ops),
      history: Array.isArray(raw.history) ? raw.history : [],
      tombstones: raw.tombstones && typeof raw.tombstones === "object" ? raw.tombstones : {},
      failRead: raw.failRead || 0,
      failWrite: raw.failWrite || 0,
      calls: [],
    };
  }

  function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("idb_open_failed"));
    });
  }
  function idbReq(fn) {
    return idbOpen().then(
      (db) =>
        new Promise((resolve, reject) => {
          let finished = false;
          const done = (err, val) => {
            if (finished) return;
            finished = true;
            try {
              db.close();
            } catch (e) {}
            if (err) reject(err);
            else resolve(val);
          };
          try {
            fn(db, done);
          } catch (e) {
            done(e);
          }
        }),
    );
  }
  function photoIdbKey(taskId, photoId) {
    return String(taskId) + "::" + String(photoId);
  }
  function idbPutBytes(taskId, photoId, bytes) {
    const key = photoIdbKey(taskId, photoId);
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return idbReq((db, done) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.oncomplete = () => done(null, true);
      tx.onerror = () => done(tx.error || new Error("idb_put_failed"));
      tx.objectStore(IDB_STORE).put(buf, key);
    });
  }
  function idbGetBytes(taskId, photoId) {
    const key = photoIdbKey(taskId, photoId);
    return idbReq((db, done) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => {
        const v = req.result;
        if (!v) return done(null, null);
        done(null, v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(v));
      };
      req.onerror = () => done(req.error || new Error("idb_get_failed"));
    });
  }
  function idbDeleteBytes(taskId, photoId) {
    const key = photoIdbKey(taskId, photoId);
    return idbReq((db, done) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.oncomplete = () => done(null, true);
      tx.onerror = () => done(tx.error || new Error("idb_del_failed"));
      tx.objectStore(IDB_STORE).delete(key);
    });
  }
  async function idbClearAll() {
    return idbReq((db, done) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.oncomplete = () => done(null, true);
      tx.onerror = () => done(tx.error || new Error("idb_clear_failed"));
      tx.objectStore(IDB_STORE).clear();
    });
  }

  function mergeMapsByVersion(a, b, versionOf) {
    const out = new Map(a || []);
    for (const [k, v] of b || []) {
      if (!out.has(k)) out.set(k, v);
      else {
        const cur = out.get(k);
        if (versionOf(v) >= versionOf(cur)) out.set(k, v);
      }
    }
    return out;
  }
  function mergePhotoLists(a, b) {
    const m = new Map();
    for (const im of a || []) m.set(im.id, im);
    for (const im of b || []) {
      const cur = m.get(im.id);
      if (!cur) m.set(im.id, im);
      else if (im.bytes && !cur.bytes) m.set(im.id, { ...cur, ...im, bytes: im.bytes, url: im.url || cur.url });
      else if (cur.bytes && !im.bytes) m.set(im.id, cur);
      else m.set(im.id, im);
    }
    return [...m.values()];
  }
  /** 把 other（通常来自 localStorage）合并进当前内存，避免多标签后写盖前写丢数据 */
  function mergeStateFrom(other) {
    if (!other) return;
    const state = window.demoState;
    const tombs = { ...(other.tombstones || {}), ...(state.tombstones || {}) };
    const byId = new Map();
    for (const t of other.tasks || []) byId.set(t.id, t);
    for (const t of state.tasks || []) {
      const cur = byId.get(t.id);
      if (!cur || (t.version || 0) >= (cur.version || 0)) byId.set(t.id, t);
    }
    state.tasks = [...byId.values()].filter((t) => {
      const tomb = tombs[t.id];
      return !tomb || (t.version || 0) > (tomb.version || 0);
    });
    state.tombstones = tombs;
    const recById = new Map();
    for (const r of other.records || []) recById.set(r.id, r);
    for (const r of state.records || []) {
      const cur = recById.get(r.id);
      if (!cur || (r.version || 0) >= (cur.version || 0)) recById.set(r.id, r);
    }
    state.records = [...recById.values()];
    state.ops = new Map([...(other.ops || new Map()), ...(state.ops || new Map())]);
    const packs = new Map(other.packs || []);
    for (const [k, v] of state.packs || []) {
      const cur = packs.get(k);
      if (!cur || (v.revision || 0) >= (cur.revision || 0)) packs.set(k, v);
    }
    state.packs = packs;
    const photos = new Map();
    const keys = new Set([...(other.photos || new Map()).keys(), ...(state.photos || new Map()).keys()]);
    for (const k of keys) {
      photos.set(k, mergePhotoLists((other.photos || new Map()).get(k), (state.photos || new Map()).get(k)));
    }
    state.photos = photos;
    const hist = [...(other.history || []), ...(state.history || [])];
    const seen = new Set();
    state.history = hist.filter((h) => {
      const key = JSON.stringify(h);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(-200);
    state.rev = Math.max(state.rev || 0, other.rev || 0);
  }

  function adoptState(loaded) {
    window.demoState = loaded;
    loaded._baseRev = loaded.rev || 0;
  }

  function notifySync(reason) {
    try {
      window.dispatchEvent(new CustomEvent("xb-mock-sync", { detail: { reason } }));
    } catch (e) {}
    persistListeners.forEach((f) => {
      try {
        f(reason);
      } catch (e) {}
    });
  }

  /** @returns {boolean} true=写入成功；false=失败（调用方不得当成功） */
  function persist() {
    if (applyingRemote) return true;
    try {
      if (!window.demoState) return false;
      if (failPersistLeft > 0) {
        failPersistLeft--;
        console.warn("[mock] 注入本机存档失败");
        return false;
      }
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        let parsed = null;
        try {
          parsed = JSON.parse(raw);
        } catch (e) {
          parsed = null;
        }
        if (parsed && Array.isArray(parsed.tasks)) {
          const otherRev = parsed.rev || 0;
          const base = window.demoState._baseRev || 0;
          if (otherRev > base) {
            const other = deserializeState(parsed);
            mergeStateFrom(other);
          }
        }
      }
      window.demoState.rev = Math.max(window.demoState.rev || 0, window.demoState._baseRev || 0) + 1;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeState(window.demoState)));
      window.demoState._baseRev = window.demoState.rev;
      return true;
    } catch (e) {
      console.warn("[mock] 本机存档失败", e);
      return false;
    }
  }

  /** persist 失败时尽量从 LS 回滚内存，避免“内存已改、盘上没有”却仍像成功 */
  function rollbackFromDisk() {
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      if (!s) return;
      const loaded = deserializeState(JSON.parse(s));
      if (loaded) {
        adoptState(loaded);
        restorePhotoBytesFromIdb();
      }
    } catch (e) {
      console.warn("[mock] 回滚失败", e);
    }
  }

  function persistOrRollback() {
    if (persist()) return true;
    rollbackFromDisk();
    return false;
  }

  function loadPersisted() {
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      if (!s) return null;
      return deserializeState(JSON.parse(s));
    } catch (e) {
      console.warn("[mock] 本机存档读取失败", e);
      return null;
    }
  }

  function migrateLegacy() {
    let combined = null;
    const tasks = new Map();
    for (const key of LEGACY_KEYS) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const loaded = deserializeState(JSON.parse(raw));
        if (!loaded) continue;
        for (const t of loaded.tasks) {
          const scope = JSON.stringify([t.day, t.child_id, t.id]);
          const prior = tasks.get(scope);
          if (!prior || (t.version || 0) >= (prior.version || 0)) tasks.set(scope, t);
        }
        if (combined) {
          window.demoState = loaded;
          mergeStateFrom(combined);
        }
        combined = window.demoState = loaded;
      } catch (e) {
        console.warn("[mock] 旧存档读取失败，原件保留", key, e);
      }
    }
    if (!combined) return null;
    combined.tasks = [...tasks.values()];
    combined._baseRev = 0;
    // 只写新键；所有旧键原件保留，便于回退及核对不同版本的记录。
    if (!persist()) return "migrate_failed";
    return "migrated";
  }

  async function restorePhotoBytesFromIdb(notify = true) {
    const state = window.demoState;
    if (!state || !state.photos) return;
    for (const [taskId, list] of state.photos.entries()) {
      const next = [];
      for (const im of list || []) {
        if (im.bytes && im.url) { next.push(im); continue; }
        let bytes = im.bytes;
        if (!bytes) {
          try {
            bytes = await idbGetBytes(taskId, im.id);
          } catch (e) {
            bytes = null;
          }
        }
        if (bytes) {
          if (im.url && String(im.url).startsWith("blob:")) {
            try {
              URL.revokeObjectURL(im.url);
            } catch (e) {}
          }
          next.push({
            ...im,
            bytes,
            url: URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" })),
          });
        } else {
          next.push({ ...im, bytes: undefined, url: im.url && !String(im.url).startsWith("blob:") ? im.url : "" });
        }
      }
      state.photos.set(taskId, next);
    }
    if (notify) notifySync("photos-restored");
  }

  function hydrateOrInit() {
    const loaded = loadPersisted();
    if (loaded) {
      adoptState(loaded);
      restorePhotoBytesFromIdb();
      return "hydrated";
    }
    const mig = migrateLegacy();
    if (mig === "migrated" || mig === "migrate_failed") {
      restorePhotoBytesFromIdb();
      return mig;
    }
    window.demoState = newState();
    window.demoState.rev = 0;
    window.demoState._baseRev = 0;
    window.demoState.tombstones = {};
    persist();
    return "fresh";
  }

  let transportActive = false;
  window.addEventListener("storage", (e) => {
    if (transportActive) return;
    if (e.key !== STORAGE_KEY || e.newValue == null) return;
    try {
      const parsed = JSON.parse(e.newValue);
      const other = deserializeState(parsed);
      if (!other) return;
      applyingRemote = true;
      if (!window.demoState) adoptState(other);
      else {
        const base = window.demoState._baseRev || 0;
        if ((other.rev || 0) > base) adoptState(other);
      }
      applyingRemote = false;
      restorePhotoBytesFromIdb();
      notifySync("storage");
    } catch (err) {
      applyingRemote = false;
      console.warn("[mock] storage 同步失败", err);
    }
  });

    var clone = (x) => structuredClone(x);
  var response = (x, status = 200) =>
    new Response(JSON.stringify(x), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  // 与原 demo 相同：存储里是 demo:*，读出时换成可用地址（原 demo 为 blob:，这里为本地静态资源，file:// 可用）
  var material = (s, frame2) =>
    s === "demo:audio"
      ? ASSETS.audio
      : s === "demo:sheet"
        ? ASSETS.sheet
        : s === "demo:reading"
          ? ASSETS.reading
          : s;
  function list(c, child, frame2) {
    const state = window.demoState;
    let tasks = state.tasks.filter(
      (t) => t.day === c.day && t.child_id === c.child_id,
    );
    if (scenario === "empty") tasks = [];
    if (child)
      tasks = tasks.filter(
        (t) =>
          t.status !== "archived" &&
          t.assignment_state !== "pending" &&
          !state.records.some(
            (r) =>
              r.kind === "content" &&
              r.payload.task_id === t.id &&
              r.payload.review === "pending",
          ),
      );
    return {
      day: c.day,
      child_id: c.child_id,
      demo: true,
      tasks: tasks.map((t) => {
        const linked = state.records.find(
          (r) =>
            r.kind === "content" &&
            r.payload.task_id === t.id &&
            r.payload.review === "verified",
        );
        const v = {
          ...clone(t),
          material_url: material(t.material_url, frame2),
          audio_url: material(t.audio_url, frame2),
          adult_required: !!linked && t.child_id === "child_b",
        };
        if (linked)
          Object.assign(v, {
            content_kind: linked.payload.content_kind,
            original_requirement: linked.payload.source_text,
            child_demo: linked.payload.child_demo,
            ...(child ? {} : { support: clone(linked.payload) }),
          });
        if (child) delete v.parent_note;
        return v;
      }),
    };
  }
  function getPack(t, frame2) {
    const p = window.demoState.packs.get(t.id) || {
      revision: 0,
      teacher_sent: false,
      sent_at: null,
    };
    return {
      task_id: t.id,
      day: t.day,
      child_id: t.child_id,
      ...p,
      photos: [...(window.demoState.photos.get(t.id) || [])].map((im) => ({
        id: im.id,
        sha256: im.sha256,
        size: im.size,
        width: im.width,
        height: im.height,
        url: im.url,
        created_at: im.created_at,
      })),
    };
  }
  window.demoTransport = async (url, options = {}, frame2 = window) => {
    const state = window.demoState,
      [path, search = ""] = String(url).split("?"),
      q = new URLSearchParams(search),
      method = options.method || "GET",
      child = path.includes("/child/"),
      c = { day: q.get("day"), child_id: q.get("child") };
    state.calls.push({ path, method });
    if (method === "GET" && path.endsWith("/tasks") && state.failRead) {
      state.failRead--;
      return response({ error: "simulated_read_failure" }, 503);
    }
    if (method === "POST" && state.failWrite) {
      state.failWrite--;
      return response({ error: "simulated_save_failure" }, 503);
    }
    let b =
      method === "POST" && typeof options.body === "string"
        ? JSON.parse(options.body)
        : null;
    if (b) ((c.day = b.day), (c.child_id = b.child_id));
    if (path.endsWith("/tasks")) return response(list(c, child, frame2));
    if (path.endsWith("/create")) {
      if (
        !b?.title?.trim() ||
        b.title.length > 100 ||
        (b.first_step != null && typeof b.first_step !== 'string') ||
        [b.material_url, b.audio_url].some(
          (u) => u && !/^(blob:|data:|demo:|https?:|assets\/)/.test(u),
        )
      )
        return response({ error: "invalid_demo_input" }, 400);
      const prior = state.tasks.find((t) => t.id === b.id);
      if (prior) return response(list(c, false, frame2));
      state.tasks.push({
        ...b,
        status: "todo",
        version: 0,
        task_kind: b.task_kind || "legacy",
        assignment_state: b.assignment_state || "pending",
      });
      if (!persistOrRollback()) return response({ error: "persist_failed" }, 503);
      return response({ ...list(c, false, frame2), created_id: b.id });
    }
    if (path.endsWith("/update")) {
      const t = state.tasks.find(
        (t2) =>
          t2.id === b.task_id && t2.day === b.day && t2.child_id === b.child_id,
      );
      if (!t) return response({ error: "not_found" }, 404);
      const canonical = JSON.stringify(b),
        prior = state.ops.get(b.operation_id);
      if (prior)
        return prior.request === canonical
          ? response(list(c, false, frame2))
          : response({ error: "conflict" }, 409);
      if (t.version !== b.expected_version)
        return response({ error: "conflict" }, 409);
      if (
        !b?.title?.trim() ||
        b.title.length > 100 ||
        (b.first_step != null && typeof b.first_step !== 'string') ||
        [b.material_url, b.audio_url].some(
          (u) => u && !/^(blob:|data:|demo:|https?:|assets\/)/.test(u),
        )
      )
        return response({ error: "invalid_demo_input" }, 400);
      state.ops.set(b.operation_id, { request: canonical });
      t.title = b.title.trim();
      t.first_step = (b.first_step || '').trim();
      if (b.parent_note != null) t.parent_note = b.parent_note;
      if (b.material_url != null) t.material_url = b.material_url;
      if (b.audio_url != null) t.audio_url = b.audio_url;
      if (b.task_kind) t.task_kind = b.task_kind;
      if (b.assignment_state) t.assignment_state = b.assignment_state;
      t.version++;
      if (!persistOrRollback()) return response({ error: "persist_failed" }, 503);
      return response(list(c, false, frame2));
    }
    if (path.endsWith("/delete")) {
      const t = state.tasks.find(
        (t2) =>
          t2.id === b.task_id && t2.day === b.day && t2.child_id === b.child_id,
      );
      if (!t) return response({ error: "not_found" }, 404);
      const canonical = JSON.stringify(b),
        prior = state.ops.get(b.operation_id);
      if (prior)
        return prior.request === canonical
          ? response(list(c, false, frame2))
          : response({ error: "conflict" }, 409);
      if (t.version !== b.expected_version)
        return response({ error: "conflict" }, 409);
      state.ops.set(b.operation_id, { request: canonical });
      if (!state.tombstones) state.tombstones = {};
      state.tombstones[t.id] = { version: (t.version || 0) + 1, at: Date.now() };
      const gonePhotos = state.photos.get(t.id) || [];
      state.tasks = state.tasks.filter((t2) => t2.id !== t.id);
      state.photos.delete(t.id);
      state.packs.delete(t.id);
      if (!persistOrRollback()) return response({ error: "persist_failed" }, 503);
      for (const im of gonePhotos) {
        idbDeleteBytes(t.id, im.id).catch(() => {});
      }
      return response(list(c, false, frame2));
    }
    if (path.endsWith("/feedback") || path.endsWith("/assign")) {
      const t = state.tasks.find(
        (t2) =>
          t2.id === b.task_id && t2.day === b.day && t2.child_id === b.child_id,
      );
      if (!t) return response({ error: "not_found" }, 404);
      const canonical = JSON.stringify(b),
        prior = state.ops.get(b.operation_id);
      if (prior)
        return prior.request === canonical
          ? response(list(c, child, frame2))
          : response({ error: "conflict" }, 409);
      if (t.version !== b.expected_version)
        return response({ error: "conflict" }, 409);
      if (
        child &&
        ["paper", "legacy"].includes(t.task_kind) &&
        b.status === "done"
      )
        return response({ error: "parent_confirmation_required" }, 403);
      let helpNote;
      const hasHelpNote = path.endsWith('/feedback') && Object.prototype.hasOwnProperty.call(b, 'help_note');
      if (hasHelpNote) {
        if (typeof b.help_note !== 'string' || Array.from(b.help_note.trim()).length > 500)
          return response({ error: 'invalid_help_note' }, 400);
        helpNote = b.help_note.trim();
      }
      state.ops.set(b.operation_id, { request: canonical });
      state.history.push({
        task_id: t.id,
        before: t.status,
        after: b.status || t.status,
        version: t.version + 1,
      });
      if (path.endsWith("/assign"))
        ((t.task_kind = b.task_kind), (t.assignment_state = "verified"));
      else { t.status = b.status; if (hasHelpNote) t.help_note = helpNote; }
      t.version++;
      if (!persistOrRollback()) return response({ error: "persist_failed" }, 503);
      return response(list(c, child, frame2));
    }
    if (path.endsWith("/records")) {
      if (method === "GET")
        return response({
          records: clone(
            state.records.filter(
              (r) =>
                r.kind === q.get("kind") &&
                r.day === q.get("day") &&
                r.child_id === q.get("child"),
            ),
          ),
        });
      const prior = state.ops.get(b.operation_id),
        canonical = JSON.stringify(b);
      if (prior)
        return prior.request === canonical
          ? response({ replayed: true })
          : response({ error: "conflict" }, 409);
      const row = state.records.find((r) => r.id === b.id);
      if ((row?.version || 0) !== b.expected_version)
        return response({ error: "conflict" }, 409);
      if (
        b.kind === "schedule" &&
        b.payload.enabled &&
        (!b.payload.start || !b.payload.duration)
      )
        return response({ error: "invalid" }, 400);
      if (row) ((row.payload = clone(b.payload)), row.version++);
      else
        state.records.push({
          id: b.id,
          kind: b.kind,
          day: b.day,
          child_id: b.child_id,
          version: b.expected_version + 1,
          payload: clone(b.payload),
        });
      state.ops.set(b.operation_id, { request: canonical });
      if (!persistOrRollback()) return response({ error: "persist_failed" }, 503);
      return response({ saved: true });
    }
    if (path.includes("/photos")) {
      const pc = b
          ? { day: b.day, child_id: b.child_id, task_id: b.task_id }
          : { ...c, task_id: q.get("task") },
        t = state.tasks.find(
          (t2) =>
            t2.id === pc.task_id &&
            t2.day === pc.day &&
            t2.child_id === pc.child_id,
        );
      if (!t) return response({ error: "not_found" }, 404);
      if (t.task_kind !== "paper" || t.assignment_state !== "verified")
        return response({ error: "paper_task_required" }, 403);
      if (path.endsWith("/sent")) {
        const p = getPack(t, frame2),
          canonical = JSON.stringify(b),
          prior = state.ops.get(b.operation_id);
        if (prior)
          return prior.request === canonical
            ? response(p)
            : response({ error: "photo_conflict" }, 409);
        if (p.revision !== b.expected_revision)
          return response({ error: "photo_conflict" }, 409);
        state.packs.set(t.id, {
          revision: p.revision + 1,
          teacher_sent: b.value,
          sent_at: b.value ? /* @__PURE__ */ new Date().toISOString() : null,
        });
        state.ops.set(b.operation_id, { request: canonical });
        if (!persistOrRollback()) return response({ error: "persist_failed" }, 503);
        return response(getPack(t, frame2));
      }
      if (path.endsWith("/zip")) {
        const photos = state.photos.get(t.id) || [];
        if (!photos.length) return response({ error: "no_photos" }, 404);
        for (const im of photos) {
          if (!im.bytes) {
            try {
              im.bytes = await idbGetBytes(t.id, im.id);
            } catch (e) {}
          }
          if (!im.bytes) return response({ error: "photo_bytes_missing" }, 503);
        }
        const files = photos.map((im, i) => ({
          name: "page-" + String(i + 1).padStart(2, "0") + ".jpg",
          bytes: im.bytes,
        }));
        files.push({
          name: "manifest.json",
          bytes: new TextEncoder().encode(
            JSON.stringify(
              {
                task: t.title,
                day: t.day,
                demo: true,
                teacherSubmission: getPack(t, frame2).teacher_sent
                  ? "manually_marked_sent"
                  : "not_marked_sent",
                photos: photos.map((im, i) => ({
                  file: files[i].name,
                  sha256: im.sha256,
                })),
              },
              null,
              2,
            ),
          ),
        });
        return new Response(zipStored(files), {
          headers: { "Content-Type": "application/zip" },
        });
      }
      if (method === "POST") {
        const bytes = new Uint8Array(await options.body.arrayBuffer());
        if (bytes.length > 768 * 1024)
          return response({ error: "photo_upload_limit" }, 429);
        const sha = await window.XBDigest.sha256(bytes),
          pid = q.get("photo"),
          photos = state.photos.get(t.id) || [];
        let photo = photos.find((p) => p.id === pid);
        if (photo && photo.sha256 !== sha)
          return response({ error: "photo_conflict" }, 409);
        if (!photo) {
          if (photos.length >= 12)
            return response({ error: "photo_upload_limit" }, 429);
          photo = {
            id: pid,
            sha256: sha,
            size: bytes.length,
            width: 600,
            height: 800,
            created_at: /* @__PURE__ */ new Date().toISOString(),
            bytes,
            url: URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" })),
          };
          photos.push(photo);
          state.photos.set(t.id, photos);
          const oldPack = getPack(t, frame2);
          state.packs.set(t.id, {
            revision: oldPack.revision + 1,
            teacher_sent: false,
            sent_at: null,
          });
          try {
            await idbPutBytes(t.id, photo.id, bytes);
          } catch (e) {
            console.warn("[mock] 照片 IndexedDB 写入失败", e);
            photos.pop();
            state.photos.set(t.id, photos);
            state.packs.set(t.id, {
              revision: oldPack.revision,
              teacher_sent: oldPack.teacher_sent,
              sent_at: oldPack.sent_at,
            });
            return response({ error: "persist_failed" }, 503);
          }
          if (!persistOrRollback()) {
            idbDeleteBytes(t.id, photo.id).catch(() => {});
            return response({ error: "persist_failed" }, 503);
          }
        }
        return response({
          photo: { id: photo.id, sha256: photo.sha256, size: photo.size },
          pack: getPack(t, frame2),
        });
      }
      return response(getPack(t, frame2));
    }
    return response({ error: "unsupported_demo_operation" }, 404);
  };

  var rawTransport = window.demoTransport;
  // 同页串行写：用 Promise 链，不要在挂着的 IDB 事务里 await 照片库。
  // 旧实现用 coordination IDB 长事务 keepalive，安卓 WebView 上会与照片 IndexedDB 嵌套死锁，
  // 表现为点「给妈妈」无成功/失败提示。跨标签仍靠 persist() 的 rev 合并 + storage 事件。
  var writeChain = Promise.resolve();
  function withLocalTransaction(work) {
    const run = writeChain.then(
      function () { return work(); },
      function () { return work(); },
    );
    writeChain = run.then(
      function () {},
      function () {},
    );
    return run;
  }
  function readCurrentState() {
    const loaded = loadPersisted();
    if (!loaded) return;
    const previous = window.demoState;
    loaded.failRead = previous.failRead;
    loaded.failWrite = previous.failWrite;
    for (const [id, photos] of loaded.photos) {
      const before = previous.photos.get(id) || [];
      loaded.photos.set(id, photos.map(im => {
        const cached = before.find(p => p.id === im.id && p.sha256 === im.sha256 && p.bytes && p.url);
        return cached ? { ...im, bytes: cached.bytes, url: cached.url } : im;
      }));
    }
    adoptState(loaded);
  }
  window.MOCK_LATENCY = 160;
  window.demoTransport = async (url, options = {}) => {
    await new Promise(r => setTimeout(r, window.MOCK_LATENCY * (0.5 + Math.random() * 0.5)));
    try {
      return await withLocalTransaction(async () => {
        transportActive = true;
        try {
          readCurrentState();
          if (String(url).includes("/photos")) await restorePhotoBytesFromIdb(false);
          return await rawTransport(url, options, window);
        } finally { transportActive = false; }
      });
    } catch (e) {
      console.warn("[mock] 本机事务不可用", e);
      return response({ error: "persist_failed" }, 503);
    }
  };

  function applyScenario(name, opts) {
    scenario = name || "normal";
    window.demoState = newState();
    if (scenario === "long")
      window.demoState.tasks[0].title =
        "\u56FE\u5F62\u4E0E\u6570\u5B57\u7EFC\u5408\u7EC3\u4E60\uFF1A\u5148\u627E\u51FA\u4E09\u4E2A\u5706\u5F62\uFF0C\u518D\u6BD4\u8F83\u4E24\u7EC4\u7269\u54C1\u7684\u591A\u5C11\uFF0C\u6700\u540E\u6309\u987A\u5E8F\u5199\u56DB\u4E2A\u6570\u5B57\u5E76\u548C\u5BB6\u957F\u4E00\u8D77\u68C0\u67E5\u662F\u5426\u770B\u6E05\u8981\u6C42";
    if (scenario === "done")
      window.demoState.tasks.forEach((t) => (t.status = "done"));
    if (scenario === "read-fail") window.demoState.failRead = 1;
    if (!opts || opts.persist !== false) persist();
  }
  /* 测试/演示控制面（只存在于 mock，不属于 API 合同） */
  window.MockControl = {
    reset: applyScenario,
    /** 清掉本机存档并恢复最初演示数据（同机刷新后也是干净演示） */
    resetPersisted() {
      try {
        localStorage.removeItem(STORAGE_KEY);
        for (const k of LEGACY_KEYS) localStorage.removeItem(k);
      } catch (e) {}
      idbClearAll().catch(() => {});
      applyScenario("normal");
    },
    persist,
    persistOrRollback,
    storageKey: STORAGE_KEY,
    legacyKeys: LEGACY_KEYS,
    get state() { return window.demoState; },
    get scenario() { return scenario; },
    failRead(n = 1) { window.demoState.failRead = n; },
    failWrite(n = 1) { window.demoState.failWrite = n; },
    /** 接下来 n 次 persist() 强制失败（验误报用） */
    failPersist(n = 1) { failPersistLeft = n; },
    onSync(fn) { persistListeners.add(fn); return () => persistListeners.delete(fn); },
    restorePhotos: restorePhotoBytesFromIdb,
    /* 模拟“另一台设备”改了任务：版本+1，下一次带旧版本的保存会得到 409 */
    touchFromOtherDevice(taskIndex = 0, status) {
      const t = window.demoState.tasks[taskIndex];
      if (status) t.status = status;
      t.version++;
      persist();
      return t.id;
    },
    assets: ASSETS,
  };
  const T = (window.APP_CONFIG && window.APP_CONFIG.TEST) || {};
  /* 默认：有存档则读回；带 ?scenario= 且非 normal 时仍用场景覆盖（方便测试） */
  if (T.scenario && T.scenario !== "normal") {
    applyScenario(T.scenario, { persist: false });
  } else {
    hydrateOrInit();
  }
  if (T.failRead) window.demoState.failRead = T.failRead;
  if (T.failWrite) window.demoState.failWrite = T.failWrite;
})();
