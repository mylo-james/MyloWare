(() => {
  const trimTrailingSlash = (value) => (value || "").replace(/\/$/, "");

  const primaryApiBase = trimTrailingSlash(document.body.dataset.apiBase || window.location.origin);
  const fallbackApiBase = trimTrailingSlash(document.body.dataset.apiFallback || "");
  let apiBase = primaryApiBase;

  const form = document.getElementById("demo-form");
  const briefInput = document.getElementById("brief");
  const startBtn = document.getElementById("start-btn");

  const statusPill = document.getElementById("status-pill");
  const statusTime = document.getElementById("status-time");
  const toast = document.getElementById("toast");
  const topicLine = document.getElementById("topic-line");

  const activityList = document.getElementById("activity-list");
  const refreshNowBtn = document.getElementById("refresh-now");

  const stepperEl = document.getElementById("timeline-tabs");
  const timelineSteps = Array.from(document.querySelectorAll(".stepper .step"));
  const panels = Array.from(document.querySelectorAll(".timeline-panel"));

  const ideasBody = document.getElementById("ideas-body");
  const copyIdeasBtn = document.getElementById("copy-ideas-btn");
  const ideationLive = document.getElementById("ideation-live");
  const miniActivityList = document.getElementById("mini-activity");

  const ideationComment = document.getElementById("idea-approval-comment");
  const publishComment = document.getElementById("publish-approval-comment");
  const approveIdeationBtn = document.getElementById("approve-idea-btn");
  const rejectIdeationBtn = document.getElementById("reject-idea-btn");
  const approvePublishBtn = document.getElementById("approve-publish-btn");
  const rejectPublishBtn = document.getElementById("reject-publish-btn");

  const clipCountEl = document.getElementById("clip-count");
  const videoProgressFill = document.getElementById("video-progress-fill");
  const videoProgressLabel = document.getElementById("video-progress-label");
  const renderPreview = document.getElementById("render-preview");
  const publishPreview = document.getElementById("publish-preview");
  const renderStatusValue = document.getElementById("render-status");
  const renderProgressFill = document.getElementById("render-progress-fill");
  const renderProgressLabel = document.getElementById("render-progress-label");

  const resultBody = document.getElementById("result-body");
  const newRunBtn = document.getElementById("new-run-btn");
  const topNewRunBtn = document.getElementById("top-new-run-btn");

  const runsList = document.getElementById("runs-list");
  const refreshRunsBtn = document.getElementById("refresh-runs");
  const runsDetails = document.getElementById("runs-details");

  const runsStorageKey = "myloware_demo_runs";
  const activeRunKey = "myloware_demo_active_token";

  const statusLabels = {
    idle: "Idle",
    pending: "Queued",
    running: "Ideation",
    awaiting_ideation_approval: "Idea approval",
    awaiting_video_generation: "Production",
    awaiting_render: "Render",
    awaiting_publish_approval: "Publish approval",
    awaiting_publish: "Publishing",
    completed: "Completed",
    failed: "Failed",
    rejected: "Rejected",
  };

  const timelineOrder = [
    "begin",
    "ideation",
    "idea-approval",
    "production",
    "render",
    "publish-approval",
    "publish",
    "done",
  ];

  const statusToPanel = {
    idle: "begin",
    pending: "ideation",
    running: "ideation",
    awaiting_ideation_approval: "idea-approval",
    awaiting_video_generation: "production",
    awaiting_render: "render",
    awaiting_publish_approval: "publish-approval",
    awaiting_publish: "publish",
    completed: "done",
    failed: "done",
    rejected: "done",
  };

  const terminalStatuses = ["completed", "failed", "rejected"];

  let pollTimer = null;
  let currentToken = null;
  let currentStatus = "idle";
  let lastStatus = "idle";
  let lastUpdatedAt = null;
  let headerOverride = null;
  let toastTimer = null;
  let lastRemoteActivity = [];

  const globalActivityToken = "__global__";
  const localActivityByToken = new Map();
  const lastStatusByToken = new Map();
  const stageStartsByToken = new Map();
  const optimisticPanelFloorByToken = new Map();

  const ensureTimezone = (iso) => {
    const value = String(iso || "");
    if (!value) return "";
    if (/[zZ]$/.test(value)) return value;
    if (/[+-]\d\d:\d\d$/.test(value)) return value;
    if (/[+-]\d{4}$/.test(value)) return value;
    // API currently returns naive UTC timestamps; treat missing tz as UTC.
    return `${value}Z`;
  };

  const formatTime = (iso) => {
    if (!iso) return "";
    const date = new Date(ensureTimezone(iso));
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString();
  };

  const formatRelative = (iso) => {
    if (!iso) return "";
    const date = new Date(ensureTimezone(iso));
    if (Number.isNaN(date.getTime())) return "";
    const delta = Math.max(0, Date.now() - date.getTime());
    const seconds = Math.floor(delta / 1000);
    if (seconds < 5) return "Updated just now";
    if (seconds < 60) return `Updated ${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `Updated ${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `Updated ${hours}h ago`;
  };

  const showToast = ({ message, kind = "info", persist = false }) => {
    if (!toast) return;
    toast.classList.remove("is-hidden", "info", "error");
    toast.classList.add(kind);
    toast.textContent = message;
    toast.dataset.persist = persist ? "true" : "false";
    toast.dataset.kind = kind;

    if (toastTimer) clearTimeout(toastTimer);
    if (!persist) {
      toastTimer = setTimeout(() => {
        toast.classList.add("is-hidden");
      }, 6000);
    }
  };

  const hideToast = () => {
    if (!toast) return;
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    toast.classList.add("is-hidden");
    toast.classList.remove("info", "error");
    toast.textContent = "";
    delete toast.dataset.persist;
    delete toast.dataset.kind;
  };

  const hideToastIfStale = () => {
    if (!toast || toast.classList.contains("is-hidden")) return;
    const persist = toast.dataset.persist === "true";
    const isError = toast.classList.contains("error");
    if (persist || isError) hideToast();
  };

  const setHeaderOverride = (override) => {
    headerOverride = override;
    renderHeader();
  };

  const renderHeader = () => {
    if (statusPill) {
      const label = headerOverride?.label || statusLabels[lastStatus] || lastStatus;
      statusPill.textContent = label;
      statusPill.classList.toggle("is-loading", Boolean(headerOverride?.loading));
    }

    if (statusTime) {
      if (headerOverride?.timeText) {
        statusTime.textContent = headerOverride.timeText;
        return;
      }
      const relative = formatRelative(lastUpdatedAt);
      statusTime.textContent = relative || (lastStatus === "idle" ? "" : "Waiting for updates…");
    }
  };

  const loadRuns = () => {
    try {
      const raw = localStorage.getItem(runsStorageKey);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  };

  const saveRuns = (runs) => {
    localStorage.setItem(runsStorageKey, JSON.stringify(runs));
  };

  const upsertRun = (token, updates) => {
    const runs = loadRuns();
    const idx = runs.findIndex((run) => run.token === token);
    if (idx === -1) {
      runs.unshift({ token, ...updates });
    } else {
      runs[idx] = { ...runs[idx], ...updates };
    }
    saveRuns(runs.slice(0, 30));
  };

  const setActivePanel = (panelKey) => {
    panels.forEach((panel) => {
      panel.classList.toggle("active", panel.dataset.panel === panelKey);
    });
  };

  const updateStepperLine = () => {
    if (!stepperEl) return;
    const activeStep = stepperEl.querySelector(".step.active");
    const dot = activeStep?.querySelector(".dot");
    if (!(dot instanceof HTMLElement)) {
      stepperEl.style.setProperty("--progress-width", "0px");
      return;
    }

    const stepperRect = stepperEl.getBoundingClientRect();
    const dotRect = dot.getBoundingClientRect();
    const dotCenter =
      stepperEl.scrollLeft + (dotRect.left - stepperRect.left) + dotRect.width / 2;
    const lineStart = 24;
    const width = Math.max(0, dotCenter - lineStart);
    stepperEl.style.setProperty("--progress-width", `${width}px`);
  };

  const setStepperProgress = (panelKey) => {
    const activeIndex = timelineOrder.indexOf(panelKey);
    timelineSteps.forEach((step) => {
      step.classList.remove("active", "done");
      const idx = timelineOrder.indexOf(step.dataset.step || "");
      if (idx === -1 || activeIndex === -1) return;
      if (idx < activeIndex) step.classList.add("done");
      if (idx === activeIndex) step.classList.add("active");
    });
    updateStepperLine();
  };

  const loadingStepForStatus = (status) => {
    if (status === "pending" || status === "running") return "ideation";
    if (status === "awaiting_video_generation") return "production";
    if (status === "awaiting_render") return "render";
    if (status === "awaiting_publish") return "publish";
    return null;
  };

  const setStepperLoading = (loadingKey) => {
    timelineSteps.forEach((step) => {
      step.classList.toggle("is-loading", loadingKey && step.dataset.step === loadingKey);
    });
  };

  const renderActivity = (activity) => {
    if (!activityList) return;
    if (!Array.isArray(activity) || activity.length === 0) {
      activityList.innerHTML =
        '<li><div class="activity-msg">No events yet.</div><div class="activity-time">—</div></li>';
      return;
    }

    activityList.innerHTML = activity
      .slice(0, 12)
      .map((evt) => {
        const at = evt.at ? formatTime(evt.at) : "";
        const msg = evt.message || evt.type || "event";
        return `
          <li>
            <div class="activity-msg">${escapeHtml(msg)}</div>
            <div class="activity-time">${escapeHtml(at || "—")}</div>
          </li>
        `;
      })
      .join("");
  };

  const renderMiniActivity = (activity) => {
    if (!miniActivityList) return;
    if (!Array.isArray(activity) || activity.length === 0) {
      miniActivityList.innerHTML = '<li><span class="msg">Waiting for events…</span><span class="at">—</span></li>';
      return;
    }

    miniActivityList.innerHTML = activity
      .slice(0, 4)
      .map((evt) => {
        const msg = evt.message || evt.type || "event";
        const at = evt.at ? formatRelative(evt.at) : "";
        return `<li><span class="msg">${escapeHtml(msg)}</span><span class="at">${escapeHtml(at || "—")}</span></li>`;
      })
      .join("");
  };

  const escapeHtml = (raw) =>
    String(raw || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  const extractTikTokVideoId = (url) => {
    const raw = String(url || "");
    const match = raw.match(/\/video\/(\d+)/);
    if (match?.[1]) return match[1];
    try {
      const parsed = new URL(raw);
      const parts = parsed.pathname.split("/").filter(Boolean);
      const idx = parts.indexOf("video");
      if (idx !== -1 && parts[idx + 1]) return parts[idx + 1];
    } catch {
      // ignore
    }
    return null;
  };

  const resolveAbsoluteUrl = (url) => {
    const rawUrl = String(url || "").trim();
    if (!rawUrl) return "";
    return rawUrl.startsWith("/") ? `${apiBase}${rawUrl}` : rawUrl;
  };

  const renderVideoPreview = (container, url, fallbackUrl) => {
    if (!container) return;

    const safePrimaryUrl = resolveAbsoluteUrl(url);
    const safeFallbackUrl = resolveAbsoluteUrl(fallbackUrl);
    const previousPrimaryUrl = container.dataset.primaryUrl || "";

    if (previousPrimaryUrl && previousPrimaryUrl !== safePrimaryUrl) {
      container.dataset.forceFallback = "false";
    }

    const forceFallback = container.dataset.forceFallback === "true";
    const safeUrl = forceFallback && safeFallbackUrl ? safeFallbackUrl : safePrimaryUrl;
    const previousUrl = container.dataset.url || "";

    if (previousUrl === safeUrl && container.dataset.ready === "true") {
      return;
    }

    container.dataset.url = safeUrl;
    container.dataset.primaryUrl = safePrimaryUrl;
    container.dataset.fallbackUrl = safeFallbackUrl;
    container.dataset.ready = "true";
    container.innerHTML = "";
    if (!safeUrl) {
      container.innerHTML = '<p class="muted">No preview available yet.</p>';
      return;
    }

    const looksLikeMp4 = safeUrl.includes(".mp4") || safeUrl.includes("video");

    if (looksLikeMp4) {
      const loader = document.createElement("div");
      loader.className = "preview-loader";
      loader.innerHTML =
        '<div class="spinner" aria-hidden="true"></div><span class="muted">Loading preview…</span>';

      const video = document.createElement("video");
      video.controls = true;
      video.preload = "metadata";
      video.setAttribute("playsinline", "");
      video.src = safeUrl;

      video.addEventListener(
        "loadeddata",
        () => {
          loader.remove();
        },
        { once: true }
      );

      video.addEventListener("error", () => {
        const currentSrc = video.currentSrc || video.src || "";
        if (
          safeFallbackUrl &&
          container.dataset.forceFallback !== "true" &&
          currentSrc === safePrimaryUrl
        ) {
          container.dataset.forceFallback = "true";
          container.dataset.url = safeFallbackUrl;
          video.src = safeFallbackUrl;
          return;
        }

        container.dataset.ready = "false";
        loader.remove();
        container.innerHTML = '<p class="muted">Preview failed to load. Try refreshing.</p>';
      });

      container.appendChild(loader);
      container.appendChild(video);
      return;
    }

    container.innerHTML = `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noreferrer">Open preview</a>`;
  };

  const renderDone = ({ status, published_url, rendered_video_url, error }) => {
    if (!resultBody) return;
    resultBody.innerHTML = "";

    const normalizedRenderedUrl = (() => {
      const raw = String(rendered_video_url || "").trim();
      if (!raw) return "";
      return raw.startsWith("/") ? `${apiBase}${raw}` : raw;
    })();

    if (status === "completed" && published_url) {
      resultBody.innerHTML = `
        <div class="result-card">
          <div class="muted">Published link</div>
          <a href="${escapeHtml(published_url)}" target="_blank" rel="noreferrer">${escapeHtml(
        published_url
      )}</a>
        </div>
      `;

      const tiktokId = extractTikTokVideoId(published_url);
      if (tiktokId) {
        const embedUrl = `https://www.tiktok.com/embed/v2/${tiktokId}`;
        resultBody.innerHTML += `
          <div class="result-card">
            <div class="muted">TikTok preview</div>
            <iframe
              class="tiktok-embed-frame"
              title="TikTok preview"
              loading="lazy"
              src="${escapeHtml(embedUrl)}"
              allow="fullscreen; autoplay"
              scrolling="no"
            ></iframe>
          </div>
        `;
      }
      return;
    }

    if (status === "completed" && normalizedRenderedUrl) {
      resultBody.innerHTML = `
        <div class="result-card">
          <div class="muted">Rendered preview</div>
          <video controls preload="metadata" playsinline src="${escapeHtml(
            normalizedRenderedUrl
          )}"></video>
        </div>
      `;
      return;
    }

    if (status === "rejected") {
      resultBody.innerHTML = `
        <div class="result-card">
          <div class="muted">Run rejected</div>
          <div>No video was published.</div>
        </div>
      `;
      return;
    }

    if (status === "failed") {
      resultBody.innerHTML = `
        <div class="result-card">
          <div class="muted">Run failed</div>
          <div>${escapeHtml(error || "Try again with a new topic.")}</div>
        </div>
      `;
      return;
    }

    resultBody.innerHTML = `
      <div class="result-card">
        <div class="muted">Status</div>
        <div>${escapeHtml(statusLabels[status] || status || "Unknown")}</div>
      </div>
    `;
  };

  const renderRuns = (runs) => {
    if (!runsList) return;
    if (!Array.isArray(runs) || runs.length === 0) {
      runsList.innerHTML = '<p class="muted">No runs yet.</p>';
      return;
    }

    runsList.innerHTML = runs
      .slice(0, 30)
      .map((run) => {
        const status = statusLabels[run.status] || run.status || "Unknown";
        const brief = run.brief ? run.brief.slice(0, 120) : "No topic saved.";
        const shareUrl = `${window.location.origin}${window.location.pathname}?run=${run.token}`;
        const active = run.token === currentToken;
        return `
          <div class="run-card" data-active="${active ? "true" : "false"}">
            <header>
              <strong>${escapeHtml(status)}</strong>
              <span class="run-meta">${escapeHtml(
                formatTime(run.updated_at || run.created_at)
              )}</span>
            </header>
            <p>${escapeHtml(brief)}</p>
            <div class="run-actions">
              <button class="btn tertiary" data-action="view" data-token="${escapeHtml(
                run.token
              )}" type="button">View</button>
              <a href="${escapeHtml(shareUrl)}">Share</a>
              ${
                run.published_url
                  ? `<a href="${escapeHtml(
                      run.published_url
                    )}" target="_blank" rel="noreferrer">TikTok</a>`
                  : ""
              }
            </div>
          </div>
        `;
      })
      .join("");
  };

  const fetchApi = async (path, options) => {
    const attempt = async (base) => fetch(`${base}${path}`, options);
    try {
      return await attempt(apiBase);
    } catch (err) {
      if (fallbackApiBase && apiBase !== fallbackApiBase) {
        apiBase = fallbackApiBase;
        return await attempt(apiBase);
      }
      throw err;
    }
  };

  const activateRun = (token) => {
    currentToken = token;
    localStorage.setItem(activeRunKey, token);
    lastRemoteActivity = [];
  };

  const clearActiveRun = () => {
    currentToken = null;
    localStorage.removeItem(activeRunKey);
  };

  const stopPolling = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const setButtonLoading = (button, loading, label) => {
    if (!(button instanceof HTMLButtonElement)) return;
    if (!button.dataset.defaultLabel) {
      button.dataset.defaultLabel = button.textContent || "";
    }
    if (loading) {
      button.classList.add("is-loading");
      if (label) button.textContent = label;
      return;
    }
    button.classList.remove("is-loading");
    button.textContent = button.dataset.defaultLabel || button.textContent || "";
  };

  const parseTimeMs = (iso) => {
    if (!iso) return 0;
    const date = new Date(ensureTimezone(iso));
    if (Number.isNaN(date.getTime())) return 0;
    return date.getTime();
  };

  const getLocalActivity = (token) => {
    const key = token || globalActivityToken;
    const raw = localActivityByToken.get(key);
    return Array.isArray(raw) ? raw : [];
  };

  const mergeActivity = (remoteActivity) => {
    const local = getLocalActivity(currentToken);
    const remote = Array.isArray(remoteActivity) ? remoteActivity : [];
    const merged = [...local, ...remote]
      .filter((evt) => evt && typeof evt === "object")
      .sort((a, b) => parseTimeMs(b.at) - parseTimeMs(a.at));
    return merged;
  };

  const recordLocalEvent = (token, { message, type = "ui" }) => {
    const key = token || globalActivityToken;
    const existing = getLocalActivity(key);
    const next = [
      { at: new Date().toISOString(), type, message },
      ...existing,
    ].slice(0, 20);
    localActivityByToken.set(key, next);
  };

  const promoteGlobalActivity = (token) => {
    if (!token) return;
    const pending = getLocalActivity(globalActivityToken);
    if (!pending.length) return;
    const existing = getLocalActivity(token);
    localActivityByToken.set(token, [...pending, ...existing].slice(0, 20));
    localActivityByToken.set(globalActivityToken, []);
  };

  const clearLocalActivity = (token) => {
    const key = token || globalActivityToken;
    localActivityByToken.set(key, []);
  };

  const maybeEmitStageStart = (token, status) => {
    if (!token) return;
    const startMessages = {
      running: "Ideation started",
      awaiting_video_generation: "Production started",
      awaiting_render: "Render started",
      awaiting_publish_approval: "Publish approval requested",
      awaiting_publish: "Publishing started",
    };
    const message = startMessages[status];
    if (!message) return;

    const seen = stageStartsByToken.get(token) || new Set();
    if (seen.has(status)) return;
    seen.add(status);
    stageStartsByToken.set(token, seen);
    recordLocalEvent(token, { type: "ui", message });
  };

  const applyRunState = (data) => {
    const status = data.status || "pending";
    currentStatus = status;
    lastStatus = status;
    lastUpdatedAt = data.updated_at || null;
    let currentStep = String(data.current_step || "").trim();

    renderHeader();

    const topic = data.brief || data.topic || "";
    if (topicLine) {
      if (topic && topic.trim().length > 0) {
        topicLine.textContent = `Topic: ${topic.trim()}`;
        topicLine.classList.remove("is-hidden");
      } else {
        topicLine.textContent = "";
        topicLine.classList.add("is-hidden");
      }
    }

    const serverPanelKey = statusToPanel[status] || "begin";
    let panelKey = serverPanelKey;
    let uiStatus = status;

    const optimisticPanel = currentToken ? optimisticPanelFloorByToken.get(currentToken) : null;
    if (optimisticPanel) {
      const serverIdx = timelineOrder.indexOf(serverPanelKey);
      const optimisticIdx = timelineOrder.indexOf(optimisticPanel);
      if (serverIdx !== -1 && optimisticIdx !== -1) {
        if (serverIdx >= optimisticIdx) {
          optimisticPanelFloorByToken.delete(currentToken);
          if (
            headerOverride?.source === "optimistic" &&
            headerOverride?.token === currentToken
          ) {
            setHeaderOverride(null);
          }
        } else {
          panelKey = optimisticPanel;
          const panelToUiStatus = {
            ideation: "running",
            production: "awaiting_video_generation",
            render: "awaiting_render",
            publish: "awaiting_publish",
          };
          uiStatus = panelToUiStatus[panelKey] || status;
          if (panelKey === "production" && serverPanelKey !== "production") {
            currentStep = "producer";
          }
          if (panelKey === "publish" && serverPanelKey !== "publish") {
            currentStep = "publishing";
          }
        }
      } else {
        optimisticPanelFloorByToken.delete(currentToken);
      }
    }

    setActivePanel(panelKey);
    setStepperProgress(panelKey);
    setStepperLoading(loadingStepForStatus(uiStatus));

    if (currentToken) {
      const prev = lastStatusByToken.get(currentToken);
      if (prev !== undefined && prev !== status) {
        maybeEmitStageStart(currentToken, status);
      }
      lastStatusByToken.set(currentToken, status);
    }

    const clipCount = typeof data.clip_count === "number" ? data.clip_count : null;
    const expectedClips =
      typeof data.expected_clip_count === "number" ? data.expected_clip_count : null;

    if (clipCountEl) {
      if (clipCount !== null && expectedClips !== null && expectedClips > 0) {
        clipCountEl.textContent = `${clipCount} / ${expectedClips}`;
      } else if (clipCount !== null) {
        clipCountEl.textContent = String(clipCount);
      } else {
        clipCountEl.textContent = "—";
      }
    }

    if (videoProgressFill || videoProgressLabel) {
      let percent =
        typeof data.video_progress_percent === "number" ? data.video_progress_percent : null;
      if (percent === null && clipCount !== null && expectedClips !== null && expectedClips > 0) {
        percent = Math.floor((clipCount / expectedClips) * 100);
      }
      if (percent !== null) {
        percent = Math.max(0, Math.min(100, percent));
      }
      const indeterminate = percent === null && uiStatus === "awaiting_video_generation";
      if (videoProgressFill) {
        videoProgressFill.classList.toggle("indeterminate", indeterminate);
        videoProgressFill.style.width = indeterminate
          ? "40%"
          : percent !== null
            ? `${percent}%`
            : "0%";
      }
      if (videoProgressLabel) {
        if (uiStatus === "awaiting_video_generation" && currentStep === "producer") {
          videoProgressLabel.textContent = "Producer drafting Sora prompts…";
        } else if (indeterminate) {
          videoProgressLabel.textContent = "Generating clips…";
        } else if (percent === null) {
          videoProgressLabel.textContent = "Waiting for clips…";
        } else if (percent >= 100) {
          videoProgressLabel.textContent = "Clips ready — continuing…";
        } else {
          videoProgressLabel.textContent = `Generating clips… ${percent}%`;
        }
      }
    }

    if (ideasBody) {
      ideasBody.textContent = data.ideas_markdown || "Draft will appear here once available.";
    }

    if (renderStatusValue) {
      const statusText = data.render_status || (status === "awaiting_render" ? "rendering" : "");
      renderStatusValue.textContent = statusText ? String(statusText) : "—";
    }

    if (renderProgressFill || renderProgressLabel) {
      let percent =
        typeof data.render_progress_percent === "number" ? data.render_progress_percent : null;
      if (percent !== null) {
        percent = Math.max(0, Math.min(100, percent));
      }
      const indeterminate = percent === null && uiStatus === "awaiting_render";
      if (renderProgressFill) {
        renderProgressFill.classList.toggle("indeterminate", indeterminate);
        renderProgressFill.style.width = indeterminate
          ? "40%"
          : percent !== null
            ? `${percent}%`
            : "0%";
      }
      if (renderProgressLabel) {
        if (indeterminate) {
          renderProgressLabel.textContent = "Rendering…";
        } else if (percent === null) {
          renderProgressLabel.textContent = "Waiting for render updates…";
        } else if (percent >= 100) {
          renderProgressLabel.textContent = "Render complete — finalizing…";
        } else {
          renderProgressLabel.textContent = `Rendering… ${percent}%`;
        }
      }
    }

    const renderedUrl = String(data.rendered_video_url || "").trim();
    const hasRenderedVideo = Boolean(renderedUrl);
    const renderJobId = String(data.render_job_id || "").trim();
    const mediaFallback = renderJobId ? `/v1/media/video/${encodeURIComponent(renderJobId)}` : "";

    // Prefer the public demo proxy (or any provided rendered URL) to avoid
    // accidentally hitting the private `/v1/media` endpoints in production.
    const previewPrimary = renderedUrl;
    const previewSecondary = hasRenderedVideo && mediaFallback ? mediaFallback : "";

    renderVideoPreview(renderPreview, previewPrimary, previewSecondary);
    renderVideoPreview(publishPreview, previewPrimary, previewSecondary);

    lastRemoteActivity = Array.isArray(data.activity) ? data.activity : [];
    const activity = mergeActivity(lastRemoteActivity);
    renderActivity(activity);
    renderMiniActivity(activity);

    const terminal = terminalStatuses.includes(status);
    newRunBtn.classList.toggle("is-hidden", !terminal);
    topNewRunBtn?.classList.toggle("is-hidden", !terminal);

    if (panelKey === "ideation" && ideationLive) {
      if (data.ideas_markdown && data.ideas_markdown.trim().length > 0) {
        ideationLive.textContent = "Draft ready — waiting for approval.";
      } else if (activity.length > 0) {
        const latest = activity[0];
        const msg = latest?.message || latest?.type || "Working…";
        const when = latest?.at ? formatRelative(latest.at) : "";
        ideationLive.textContent = when ? `${msg} · ${when}` : msg;
      } else {
        ideationLive.textContent = "Working…";
      }
    }

    if (panelKey === "done") {
      renderDone({
        status,
        published_url: data.published_url,
        rendered_video_url: data.rendered_video_url,
        error: data.error,
      });
    }

    if (currentToken) {
      upsertRun(currentToken, {
        token: currentToken,
        brief: data.brief || data.topic || null,
        status,
        updated_at: data.updated_at || null,
        created_at: data.created_at || null,
        published_url: data.published_url || null,
      });
      renderRuns(loadRuns());
    }
  };

  const pollStatus = async () => {
    if (!currentToken) return;
    try {
      const resp = await fetchApi(`/v1/public/demo/runs/${currentToken}`);
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        showToast({
          kind: "error",
          message: err.detail || "Unable to fetch run status. Try again later.",
        });
        stopPolling();
        applyRunState({ status: "failed", error: err.detail || "Status fetch failed." });
        return;
      }
      const data = await resp.json();
      hideToastIfStale();
      applyRunState(data);
      if (terminalStatuses.includes(data.status)) stopPolling();
    } catch (err) {
      showToast({ kind: "error", message: "Network error while checking status." });
      stopPolling();
      applyRunState({ status: "failed", error: "Network error while checking status." });
    }
  };

  const startPolling = async () => {
    if (!currentToken) return;
    stopPolling();
    pollTimer = setInterval(pollStatus, 5000);
    await pollStatus();
  };

  const handleStart = async (brief) => {
    startBtn.disabled = true;
    setButtonLoading(startBtn, true, "Submitting…");
    setHeaderOverride({ label: "Submitting topic", timeText: "Submitting topic…", loading: true });
    showToast({ message: "Submitting topic…", persist: true });
    recordLocalEvent(null, { message: "Submitting topic…", type: "ui" });
    renderActivity(mergeActivity(lastRemoteActivity));
    renderMiniActivity(mergeActivity(lastRemoteActivity));
    try {
      const resp = await fetchApi("/v1/public/demo/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to start run");
      }

      const payload = await resp.json();
      activateRun(payload.public_token);
      promoteGlobalActivity(payload.public_token);
      lastStatusByToken.set(payload.public_token, "pending");
      recordLocalEvent(payload.public_token, { message: "Ideation started", type: "ui" });
      {
        const seen = stageStartsByToken.get(payload.public_token) || new Set();
        seen.add("running");
        stageStartsByToken.set(payload.public_token, seen);
      }

      const shareUrl = `${window.location.origin}${window.location.pathname}?run=${payload.public_token}`;
      history.replaceState({}, "", shareUrl);

      showToast({ message: "Run started. Share this URL to resume.", persist: false });
      setHeaderOverride(null);

      upsertRun(payload.public_token, {
        token: payload.public_token,
        brief,
        created_at: new Date().toISOString(),
        status: "pending",
      });
      renderRuns(loadRuns());
      await startPolling();
    } catch (err) {
      showToast({ kind: "error", message: err.message || "Failed to start run." });
      applyRunState({ status: "failed", error: err.message || "Failed to start run." });
    } finally {
      setHeaderOverride(null);
      startBtn.disabled = false;
      setButtonLoading(startBtn, false);
    }
  };

  const handleApproval = async ({ approved, comment }) => {
    if (!currentToken) return null;
    const endpoint = approved ? "approve" : "reject";
    const resp = await fetchApi(`/v1/public/demo/runs/${currentToken}/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment: comment || undefined }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.detail || `Failed to ${endpoint}.`);
    }
    return resp.json();
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    stopPolling();
    resultBody.innerHTML = "";

    const brief = briefInput.value.trim();
    if (!brief) return;

    applyRunState({ status: "pending", brief });
    await handleStart(brief);
  });

  copyIdeasBtn?.addEventListener("click", async () => {
    const text = ideasBody?.textContent || "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showToast({ message: "Draft copied.", persist: false });
    } catch {
      showToast({ kind: "error", message: "Unable to copy draft." });
    }
  });

  approveIdeationBtn?.addEventListener("click", async () => {
    if (!currentToken) return;
    approveIdeationBtn.disabled = true;
    rejectIdeationBtn.disabled = true;
    setButtonLoading(approveIdeationBtn, true, "Approving…");
    setHeaderOverride({
      label: "Submitting approval",
      timeText: "Submitting idea approval…",
      loading: true,
    });
    showToast({ message: "Submitting idea approval…", persist: true });
    recordLocalEvent(currentToken, { message: "Submitting idea approval…", type: "ui" });
    renderActivity(mergeActivity(lastRemoteActivity));
    renderMiniActivity(mergeActivity(lastRemoteActivity));
    try {
      await handleApproval({ approved: true, comment: ideationComment.value.trim() });
      optimisticPanelFloorByToken.set(currentToken, "production");
      setHeaderOverride({
        label: "Production",
        timeText: "Approval accepted — starting production…",
        loading: true,
        source: "optimistic",
        token: currentToken,
      });
      applyRunState({
        status: "awaiting_video_generation",
        current_step: "producer",
        updated_at: new Date().toISOString(),
      });
      showToast({ message: "Idea approved. Starting production…", persist: false });
      await startPolling();
    } catch (err) {
      showToast({ kind: "error", message: err.message || "Failed to approve." });
      approveIdeationBtn.disabled = false;
      rejectIdeationBtn.disabled = false;
      setHeaderOverride(null);
    } finally {
      setButtonLoading(approveIdeationBtn, false);
    }
  });

  rejectIdeationBtn?.addEventListener("click", async () => {
    if (!currentToken) return;
    approveIdeationBtn.disabled = true;
    rejectIdeationBtn.disabled = true;
    setButtonLoading(rejectIdeationBtn, true, "Rejecting…");
    setHeaderOverride({
      label: "Submitting rejection",
      timeText: "Submitting idea rejection…",
      loading: true,
    });
    showToast({ message: "Submitting idea rejection…", persist: true });
    recordLocalEvent(currentToken, { message: "Submitting idea rejection…", type: "ui" });
    renderActivity(mergeActivity(lastRemoteActivity));
    renderMiniActivity(mergeActivity(lastRemoteActivity));
    try {
      await handleApproval({ approved: false, comment: ideationComment.value.trim() });
      optimisticPanelFloorByToken.set(currentToken, "done");
      setHeaderOverride({
        label: "Rejected",
        timeText: "Rejection accepted — closing run…",
        loading: true,
        source: "optimistic",
        token: currentToken,
      });
      applyRunState({ status: "rejected", updated_at: new Date().toISOString() });
      showToast({ message: "Run rejected.", persist: false });
      stopPolling();
      await startPolling();
    } catch (err) {
      showToast({ kind: "error", message: err.message || "Failed to reject." });
      approveIdeationBtn.disabled = false;
      rejectIdeationBtn.disabled = false;
      setHeaderOverride(null);
    } finally {
      setButtonLoading(rejectIdeationBtn, false);
    }
  });

  approvePublishBtn?.addEventListener("click", async () => {
    if (!currentToken) return;
    approvePublishBtn.disabled = true;
    rejectPublishBtn.disabled = true;
    setButtonLoading(approvePublishBtn, true, "Approving…");
    setHeaderOverride({
      label: "Submitting approval",
      timeText: "Submitting publish approval…",
      loading: true,
    });
    showToast({ message: "Submitting publish approval…", persist: true });
    recordLocalEvent(currentToken, { message: "Submitting publish approval…", type: "ui" });
    renderActivity(mergeActivity(lastRemoteActivity));
    renderMiniActivity(mergeActivity(lastRemoteActivity));
    try {
      await handleApproval({ approved: true, comment: publishComment.value.trim() });
      optimisticPanelFloorByToken.set(currentToken, "publish");
      setHeaderOverride({
        label: "Publishing",
        timeText: "Approval accepted — publishing…",
        loading: true,
        source: "optimistic",
        token: currentToken,
      });
      applyRunState({
        status: "awaiting_publish",
        current_step: "publishing",
        updated_at: new Date().toISOString(),
      });
      showToast({ message: "Publish approved. Publishing…", persist: false });
      await startPolling();
    } catch (err) {
      showToast({ kind: "error", message: err.message || "Failed to approve." });
      approvePublishBtn.disabled = false;
      rejectPublishBtn.disabled = false;
      setHeaderOverride(null);
    } finally {
      setButtonLoading(approvePublishBtn, false);
    }
  });

  rejectPublishBtn?.addEventListener("click", async () => {
    if (!currentToken) return;
    approvePublishBtn.disabled = true;
    rejectPublishBtn.disabled = true;
    setButtonLoading(rejectPublishBtn, true, "Rejecting…");
    setHeaderOverride({
      label: "Submitting rejection",
      timeText: "Submitting publish rejection…",
      loading: true,
    });
    showToast({ message: "Submitting publish rejection…", persist: true });
    recordLocalEvent(currentToken, { message: "Submitting publish rejection…", type: "ui" });
    renderActivity(mergeActivity(lastRemoteActivity));
    renderMiniActivity(mergeActivity(lastRemoteActivity));
    try {
      await handleApproval({ approved: false, comment: publishComment.value.trim() });
      optimisticPanelFloorByToken.set(currentToken, "done");
      setHeaderOverride({
        label: "Rejected",
        timeText: "Rejection accepted — closing run…",
        loading: true,
        source: "optimistic",
        token: currentToken,
      });
      applyRunState({ status: "rejected", updated_at: new Date().toISOString() });
      showToast({ message: "Run rejected.", persist: false });
      stopPolling();
      await startPolling();
    } catch (err) {
      showToast({ kind: "error", message: err.message || "Failed to reject." });
      approvePublishBtn.disabled = false;
      rejectPublishBtn.disabled = false;
      setHeaderOverride(null);
    } finally {
      setButtonLoading(rejectPublishBtn, false);
    }
  });

  const resetRun = () => {
    clearActiveRun();
    stopPolling();
    hideToast();
    setHeaderOverride(null);
    clearLocalActivity(null);
    lastRemoteActivity = [];
    if (resultBody) resultBody.innerHTML = "";
    if (briefInput) briefInput.value = "";
    if (ideationComment) ideationComment.value = "";
    if (publishComment) publishComment.value = "";
    history.replaceState({}, "", window.location.pathname);
    applyRunState({ status: "idle" });
    setActivePanel("begin");
    setStepperProgress("begin");
  };

  newRunBtn?.addEventListener("click", resetRun);
  topNewRunBtn?.addEventListener("click", resetRun);

  refreshNowBtn?.addEventListener("click", async () => {
    setButtonLoading(refreshNowBtn, true, "Refreshing…");
    await pollStatus();
    setButtonLoading(refreshNowBtn, false);
  });

  refreshRunsBtn?.addEventListener("click", async (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    setButtonLoading(refreshRunsBtn, true, "Refreshing…");
    const runs = loadRuns();
    if (!runs.length) {
      renderRuns(runs);
      setButtonLoading(refreshRunsBtn, false);
      return;
    }
    for (const run of runs.slice(0, 20)) {
      try {
        const resp = await fetchApi(`/v1/public/demo/runs/${run.token}`);
        if (!resp.ok) continue;
        const data = await resp.json();
        upsertRun(run.token, {
          status: data.status,
          updated_at: data.updated_at,
          published_url: data.published_url || null,
          brief: data.brief || run.brief,
        });
      } catch {
        continue;
      }
    }
    renderRuns(loadRuns());
    setButtonLoading(refreshRunsBtn, false);
  });

  runsList?.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset.action === "view" && target.dataset.token) {
      const token = target.dataset.token;
      stopPolling();
      activateRun(token);
      const shareUrl = `${window.location.origin}${window.location.pathname}?run=${token}`;
      history.replaceState({}, "", shareUrl);
      setHeaderOverride({ label: "Loading run", timeText: "Loading run…", loading: true });
      showToast({ message: "Loading run…", persist: true });
      recordLocalEvent(token, { message: "Loading run…", type: "ui" });
      renderActivity(mergeActivity(lastRemoteActivity));
      renderMiniActivity(mergeActivity(lastRemoteActivity));
      await startPolling();
      setHeaderOverride(null);
    }
  });

  const urlParams = new URLSearchParams(window.location.search);
  const initialToken = urlParams.get("run") || localStorage.getItem(activeRunKey);
  if (initialToken) {
    activateRun(initialToken);
    const known = loadRuns().find((run) => run.token === initialToken);
    applyRunState({ status: "pending", brief: known?.brief });
    startPolling();
  } else {
    applyRunState({ status: "idle" });
    setActivePanel("begin");
    setStepperProgress("begin");
  }

  renderRuns(loadRuns());

  if (runsDetails instanceof HTMLDetailsElement) {
    const storageKey = "myloware_demo_runs_open";
    const stored = localStorage.getItem(storageKey);
    if (stored === "true") runsDetails.open = true;
    if (stored === "false") runsDetails.open = false;
    if (stored === null && window.innerWidth <= 960) runsDetails.open = false;
    runsDetails.addEventListener("toggle", () => {
      localStorage.setItem(storageKey, runsDetails.open ? "true" : "false");
    });
  }

  window.addEventListener("resize", () => {
    updateStepperLine();
  });

  stepperEl?.addEventListener("scroll", () => {
    updateStepperLine();
  });
})();
