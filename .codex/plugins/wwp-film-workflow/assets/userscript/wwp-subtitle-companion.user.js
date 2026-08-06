// ==UserScript==
// @name         WWP Subtitle Companion (Local)
// @namespace    https://github.com/forestsheep911/wwp
// @version      0.1.0
// @description  Connect subtitle websites to the repo-local WWP subtitle workflow.
// @match        https://subhd.com/*
// @match        https://www.subhd.com/*
// @match        https://subhd.me/*
// @match        https://www.subhd.me/*
// @match        https://subhd.one/*
// @match        https://www.subhd.one/*
// @match        https://subhd.top/*
// @match        https://www.subhd.top/*
// @match        https://subhd.cc/*
// @match        https://www.subhd.cc/*
// @match        https://subhd.tv/*
// @match        https://www.subhd.tv/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      127.0.0.1
// @run-at       document-idle
// ==/UserScript==

(() => {
  "use strict";

  const SERVICE = "wwp-subtitle-companion-bridge";
  const PROVIDER = "subhd";
  const PORT_START = 8818;
  const PORT_END = 8838;
  const ROOT_ID = "wwp-subtitle-companion";
  const CLIENT_KEY = "wwp.subtitleCompanion.clientId";
  let connections = [];
  let tasks = [];
  let busy = false;

  function clientId() {
    let value = GM_getValue(CLIENT_KEY, "");
    if (!value) {
      value = `subhd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      GM_setValue(CLIENT_KEY, value);
    }
    return value;
  }

  function request(options) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: options.method || "GET",
        url: options.url,
        headers: options.headers || {},
        data: options.data,
        responseType: "json",
        timeout: options.timeout || 10000,
        onload: resolve,
        onerror: () => reject(new Error("无法连接本地字幕 Bridge。")),
        ontimeout: () => reject(new Error("连接本地字幕 Bridge 超时。")),
      });
    });
  }

  async function probe(port) {
    try {
      const response = await request({ url: `http://127.0.0.1:${port}/health`, timeout: 700 });
      const body = response.response;
      if (response.status !== 200 || body?.service !== SERVICE || !body.token) return null;
      return { port, token: body.token, instanceId: body.instanceId };
    } catch {
      return null;
    }
  }

  async function discover() {
    const values = await Promise.all(
      Array.from({ length: PORT_END - PORT_START + 1 }, (_, index) => probe(PORT_START + index)),
    );
    connections = values.filter(Boolean);
    renderConnection();
    return connections;
  }

  function bridgeUrl(connection, path) {
    const url = new URL(path, `http://127.0.0.1:${connection.port}`);
    url.searchParams.set("bridgeToken", connection.token);
    return url.href;
  }

  async function getJson(connection, path) {
    const response = await request({ url: bridgeUrl(connection, path) });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(response.response?.error || `Bridge 请求失败：HTTP ${response.status}`);
    }
    return response.response;
  }

  async function postJson(connection, path, value) {
    const response = await request({
      method: "POST",
      url: bridgeUrl(connection, path),
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify(value),
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(response.response?.error || `Bridge 写入失败：HTTP ${response.status}`);
    }
    return response.response;
  }

  function searchQuery(task) {
    const work = task.work || {};
    return [work.originalTitle || work.title, work.year].filter(Boolean).join(" ");
  }

  function normalizeSpace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function languageLabels(text) {
    return unique(["简体", "繁体", "双语", "英语", "粤语", "简英", "繁英"].filter((label) => text.includes(label)));
  }

  function formatLabels(text) {
    return unique((text.match(/\b(?:ASS|SSA|SRT|SUP|SUB)\b/gi) || []).map((value) => value.toUpperCase()));
  }

  function candidateContainer(anchor) {
    let current = anchor.parentElement;
    while (current && current !== document.body) {
      const text = normalizeSpace(current.innerText);
      const links = current.querySelectorAll('a[href*="/a/"]').length;
      if (text.length >= 40 && text.length <= 2500 && links <= 4) return current;
      current = current.parentElement;
    }
    return anchor.parentElement || anchor;
  }

  function extractSearchCandidates() {
    const grouped = new Map();
    for (const anchor of document.querySelectorAll('a[href*="/a/"]')) {
      const url = new URL(anchor.href, location.href);
      const match = url.pathname.match(/^\/a\/([^/]+)/);
      if (!match) continue;
      const detailUrl = `${url.origin}${url.pathname}`;
      const entry = grouped.get(detailUrl) || { id: `${PROVIDER}:${match[1]}`, detailUrl, anchors: [] };
      const text = normalizeSpace(anchor.innerText || anchor.textContent);
      if (text) entry.anchors.push(text);
      grouped.set(detailUrl, entry);
    }
    return [...grouped.values()].map((entry) => {
      const anchor = [...document.querySelectorAll('a[href*="/a/"]')].find((item) => {
        const url = new URL(item.href, location.href);
        return `${url.origin}${url.pathname}` === entry.detailUrl;
      });
      const container = anchor ? candidateContainer(anchor) : document.body;
      const rawText = normalizeSpace(container.innerText).slice(0, 2400);
      const anchorTexts = unique(entry.anchors).sort((a, b) => b.length - a.length);
      const badges = unique([...container.querySelectorAll("span")].map((item) => normalizeSpace(item.innerText)).filter((text) => text.length <= 16));
      return {
        id: entry.id,
        provider: PROVIDER,
        workTitle: anchorTexts.at(-1) || anchorTexts[0] || "",
        releaseTitle: anchorTexts[0] || "",
        detailUrl: entry.detailUrl,
        languageLabels: languageLabels(rawText),
        formatLabels: formatLabels(rawText),
        badges: badges.filter((value) => /官方|双语|字幕组|精校|特效|AI|OCR/i.test(value)),
        rawText,
      };
    });
  }

  function extractDetailCandidate() {
    const match = location.pathname.match(/^\/a\/([^/]+)/);
    if (!match) return [];
    const pageText = normalizeSpace(document.body.innerText).slice(0, 6000);
    const heading = normalizeSpace(document.querySelector("h1")?.innerText);
    const headings = [...document.querySelectorAll("h1, h2, h3")].map((item) => normalizeSpace(item.innerText)).filter(Boolean);
    const fileNames = [...document.querySelectorAll("body *")]
      .map((item) => item.children.length ? "" : normalizeSpace(item.textContent))
      .filter((text) => /\.(?:ass|ssa|srt|sup|sub)(?:\s|$)/i.test(text))
      .slice(0, 30);
    return [{
      id: `${PROVIDER}:${match[1]}`,
      provider: PROVIDER,
      workTitle: heading,
      releaseTitle: headings.find((value) => value !== heading) || document.title,
      detailUrl: `${location.origin}${location.pathname}`,
      languageLabels: languageLabels(pageText),
      formatLabels: formatLabels(pageText),
      badges: unique([/官方字幕/.test(pageText) ? "官方字幕" : "", /双语/.test(pageText) ? "双语" : ""]),
      fileNames: unique(fileNames),
      rawText: pageText.slice(0, 3000),
    }];
  }

  function extractCandidates() {
    return location.pathname.startsWith("/a/") ? extractDetailCandidate() : extractSearchCandidates();
  }

  function setMessage(value, kind = "normal") {
    const element = document.querySelector(`#${ROOT_ID} .wwp-message`);
    if (!element) return;
    element.textContent = value;
    element.dataset.kind = kind;
  }

  function renderConnection() {
    const element = document.querySelector(`#${ROOT_ID} .wwp-connection`);
    if (!element) return;
    element.textContent = connections.length ? `Bridge 已连接${connections.length > 1 ? `（${connections.length}）` : ""}` : "Bridge 离线";
    element.dataset.online = connections.length ? "true" : "false";
  }

  function renderTasks() {
    const root = document.querySelector(`#${ROOT_ID} .wwp-tasks`);
    if (!root) return;
    root.replaceChildren();
    if (!tasks.length) {
      const empty = document.createElement("p");
      empty.textContent = "没有 SubHD 字幕任务。";
      empty.className = "wwp-empty";
      root.append(empty);
      return;
    }
    for (const match of tasks) {
      const item = document.createElement("section");
      item.className = "wwp-task";
      const title = document.createElement("strong");
      title.textContent = [match.task.work?.title, match.task.work?.year].filter(Boolean).join(" · ");
      const source = document.createElement("small");
      source.textContent = normalizeSpace(match.task.source?.fileName || match.task.source?.release || "待补字幕");
      const state = document.createElement("span");
      state.className = "wwp-state";
      state.textContent = match.task.status;
      const actions = document.createElement("div");
      actions.className = "wwp-actions";
      const search = document.createElement("button");
      search.textContent = "搜索";
      search.disabled = busy;
      search.addEventListener("click", () => {
        location.href = `${location.origin}/search/${encodeURIComponent(searchQuery(match.task))}`;
      });
      const capture = document.createElement("button");
      capture.textContent = "采集当前页";
      capture.disabled = busy;
      capture.addEventListener("click", () => void capturePage(match));
      actions.append(search, capture);
      item.append(title, source, state, actions);
      root.append(item);
    }
  }

  async function refreshTasks() {
    if (busy) return;
    busy = true;
    setMessage("正在发现本地 Bridge…", "working");
    try {
      await discover();
      if (!connections.length) throw new Error("没有发现本地字幕 Bridge。请先创建字幕任务。");
      const groups = await Promise.all(connections.map(async (connection) => {
        const payload = await getJson(connection, `/v1/tasks?provider=${PROVIDER}`);
        return (payload.tasks || []).map((task) => ({ connection, task }));
      }));
      tasks = groups.flat().filter((match) => !["downloaded", "selected", "deferred"].includes(match.task.status));
      setMessage(tasks.length ? `已读取 ${tasks.length} 个任务。` : "当前没有待采集任务。", tasks.length ? "success" : "normal");
    } catch (error) {
      tasks = [];
      setMessage(error instanceof Error ? error.message : String(error), "error");
    } finally {
      busy = false;
      renderTasks();
    }
  }

  async function capturePage(match) {
    if (busy) return;
    busy = true;
    renderTasks();
    setMessage("正在采集当前 SubHD 页面…", "working");
    try {
      const task = await getJson(match.connection, `/v1/tasks/${encodeURIComponent(match.task.id)}`);
      const candidates = extractCandidates();
      if (!candidates.length) throw new Error("当前页面没有识别到字幕候选，请先打开搜索结果或字幕详情页。");
      const common = { hash: task.hash, provider: PROVIDER, clientId: clientId() };
      await postJson(match.connection, `/v1/tasks/${encodeURIComponent(task.id)}/claim`, common);
      await postJson(match.connection, `/v1/tasks/${encodeURIComponent(task.id)}/candidates`, {
        ...common,
        query: searchQuery(match.task),
        pageUrl: location.href,
        candidates,
      });
      setMessage(`已回传 ${candidates.length} 个候选。本地流程将负责匹配与质量比较。`, "success");
      match.task.status = "candidates_ready";
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error), "error");
    } finally {
      busy = false;
      renderTasks();
    }
  }

  function addStyles() {
    const style = document.createElement("style");
    style.textContent = `
      #${ROOT_ID}{position:fixed;right:18px;bottom:18px;width:310px;z-index:2147483647;background:#101722;color:#eaf2ff;border:1px solid #31435f;border-radius:12px;box-shadow:0 12px 36px #0007;font:13px/1.45 system-ui,sans-serif;overflow:hidden}
      #${ROOT_ID} header{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#172236}
      #${ROOT_ID} header strong{font-size:14px} #${ROOT_ID} button{border:1px solid #45658e;border-radius:7px;background:#203653;color:#eef6ff;padding:6px 9px;cursor:pointer}
      #${ROOT_ID} button:hover{background:#2a4b74} #${ROOT_ID} button:disabled{opacity:.5;cursor:default}
      #${ROOT_ID} .wwp-body{padding:10px} #${ROOT_ID} .wwp-connection{font-size:12px;color:#f6a96b} #${ROOT_ID} .wwp-connection[data-online=true]{color:#78dba9}
      #${ROOT_ID} .wwp-message{margin:8px 0;color:#afc1d9;white-space:pre-wrap} #${ROOT_ID} .wwp-message[data-kind=error]{color:#ff9b9b} #${ROOT_ID} .wwp-message[data-kind=success]{color:#78dba9}
      #${ROOT_ID} .wwp-task{display:grid;gap:5px;padding:9px 0;border-top:1px solid #293a53} #${ROOT_ID} .wwp-task small{color:#9eb0c8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #${ROOT_ID} .wwp-state{font-size:11px;color:#80baff} #${ROOT_ID} .wwp-actions{display:flex;gap:7px} #${ROOT_ID} .wwp-empty{color:#9eb0c8}
    `;
    document.head.append(style);
  }

  function createPanel() {
    if (document.getElementById(ROOT_ID)) return;
    addStyles();
    const root = document.createElement("aside");
    root.id = ROOT_ID;
    root.innerHTML = `
      <header><strong>WWP 字幕 Companion</strong><span class="wwp-connection">Bridge 离线</span></header>
      <div class="wwp-body">
        <button class="wwp-refresh" type="button">刷新任务</button>
        <p class="wwp-message">先在本地创建字幕任务，再刷新。</p>
        <div class="wwp-tasks"></div>
      </div>`;
    document.body.append(root);
    root.querySelector(".wwp-refresh")?.addEventListener("click", () => void refreshTasks());
  }

  createPanel();
})();
