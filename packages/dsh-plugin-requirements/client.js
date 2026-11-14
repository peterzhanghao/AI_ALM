window.__ModuleLoader__.load({
  id: "@ai-alm/dsh-plugin-requirements",
  factory(require2) {
    const React = require2("react");
    const h = React.createElement;
    const { useState, useEffect, useCallback, useRef } = React;
    const ROOT_KEY = "alm.requirements.root";
    const PROJECT_KEY = "alm.requirements.project";
    const ALL_PROJECTS = "ALL";
    const REDUCE_MOTION = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false;
    const T = {
      text: "var(--dsw-alias-label-primary, #f2f4f7)",
      text2: "var(--dsw-alias-label-secondary, #9aa3ae)",
      text3: "var(--dsw-alias-label-secondary, #929ba7)",
      line: "var(--dsw-alias-border-l1, #232830)",
      line2: "var(--dsw-alias-border-l2, #2e343d)",
      layer: "var(--dsw-alias-bg-layer-1, #14171c)",
      layer2: "var(--dsw-alias-bg-layer-2, #171b21)",
      base: "var(--dsw-alias-bg-base, #0f1115)",
      brand: "var(--dsw-alias-brand-primary, #4d6bfe)",
      ok: "color-mix(in srgb, var(--dsw-alias-label-secondary, #9aa3ae) 90%, var(--dsw-alias-state-success-primary, #35c47a))",
      warn: "color-mix(in srgb, var(--dsw-alias-label-secondary, #9aa3ae) 90%, var(--dsw-alias-state-warn-primary, #e7b04b))",
      err: "color-mix(in srgb, var(--dsw-alias-label-secondary, #9aa3ae) 80%, var(--dsw-alias-state-error-primary, #ff8b8b))"
    };
    const STATUS = {
      proposed: { label: "\u5F85\u8BC4\u5BA1", color: T.text2, bg: "rgba(154,163,174,.14)" },
      accepted: { label: "\u5DF2\u91C7\u7EB3", color: T.brand, bg: "rgba(77,107,254,.12)" },
      "in-progress": { label: "\u5F00\u53D1\u4E2D", color: T.warn, bg: "rgba(231,176,75,.14)" },
      implemented: { label: "\u5DF2\u5B9E\u73B0", color: T.brand, bg: "rgba(77,107,254,.10)" },
      verified: { label: "\u5DF2\u9A8C\u8BC1", color: T.ok, bg: "rgba(53,196,122,.14)" },
      deprecated: { label: "\u5DF2\u5E9F\u5F03", color: T.text3, bg: "rgba(107,116,128,.12)" },
      superseded: { label: "\u88AB\u66FF\u4EE3", color: T.text3, bg: "rgba(107,116,128,.12)" },
      archived: { label: "\u5DF2\u5F52\u6863", color: T.text3, bg: "rgba(107,116,128,.12)" }
    };
    const DEFAULT_REQUIREMENT_VIEW = "mine";
    const NAVIGATION_VERSION = 5;
    const FILTERS = [
      ["all", "\u5168\u90E8"],
      ["mine", "\u5F85\u6211\u5904\u7406"],
      ["pending", "\u5F85\u63A8\u8FDB"],
      ["running", "AI \u63A8\u8FDB\u4E2D"],
      ["awaiting", "\u5F85\u9A8C\u6536"],
      ["accepted", "\u5DF2\u9A8C\u6536"],
      ["closed", "\u5DF2\u5173\u95ED"],
      ["anomalies", "\u6570\u636E\u5F02\u5E38"]
    ];
    const SOURCE_FILTERS = [
      ["all", "\u5168\u90E8"],
      ["manual", "\u624B\u52A8\u521B\u5EFA"],
      ["chat", "\u5BF9\u8BDD\u751F\u6210"],
      ["defect", "\u7F3A\u9677"],
      ["feedback", "\u53CD\u9988"]
    ];
    const DEFECT_LABELS = {
      "awaiting-confirmation": "\u5F85\u786E\u8BA4",
      confirmed: "\u5DF2\u786E\u8BA4",
      fixing: "\u4FEE\u590D\u4E2D",
      verifying: "\u9A8C\u8BC1\u4E2D",
      "awaiting-acceptance": "\u5F85\u9A8C\u6536",
      closed: "\u5DF2\u5173\u95ED",
      deferred: "\u5DF2\u6682\u7F13",
      ignored: "\u5DF2\u5FFD\u7565",
      failed: "\u8FED\u4EE3\u5931\u8D25"
    };
    const DEFECT_STAGE_LABELS = { clarify: "\u6F84\u6E05", review: "\u8BC4\u5BA1", develop: "\u5F00\u53D1", test: "\u6D4B\u8BD5", handoff: "\u4EA4\u63A5" };
    const DEFECT_SEVERITY_TONE = { P0: T.err, P1: T.warn, P2: T.text2, P3: T.text3 };
    const DEFECT_SEEN_KEY = "alm.requirements.defectSeen";
    function isDefect(item) {
      return (item?.sources ?? []).includes("defect");
    }
    function defectOf(item) {
      const view = item?.defect;
      if (!view || view.exists === false) return null;
      return view.defect && typeof view.defect === "object" ? view.defect : view;
    }
    function defectRecord(value) {
      const defect = defectOf(value);
      if (defect) return defect;
      return String(value?.id ?? "").startsWith("DEF-") ? value : null;
    }
    function defectStatusLabel(item, defect) {
      const label = item?.defect?.statusLabel ?? defect?.statusLabel;
      if (label) return label;
      const status = defect?.status ?? item?.defect?.status ?? null;
      return status ? DEFECT_LABELS[status] ?? status : "\u5F85\u786E\u8BA4";
    }
    function defectTone(item, defect) {
      const status = defect?.status ?? item?.defect?.status ?? null;
      if (status === "awaiting-confirmation" || status === "deferred") return { color: T.warn, bg: "rgba(231,176,75,.14)" };
      if (status === "failed") return { color: T.err, bg: "rgba(255,139,139,.14)" };
      if (status === "closed" || status === "ignored") return { color: T.text3, bg: "rgba(107,116,128,.12)" };
      return { color: T.brand, bg: "rgba(77,107,254,.12)" };
    }
    function defectStageText(item) {
      const defect = defectRecord(item);
      const stage = defect?.impact?.stage ?? null;
      if (stage) return DEFECT_STAGE_LABELS[stage] ?? String(stage);
      const kind = defect?.source?.kind ?? null;
      if (kind === "failure-monitor") return "\u5931\u8D25\u76D1\u63A7";
      return "\u6765\u6E90\uFF1A\u5931\u8D25\u76D1\u63A7";
    }
    function defectAwaitingConfirmation(item) {
      const status = defectRecord(item)?.status ?? null;
      return status === "awaiting-confirmation" || status === "deferred";
    }
    function isFeedbackSource(item) {
      return Array.isArray(item?.sources) && item.sources.includes("feedback");
    }
    function isChatSource(item) {
      return Boolean(item?.sourceSession) || (item?.sources ?? []).includes("chat");
    }
    function matchesSource(item, source) {
      if (source === "defect") return isDefect(item);
      if (source === "feedback") return isFeedbackSource(item);
      if (source === "chat") return isChatSource(item) && !isDefect(item);
      if (source === "manual") return !isDefect(item) && !isFeedbackSource(item) && !isChatSource(item);
      return true;
    }
    const FEEDBACK_CATEGORIES = [
      ["undetermined", "\u5F85\u5224\u65AD"],
      ["defect", "\u7F3A\u9677"],
      ["experience", "\u4F53\u9A8C"],
      ["capability", "\u65B0\u80FD\u529B"]
    ];
    const FEEDBACK_STATUS = {
      saved: { label: "\u5F85\u8DEF\u7531", tone: "warn" },
      "needs-routing": { label: "\u5F85\u8DEF\u7531", tone: "warn" },
      routed: { label: "\u5DF2\u8DEF\u7531", tone: "brand" },
      "requirement-created": { label: "\u5DF2\u8F6C\u9700\u6C42", tone: "ok" },
      failed: { label: "\u5931\u8D25", tone: "err" },
      ignored: { label: "\u5DF2\u5FFD\u7565", tone: "neutral" }
    };
    const FEEDBACK_TONES = {
      warn: { color: T.warn, bg: "rgba(231,176,75,.14)" },
      brand: { color: T.brand, bg: "rgba(77,107,254,.12)" },
      ok: { color: T.ok, bg: "rgba(53,196,122,.14)" },
      err: { color: T.err, bg: "rgba(255,139,139,.14)" },
      neutral: { color: T.text3, bg: "rgba(107,116,128,.12)" }
    };
    const FEEDBACK_PRIORITIES = ["P0", "P1", "P2"];
    const FEEDBACK_ATTACHMENT_TYPES = ["image/png", "image/jpeg", "image/webp", "text/plain", "text/markdown", "application/json"];
    const FEEDBACK_ATTACHMENT_MAX_BYTES = 2 * 1024 * 1024;
    const FEEDBACK_MAX_STATEMENT = 4e3;
    const FEEDBACK_CLIENT_BUILD = "feedback-v2/2026-11-03.1";
    const FEEDBACK_KEEP_LABELS = [
      ["requirement", "\u5F53\u524D\u9700\u6C42"],
      ["run", "\u6700\u8FD1\u8FD0\u884C"],
      ["intent", "\u610F\u56FE\u4F1A\u8BDD"],
      ["error", "\u6700\u8FD1\u9519\u8BEF"]
    ];
    const FEEDBACK_COVERAGE_STAGES = [
      ["intent", "\u610F\u56FE"],
      ["review", "\u8BC4\u5BA1"],
      ["run", "\u8FD0\u884C"],
      ["test", "\u6D4B\u8BD5"],
      ["acceptance", "\u9A8C\u6536"],
      ["list", "\u5217\u8868"],
      ["detail", "\u8BE6\u60C5"]
    ];
    const FEEDBACK_PAGE_LABELS = { list: "\u9700\u6C42\u5217\u8868", detail: "\u9700\u6C42\u8BE6\u60C5" };
    const FEEDBACK_DRAFTS = /* @__PURE__ */ new Map();
    const emptyFeedbackDraft = () => ({
      statement: "",
      category: "undetermined",
      keep: { requirement: true, run: true, intent: true, error: true },
      requestId: null,
      supplementRequestId: null,
      savedId: null,
      savedStatement: null,
      attachments: []
    });
    function feedbackDraftKey(context) {
      const workspace = String(context?.workspaceId ?? context?.projectId ?? "local");
      if (context?.requirementId) {
        return `${workspace}|requirement:${context.requirementId}|revision:${context.requirementRevision ?? 1}`;
      }
      return `${workspace}|page:${context?.page ?? "list"}|stage:${context?.stage ?? "none"}`;
    }
    function feedbackDraftFor(context) {
      const key = feedbackDraftKey(context);
      if (!FEEDBACK_DRAFTS.has(key)) FEEDBACK_DRAFTS.set(key, emptyFeedbackDraft());
      return FEEDBACK_DRAFTS.get(key);
    }
    let FEEDBACK_LAUNCHER = null;
    function showFeedbackLaunchFailure(message) {
      if (typeof document === "undefined") return;
      const node = document.createElement("div");
      node.setAttribute("data-feedback-toast", "warn");
      node.setAttribute("role", "status");
      node.textContent = message;
      Object.assign(node.style, {
        position: "fixed",
        left: "50%",
        bottom: "28px",
        transform: "translateX(-50%)",
        zIndex: "2147483000",
        maxWidth: "min(520px, 92vw)",
        padding: "10px 16px",
        borderRadius: "10px",
        border: `1px solid ${T.warn}`,
        background: T.base,
        color: T.text,
        fontSize: "13px",
        lineHeight: "1.6",
        boxShadow: "0 12px 32px rgba(0,0,0,.45)"
      });
      document.body.appendChild(node);
      setTimeout(() => {
        node.remove();
      }, 4200);
    }
    function launchFeedbackFromLayer(overlay) {
      if (typeof FEEDBACK_LAUNCHER !== "function") {
        showFeedbackLaunchFailure("\u53CD\u9988\u9762\u677F\u8FD8\u6CA1\u6709\u5C31\u7EEA\uFF0C\u672C\u6B21\u70B9\u51FB\u6CA1\u6709\u6253\u5F00\uFF1B\u8BF7\u5237\u65B0\u9875\u9762\u540E\u91CD\u8BD5\u3002");
        return false;
      }
      try {
        FEEDBACK_LAUNCHER(overlay);
        return true;
      } catch (error) {
        console.error("[requirements] feedback launcher failed", error);
        showFeedbackLaunchFailure("\u53CD\u9988\u9762\u677F\u6253\u5F00\u5931\u8D25\uFF1B\u8BF7\u91CD\u8BD5\uFF0C\u82E5\u6301\u7EED\u5931\u8D25\u8BF7\u5237\u65B0\u9875\u9762\u3002");
        return false;
      }
    }
    function feedbackLayerOpen() {
      return typeof document !== "undefined" && Boolean(document.querySelector('[data-feedback-layer="true"]'));
    }
    const FEEDBACK_ERROR_HINTS = {
      "statement-required": "\u8BF7\u5148\u5199\u4E0B\u54EA\u91CC\u4E0D\u987A\u6216\u5E0C\u671B\u600E\u6837\u6539\u53D8\u3002",
      "statement-too-long": `\u53CD\u9988\u6700\u591A ${FEEDBACK_MAX_STATEMENT} \u5B57\uFF0C\u8BF7\u7CBE\u7B80\u540E\u518D\u4FDD\u5B58\u3002`,
      "priority-required": "\u8BF7\u5148\u9009\u62E9\u4F18\u5148\u7EA7 P0/P1/P2\uFF08\u4E0D\u731C\u4F18\u5148\u7EA7\uFF09\u3002",
      "destination-not-configured": "\u5C1A\u672A\u8F6C\u4E3A\u9700\u6C42\uFF1A\u672A\u914D\u7F6E\u63A5\u6536\u5DE5\u4F5C\u533A",
      "destination-not-writable": "\u5C1A\u672A\u8F6C\u4E3A\u9700\u6C42\uFF1A\u63A5\u6536\u5DE5\u4F5C\u533A\u4E0D\u53EF\u5199",
      "idempotency-conflict": "\u8FD9\u6761\u53CD\u9988\u5DF2\u7ECF\u4FDD\u5B58\u8FC7\uFF0C\u4F46\u5185\u5BB9\u6216\u73B0\u573A\u4E0E\u4E0A\u6B21\u4E0D\u540C\uFF1B\u8BF7\u5237\u65B0\u6536\u4EF6\u7BB1\u540E\u91CD\u65B0\u63D0\u4EA4\uFF0C\u6216\u628A\u65B0\u4FE1\u606F\u4F5C\u4E3A\u8865\u5145\u63D0\u4EA4\u3002",
      "feedback-link-failed": "\u9700\u6C42\u5DF2\u521B\u5EFA\uFF0C\u4F46\u5173\u8054\u56DE\u53CD\u9988\u5931\u8D25\uFF1B\u91CD\u8BD5\u4F1A\u590D\u7528\u540C\u4E00\u6761\u9700\u6C42\uFF0C\u4E0D\u4F1A\u91CD\u590D\u521B\u5EFA\u3002",
      "proposal-unconfirmed": "\u5019\u9009\u8FD8\u6CA1\u786E\u8BA4\uFF1B\u786E\u8BA4\u5019\u9009\u540E\u624D\u80FD\u8F6C\u6210\u9700\u6C42\u3002"
    };
    function feedbackErrorView(error) {
      const hint = error && typeof error.code === "string" ? FEEDBACK_ERROR_HINTS[error.code] : null;
      return hint ? { code: error.code, message: hint } : error;
    }
    function feedbackStatusKey(status) {
      return String(status ?? "").replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
    }
    function feedbackStatusMeta(status) {
      const key = feedbackStatusKey(status);
      return FEEDBACK_STATUS[key] ?? { label: key || "\u672A\u77E5", tone: "neutral" };
    }
    function feedbackStatusBadge(status) {
      const meta = feedbackStatusMeta(status);
      const tone = FEEDBACK_TONES[meta.tone] ?? FEEDBACK_TONES.neutral;
      return h(
        "span",
        {
          "data-feedback-status": status ?? "",
          style: {
            display: "inline-flex",
            alignItems: "center",
            padding: "1px 8px",
            borderRadius: 999,
            fontSize: 11,
            color: tone.color,
            background: tone.bg,
            whiteSpace: "nowrap"
          }
        },
        meta.label
      );
    }
    function feedbackCategoryLabel(category) {
      const hit = FEEDBACK_CATEGORIES.find(([id]) => id === category);
      return hit ? hit[1] : "\u5F85\u5224\u65AD";
    }
    function feedbackRequirementId(requirement) {
      if (!requirement) return null;
      if (typeof requirement === "string") return requirement;
      return requirement.id ?? requirement.requirementId ?? null;
    }
    function feedbackCountsOf(payload) {
      const counts = payload?.counts ?? payload?.inbox?.counts ?? null;
      if (counts) {
        return {
          pending: (counts.saved ?? 0) + (counts.needsRouting ?? counts["needs-routing"] ?? 0),
          requirementCreated: counts.requirementCreated ?? counts["requirement-created"] ?? 0
        };
      }
      const items = Array.isArray(payload?.items) ? payload.items : [];
      let pending = 0;
      let created = 0;
      for (const item of items) {
        const key = feedbackStatusKey(item.status);
        if (key === "saved" || key === "needs-routing") pending += 1;
        if (key === "requirement-created") created += 1;
      }
      return { pending, requirementCreated: created };
    }
    function feedbackChipStyle(on, disabled = false) {
      return {
        border: `1px solid ${on ? "rgba(77,107,254,.5)" : T.line}`,
        background: on ? "rgba(77,107,254,.12)" : "transparent",
        color: disabled ? T.text3 : on ? T.text : T.text2,
        borderRadius: 999,
        padding: "4px 11px",
        fontSize: 11.5,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1
      };
    }
    function feedbackWorkspaceValue(workspace) {
      return workspace?.workspaceId ?? workspace?.id ?? null;
    }
    function feedbackWorkspaceLabel(workspace) {
      const name = workspace?.name ?? workspace?.title ?? workspace?.id ?? "\u672A\u547D\u540D\u5DE5\u4F5C\u533A";
      const linked = workspace?.linked === true ? "\u5DF2\u5173\u8054\u9879\u76EE" : "\u672A\u5173\u8054\u9879\u76EE";
      return workspace?.writable === false ? `${name} \xB7 ${linked} \xB7 \u4E0D\u53EF\u5199` : `${name} \xB7 ${linked}`;
    }
    function feedbackMaskPaths(value) {
      if (!value) return null;
      return String(value).replace(/[A-Za-z]:[\\/][^\s，。;；、)）\]]*/g, "[\u8DEF\u5F84\u5DF2\u9690\u85CF]");
    }
    function feedbackGet(action, root, extra = "") {
      const query = `root=${encodeURIComponent(root)}&action=${encodeURIComponent(action)}${extra ? `&${extra}` : ""}`;
      return fetch(`/api/alm/requirements/feedback?${query}`, {
        headers: { accept: "application/json" },
        cache: "no-store"
      }).then(async (response) => {
        let payload = null;
        try {
          payload = await response.json();
        } catch {
          payload = null;
        }
        if (!response.ok || payload && payload.ok === false) {
          const info = payload?.error ?? {};
          const error = new Error(info.message ?? `\u52A0\u8F7D\u53CD\u9988\u6570\u636E\u5931\u8D25\uFF08HTTP ${response.status}\uFF09`);
          error.code = info.code ?? `http-${response.status}`;
          error.status = response.status;
          error.payload = payload;
          throw error;
        }
        return payload ?? {};
      });
    }
    function feedbackPost(action, body, root) {
      return postJson("requirements/feedback", { ...body, action }, root);
    }
    function readSeenDefectFingerprints() {
      if (typeof localStorage === "undefined") return /* @__PURE__ */ new Set();
      try {
        const raw = JSON.parse(localStorage.getItem(DEFECT_SEEN_KEY) ?? "[]");
        return new Set(Array.isArray(raw) ? raw.filter((value) => typeof value === "string" && value) : []);
      } catch {
        return /* @__PURE__ */ new Set();
      }
    }
    function rememberDefectFingerprints(fingerprints) {
      if (typeof localStorage === "undefined") return;
      try {
        const seen = readSeenDefectFingerprints();
        for (const value of fingerprints) if (typeof value === "string" && value) seen.add(value);
        localStorage.setItem(DEFECT_SEEN_KEY, JSON.stringify([...seen].slice(-200)));
      } catch {
      }
    }
    function defectListOf(payload) {
      const value = payload?.defects ?? payload?.items ?? payload?.list ?? payload?.result?.defects ?? null;
      return Array.isArray(value) ? value : [];
    }
    function defectSummaryOf(payload) {
      const value = payload?.summary ?? payload?.defectSummary ?? payload?.result?.summary ?? payload;
      if (!value || typeof value !== "object") return null;
      if (value.awaitingConfirmation === void 0 && value.total === void 0) return null;
      return value;
    }
    function defectOfResponse(payload) {
      return payload?.defect ?? payload?.result?.defect ?? null;
    }
    function defectExecutionOf(payload) {
      return payload?.execution ?? payload?.result?.execution ?? null;
    }
    const DELIVERY_TONE = {
      pending: { color: T.text2, bg: "rgba(154,163,174,.14)" },
      "in-progress": { color: T.warn, bg: "rgba(231,176,75,.14)" },
      "awaiting-acceptance": { color: T.brand, bg: "rgba(77,107,254,.12)" },
      accepted: { color: T.ok, bg: "rgba(53,196,122,.14)" },
      closed: { color: T.text3, bg: "rgba(107,116,128,.12)" }
    };
    function deliveryOf(item) {
      const delivery = item?.delivery;
      if (delivery?.key) return delivery;
      if (item?.closed === true) return { key: "closed", label: "\u5DF2\u5173\u95ED" };
      return { key: "pending", label: "\u5F85\u63A8\u8FDB" };
    }
    function deliveryTone(item) {
      return DELIVERY_TONE[deliveryOf(item).key] ?? DELIVERY_TONE.pending;
    }
    function needsHuman(item) {
      if (deliveryOf(item).key !== "closed" && (item?.pendingPatch || item?.detailView?.question || item?.currentMatter?.kind === "decision" || item?.detailView?.currentMatter?.kind === "decision" || item?.run?.awaitingAnswer)) return true;
      if (typeof item?.requiresHuman === "boolean") return item.requiresHuman;
      if (typeof item?.detailView?.currentMatter?.requiresHuman === "boolean") return item.detailView.currentMatter.requiresHuman;
      const delivery = deliveryOf(item);
      const state = item?.decision?.state;
      if (delivery.key === "closed") return false;
      const defectStatus = item?.defect?.defect?.requirement === item?.id ? item?.defect?.status : null;
      if (defectStatus === "awaiting-confirmation" || defectStatus === "verifying" || defectStatus === "failed") return true;
      if (delivery.key === "awaiting-acceptance") return true;
      return state === "blocked" || state === "needs-clarification";
    }
    function isExecutingRequirement(item) {
      const run = item?.detailView?.summaries?.run ?? item?.run;
      return run?.exists === true && run.active === true && run.stale !== true && run.idleHandback !== true && run.awaitingAnswer !== true && (run.status === "running" || run.status === "queued");
    }
    function matchesView(item, view) {
      if (view === "anomalies") return (item.anomalies?.length ?? 0) > 0;
      if (view === "pending") return deliveryOf(item).key === "pending";
      if (view === "all") return true;
      if (view === "mine") return needsHuman(item);
      if (view === "running") return deliveryOf(item).key === "in-progress";
      if (view === "awaiting") return deliveryOf(item).key === "awaiting-acceptance";
      if (view === "accepted") return deliveryOf(item).key === "accepted";
      if (view === "closed") return deliveryOf(item).key === "closed";
      return true;
    }
    const REL_LABELS = {
      satisfies: "\u6EE1\u8DB3",
      allocated_to: "\u5206\u914D\u5230",
      depends_on: "\u4F9D\u8D56",
      constrained_by: "\u7EA6\u675F",
      verified_by: "\u9A8C\u6536",
      supersedes: "\u66FF\u4EE3",
      parent_of: "\u5B50\u9700\u6C42"
    };
    const VERDICT = {
      pass: { label: "\u901A\u8FC7", color: T.ok, bg: "rgba(53,196,122,.12)" },
      warn: { label: "\u6709\u5EFA\u8BAE", color: T.warn, bg: "rgba(231,176,75,.14)" },
      block: { label: "\u963B\u585E", color: T.err, bg: "rgba(255,139,139,.14)" },
      skip: { label: "\u672A\u8986\u76D6", color: T.text3, bg: "rgba(107,116,128,.12)" }
    };
    const EVIDENCE_TONE = {
      neutral: { color: T.text2, bg: "rgba(154,163,174,.14)" },
      error: { color: T.err, bg: "rgba(255,139,139,.14)" },
      warn: { color: T.warn, bg: "rgba(231,176,75,.14)" },
      success: { color: T.ok, bg: "rgba(53,196,122,.14)" }
    };
    const DECISION_LABELS = {
      unchecked: "\u672A\u68C0\u67E5",
      "needs-clarification": "\u9700\u6F84\u6E05",
      blocked: "\u963B\u585E",
      failed: "\u6267\u884C\u5931\u8D25",
      stale: "\u8BC1\u636E\u8FC7\u671F",
      "ready-for-human": "\u5F85\u9A8C\u6536",
      verified: "\u5DF2\u9A8C\u6536",
      archived: "\u5DF2\u5F52\u6863"
    };
    const ANOMALY_LABELS = {
      "duplicate-id": "\u9700\u6C42 ID \u91CD\u590D",
      "duplicate-business-id": "\u4E1A\u52A1 ID \u91CD\u590D",
      "dangling-relation": "\u60AC\u7A7A\u5173\u7CFB"
    };
    const REHEARSAL_FIELDS = [
      ["title", "\u6807\u9898"],
      ["priority", "\u4F18\u5148\u7EA7"],
      ["brief", "\u80CC\u666F"]
    ];
    function decisionTone(decision) {
      return EVIDENCE_TONE[decision?.tone] ?? EVIDENCE_TONE.neutral;
    }
    function decisionLabel(decision) {
      if (!decision) return null;
      return decision.label ?? DECISION_LABELS[decision.state] ?? decision.state ?? "\u672A\u77E5";
    }
    function decisionPillStyle(decision) {
      const tone = decisionTone(decision);
      return {
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        fontSize: "11.5px",
        padding: "2px 9px",
        borderRadius: "999px",
        color: tone.color,
        background: tone.bg,
        whiteSpace: "nowrap"
      };
    }
    function stateIsGreen(decision) {
      return decision?.state === "ready-for-human" || decision?.state === "verified";
    }
    function gapSeverityMeta(severity) {
      if (severity === "block") return { label: "\u963B\u585E", color: T.err, bg: "rgba(255,139,139,.14)" };
      if (severity === "warn") return { label: "\u5EFA\u8BAE", color: T.warn, bg: "rgba(231,176,75,.14)" };
      return { label: "\u63D0\u793A", color: T.text3, bg: "rgba(107,116,128,.12)" };
    }
    function readableError(message) {
      const text = String(message ?? "").trim();
      if (!text) return "\u672A\u77E5\u9519\u8BEF\uFF0C\u8BF7\u91CD\u8BD5\u3002";
      const notFound = text.match(/root not found:\s*(.+)$/i);
      if (notFound) return "\u627E\u4E0D\u5230\u5DE5\u4F5C\u533A\u76EE\u5F55\uFF1A" + notFound[1] + "\uFF08\u53EF\u5728\u300C\u66F4\u591A \u2192 \u6307\u5B9A\u6839\u76EE\u5F55\u300D\u91CD\u65B0\u9009\u62E9\uFF09";
      if (/not a git repository/i.test(text)) return "\u8BE5\u76EE\u5F55\u4E0D\u662F git \u4ED3\u5E93\uFF0C\u65E0\u6CD5\u8BFB\u53D6\u9700\u6C42\u7248\u672C\u3002";
      if (/EACCES|EPERM/i.test(text)) return "\u6CA1\u6709\u6743\u9650\u8BFB\u53D6\u8BE5\u76EE\u5F55\u3002";
      if (/ENOENT/i.test(text)) return "\u76EE\u5F55\u6216\u6587\u4EF6\u4E0D\u5B58\u5728\uFF1A" + text;
      return text;
    }
    function shortHash(value, size = 12) {
      return value ? String(value).slice(0, size) : "\u2014";
    }
    function formatLocalStamp(iso) {
      if (!iso) return "\u2014";
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return String(iso);
      const pad = (value) => String(value).padStart(2, "0");
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    }
    const panel = {
      padding: "0 30px",
      width: "100%",
      margin: 0,
      color: T.text,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
      boxSizing: "border-box",
      height: "100vh",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden"
    };
    const listArea = { flex: "1 1 auto", minHeight: "200px", display: "flex", flexDirection: "column", paddingBottom: "30px" };
    const listScroller = {
      flex: "1 1 auto",
      minHeight: 0,
      overflowY: "auto",
      overflowX: "hidden",
      border: `1px solid ${T.line}`,
      borderRadius: "12px",
      background: T.layer,
      overscrollBehavior: "contain",
      scrollbarGutter: "stable"
    };
    const muted = { color: T.text2, fontSize: "12px" };
    const button = {
      border: `1px solid ${T.line}`,
      background: T.layer,
      color: T.text,
      borderRadius: "8px",
      padding: "5px 11px",
      fontSize: "12px",
      cursor: "pointer"
    };
    const primary = { ...button, background: T.text, color: T.base, borderColor: "transparent" };
    const primaryState = (disabled) => disabled ? { ...button, color: T.text2, cursor: "not-allowed" } : primary;
    const input = {
      border: `1px solid ${T.line}`,
      background: T.layer,
      color: T.text,
      borderRadius: "8px",
      padding: "5px 9px",
      fontSize: "12px",
      minWidth: "220px"
    };
    const card = {
      border: `1px solid ${T.line}`,
      borderRadius: "12px",
      background: T.layer,
      padding: "16px 18px",
      marginBottom: "10px",
      cursor: "pointer"
    };
    const sectionTitle = {
      margin: "22px 0 8px",
      fontSize: "11px",
      letterSpacing: ".08em",
      textTransform: "uppercase",
      color: T.text3,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "8px"
    };
    const rowLabel = { color: T.text3, fontSize: "11.5px", width: "70px", flex: "none" };
    const row = { display: "flex", alignItems: "center", gap: "10px", padding: "7px 0", fontSize: "12.5px", color: T.text2, borderBottom: `1px solid ${T.line}` };
    function statusMeta(status) {
      return STATUS[status] ?? { label: status, color: T.text2, bg: "rgba(154,163,174,.14)" };
    }
    function Pill({ status, label }) {
      const meta = statusMeta(status);
      return h(
        "span",
        {
          style: {
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "11.5px",
            padding: "2px 9px",
            borderRadius: "999px",
            color: meta.color,
            background: meta.bg
          }
        },
        h("span", { style: { width: "5px", height: "5px", borderRadius: "50%", background: "currentColor" } }),
        label ?? meta.label
      );
    }
    function DeliveryPill({ item }) {
      const delivery = deliveryOf(item);
      const tone = deliveryTone(item);
      const title = delivery.reason ? `\u5F85\u63A8\u8FDB\uFF1A${delivery.reason}` : delivery.label ?? delivery.key;
      return h(
        "span",
        {
          "data-delivery": delivery.key,
          "data-delivery-source": delivery.source ?? null,
          title,
          "aria-label": title,
          style: {
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "12px",
            padding: "2px 0",
            borderRadius: "4px",
            color: tone.color,
            background: "transparent",
            whiteSpace: "nowrap"
          }
        },
        h("span", { style: { width: "5px", height: "5px", borderRadius: "50%", background: "currentColor" } }),
        delivery.label ?? delivery.key
      );
    }
    function DefectPill() {
      return h(
        "span",
        {
          "data-defect-pill": "true",
          style: {
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            flex: "none",
            lineHeight: "16px",
            fontSize: "11px",
            padding: "1px 7px",
            borderRadius: "999px",
            color: T.warn,
            background: "rgba(231,176,75,.14)",
            border: "1px solid rgba(231,176,75,.28)",
            whiteSpace: "nowrap"
          }
        },
        h(ActionIcon, { name: "alert", size: 10 }),
        "\u7F3A\u9677"
      );
    }
    function DefectStatusPill({ item, defect, prefix = null }) {
      const record = defect ?? defectRecord(item);
      const tone = defectTone(item, record);
      return h(
        "span",
        {
          "data-defect-status": record?.status ?? "unknown",
          style: {
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "11.5px",
            padding: "2px 9px",
            borderRadius: "999px",
            color: tone.color,
            background: tone.bg,
            whiteSpace: "nowrap"
          }
        },
        h("span", { style: { width: "5px", height: "5px", borderRadius: "50%", background: "currentColor" } }),
        prefix ? `${prefix} \xB7 ${defectStatusLabel(item, record)}` : defectStatusLabel(item, record)
      );
    }
    function Chip({ children }) {
      return h(
        "span",
        {
          style: {
            fontSize: "11px",
            color: T.text2,
            border: `1px solid ${T.line}`,
            borderRadius: "999px",
            padding: "2px 8px"
          }
        },
        children
      );
    }
    function DecisionPill({ decision }) {
      return h(
        "span",
        { style: decisionPillStyle(decision) },
        h("span", { style: { width: "5px", height: "5px", borderRadius: "50%", background: "currentColor", flex: "none" } }),
        decisionLabel(decision)
      );
    }
    function riskText(decision) {
      const risk = decision?.policy?.risk;
      if (risk === "high") return "\u98CE\u9669\u9AD8";
      if (risk === "low") return "\u98CE\u9669\u4F4E";
      if (risk === "normal") return "\u98CE\u9669\u4E2D";
      return null;
    }
    function acceptanceLine(item) {
      const acceptance = item?.acceptance;
      if (!acceptance?.registered) return { text: "\u5F85\u8865\u5145\u9A8C\u6536\u65B9\u5F0F", color: T.warn };
      const latest = acceptance.latest;
      if (!latest) return { text: "\u5F85\u5F00\u59CB\u9A8C\u8BC1", color: T.warn };
      if (latest.result !== "pass") return { text: `\u9A8C\u6536\u5931\u8D25 \xB7 ${shortHash(latest.headSha, 8)}`, color: T.err };
      if (latest.current !== true || latest.complete === false) return { text: "\u5386\u53F2\u901A\u8FC7 \xB7 \u9700\u91CD\u8DD1", color: T.warn };
      return { text: "\u9A8C\u6536\u901A\u8FC7 \xB7 \u5F53\u524D\u7248\u672C", color: T.ok };
    }
    function coverageText(_decision, item) {
      return item ? acceptanceLine(item).text : "";
    }
    function primaryActionFor(item, decision, actions = {}) {
      const delivery = deliveryOf(item);
      if (delivery.key === "closed") return null;
      if (delivery.key === "awaiting-acceptance") {
        return { label: "\u9A8C\u6536\u4EA4\u4ED8", icon: "check", variant: "primary", onClick: () => actions.onSignoff?.(item) };
      }
      if (delivery.key === "accepted") return null;
      if (delivery.key === "in-progress") {
        return { label: "\u63A8\u8FDB\u4E2D", icon: "refresh", variant: "ghost", onClick: () => actions.onRefresh?.() };
      }
      if (delivery.key === "pending" && item?.run?.exists && item.run.stale === true && actions.onResumeRun) {
        return { label: "\u6062\u590D\u63A8\u8FDB", icon: "play", variant: "primary", onClick: () => actions.onResumeRun(item, item.run) };
      }
      if (delivery.key === "pending" && item?.run?.exists && item.run.awaitingAnswer === true && actions.onAnswer) {
        return { label: "\u56DE\u7B54\u5E76\u7EE7\u7EED", icon: "message", variant: "accent", onClick: () => actions.onAnswer(item, item.run) };
      }
      if (delivery.key === "pending" && item?.run?.exists && item.run.idleHandback === true && actions.onStart) {
        return { label: "\u7EE7\u7EED\u63A8\u8FDB", icon: "play", variant: "primary", onClick: () => actions.onStart(item) };
      }
      if (!decision) return null;
      const code = decision.topGap?.code ?? "";
      if (decision.state === "blocked" || decision.state === "needs-clarification") {
        return { label: "\u67E5\u770B\u5E76\u5904\u7406\u95EE\u9898", icon: "alert", variant: "accent", onClick: () => actions.onOpen?.(item) };
      }
      if (code === "review-not-run" || code === "review-not-accepted" || code === "coverage-incomplete") {
        return { label: "\u7EE7\u7EED\u63A8\u8FDB", icon: "play", variant: "primary", onClick: () => actions.onStart?.(item) };
      }
      if (code === "acceptance-missing" || code === "acceptance-not-run" || decision.state === "failed" || decision.state === "stale") {
        return { label: "\u8FD0\u884C\u9A8C\u6536", icon: "flask", variant: "accent", onClick: () => actions.onAcceptance?.(item) };
      }
      return { label: "\u4EA4\u7ED9 AI \u63A8\u8FDB", icon: "play", variant: "primary", onClick: () => actions.onStart?.(item) };
    }
    function DecisionBar({ decision, item, actions }) {
      if (!decision) return null;
      const gap = decision.topGap;
      const tone = decisionTone(decision);
      const risk = riskText(decision);
      const coverage = coverageText(decision, item);
      const action = primaryActionFor(item, decision, actions);
      const extra = Math.max(0, (decision.gaps?.length ?? 0) - (gap ? 1 : 0));
      return h(
        "section",
        {
          "data-decision-state": decision.state,
          "aria-label": `\u8BC1\u636E\u7ED3\u8BBA\uFF1A${decision.label}`,
          style: {
            background: T.layer2,
            border: `1px solid ${T.line2}`,
            borderLeft: `3px solid ${tone.color}`,
            borderRadius: "10px",
            padding: "11px 14px",
            marginBottom: "12px"
          }
        },
        h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } },
          h(DecisionPill, { decision }),
          risk ? h("span", { style: { fontSize: "11.5px", color: T.text3 } }, risk) : null,
          coverage ? h("span", { style: { fontSize: "11.5px", color: T.text3 } }, coverage) : null,
          action ? h("div", { style: { marginLeft: "auto" } }, h(ActionButton, { label: action.label, icon: action.icon, variant: action.variant, onClick: action.onClick })) : null
        ),
        gap ? h(
          "p",
          { style: { margin: "8px 0 0", fontSize: "12.5px", lineHeight: 1.7, color: T.text2 } },
          h("span", { style: { color: tone.color, fontWeight: 600 } }, gap.severity === "block" ? "\u963B\u585E " : "\u7F3A\u53E3 "),
          h(
            "code",
            { style: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "11.5px", color: T.text2, marginRight: "2px" } },
            gap.code
          ),
          " \xB7 ",
          gap.message,
          gap.fix ? h("span", { style: { color: T.text3 } }, `\u3000\u4FEE\u590D\uFF1A${gap.fix}`) : null,
          extra ? h("span", { style: { color: T.text3 } }, `\u3000\u53E6\u6709 ${extra} \u9879\u89C1\u4E0B\u65B9`) : null
        ) : h("p", { style: { margin: "8px 0 0", fontSize: "12.5px", color: T.ok } }, "\u5FC5\u9700\u8BC1\u636E\u5DF2\u6EE1\u8DB3\uFF0C\u53EF\u4EE5\u8FDB\u5165\u4E0B\u4E00\u6B65\u3002")
      );
    }
    function CurrentStateStrip({ item, actions }) {
      const delivery = deliveryOf(item);
      const decision = item?.decision ?? null;
      const candidate = item?.candidate ?? null;
      const next = item?.nextActionLabel ?? null;
      const human = needsHuman(item);
      const run = item?.run ?? null;
      const lastActivity = run?.lastActivityAt ? formatLocalStamp(run.lastActivityAt) : null;
      const runBusy = run?.active === true;
      const runWaiting = run?.awaitingAnswer === true || run?.awaitingAnswer === void 0 && run?.status === "waiting-input" && Boolean(run?.decision);
      const runIdleHandback = run?.idleHandback === true || run?.awaitingAnswer === void 0 && run?.status === "waiting-input" && !run?.decision;
      const runStale = run?.stale === true;
      const runLabel = run?.exists ? runStale ? `\u5DF2\u4E2D\u65AD${lastActivity ? `\uFF08\u6700\u540E\u6D3B\u52A8 ${lastActivity}\uFF09` : ""}` : runWaiting ? `\u7B49\u5F85\u56DE\u7B54${lastActivity ? `\uFF08${lastActivity}\uFF09` : ""}` : `${run.label}${run.phase ? ` \xB7 ${run.phase}` : ""}${lastActivity ? `\uFF08${lastActivity}\uFF09` : ""}${run.failure?.message ? ` \xB7 ${run.failure.message}` : ""}` : null;
      const decideNow = runStale ? "\u672C\u8F6E\u63A8\u8FDB\u5DF2\u4E2D\u65AD\uFF1A\u6062\u590D\u63A8\u8FDB\u6216\u53D6\u6D88" : human ? next ?? "\u9A8C\u6536" : runWaiting ? "\u56DE\u7B54\u51B3\u7B56\u8BF7\u6C42" : runIdleHandback ? "\u67E5\u770B\u672C\u8F6E\u7ED3\u679C\u5E76\u51B3\u5B9A\u4E0B\u4E00\u6B65" : runBusy ? "\u65E0\uFF08AI \u63A8\u8FDB\u4E2D\uFF09" : delivery.key === "accepted" ? "\u53D1\u5E03\u51B3\u5B9A" : "\u65E0";
      const rows = [
        ["\u4EA4\u4ED8\u72B6\u6001", delivery.label],
        ["AI \u5F53\u524D\u52A8\u4F5C", runLabel ? `${runLabel}\uFF08${decision?.label ?? "\u672A\u68C0\u67E5"}\uFF09` : decision?.label ?? "\u672A\u68C0\u67E5"],
        [
          "\u4EA4\u4ED8\u5019\u9009",
          candidate?.exists ? candidate.current ? `\u5F53\u524D \xB7 ${shortHash(candidate.treeHash, 8)}` : `\u5DF2\u8FC7\u671F \xB7 ${(candidate.reasons ?? []).join("\u3001") || "\u9700\u91CD\u65B0\u751F\u6210"}` : "\u5C1A\u672A\u751F\u6210"
        ],
        ["\u5F85\u4F60\u51B3\u5B9A", decideNow]
      ];
      if (delivery.reason) rows.push(["\u4E2D\u65AD\u539F\u56E0", delivery.reason]);
      const runActions = run?.exists && (runBusy || runWaiting || runStale) ? h(
        "div",
        { key: "run-actions", style: { display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "2px" } },
        runStale && actions?.onResumeRun ? h(
          "button",
          {
            key: "resume-run",
            title: "\u4E0A\u4E00\u8F6E\u63A8\u8FDB\u5DF2\u4E2D\u65AD\uFF08\u5FC3\u8DF3\u505C\u6B62\uFF09\uFF1A\u4ECE\u4E2D\u65AD\u5904\u7EE7\u7EED\uFF0C\u4E0D\u4F1A\u91CD\u505A\u5DF2\u5B8C\u6210\u5DE5\u4F5C",
            style: { ...button, fontSize: "11.5px", padding: "2px 8px", borderColor: "transparent", background: T.ok, color: T.base },
            onClick: () => actions.onResumeRun(item, run)
          },
          "\u6062\u590D\u63A8\u8FDB"
        ) : null,
        runWaiting && actions?.onAnswer ? h(
          "button",
          {
            key: "answer-run",
            title: "AI \u6B63\u5728\u7B49\u4F60\u56DE\u7B54\u51B3\u7B56\u8BF7\u6C42\uFF1A\u56DE\u7B54\u540E\u4F1A\u987A\u7740\u539F\u4F1A\u8BDD\u7EE7\u7EED\u63A8\u8FDB",
            style: { ...button, fontSize: "11.5px", padding: "2px 8px", borderColor: "transparent", background: T.warn, color: T.base },
            onClick: () => actions.onAnswer(item, run)
          },
          "\u56DE\u7B54\u5E76\u7EE7\u7EED"
        ) : null,
        (runBusy || runWaiting) && actions?.onCancelRun ? h("button", { key: "cancel-run", style: { ...button, marginTop: "0px", fontSize: "11.5px", padding: "2px 8px" }, onClick: () => actions.onCancelRun(item, run) }, "\u53D6\u6D88\u63A8\u8FDB") : null
      ) : null;
      return h(
        "section",
        {
          "aria-label": "\u5F53\u524D\u72B6\u6001\u4E0E\u5F85\u4F60\u51B3\u5B9A",
          "data-delivery": delivery.key,
          style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "10px", border: `1px solid ${T.line}`, borderRadius: "10px", background: T.layer, padding: "10px 12px", marginBottom: "12px" }
        },
        rows.map(
          ([label, value], index) => h(
            "div",
            { key: label, style: { minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" } },
            h("span", { style: { fontSize: "10.5px", color: T.text3, letterSpacing: ".02em" } }, label),
            h("span", { style: { fontSize: "12.5px", color: index === 3 && human ? T.warn : runStale && index === 1 ? T.err : T.text, fontWeight: index === 3 && human ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis" } }, value),
            index === 1 ? runActions : null
          )
        )
      );
    }
    function GapDetail({ gap, index }) {
      const severity = gapSeverityMeta(gap.severity ?? (gap.rule ? "block" : "info"));
      const rule = gap.rule ?? gap.code ?? "GAP";
      const fileLine = gap.file ? `${gap.file}${gap.line ? `:${gap.line}` : ""}` : null;
      return h(
        "details",
        { style: { borderTop: index === 0 ? "none" : `1px solid ${T.line}` } },
        h(
          "summary",
          { style: { cursor: "pointer", padding: "7px 0", fontSize: "12.5px", color: T.text2, lineHeight: 1.6 } },
          h(
            "span",
            { style: { display: "inline-block", marginRight: "7px", fontSize: "10.5px", padding: "1px 6px", borderRadius: "5px", color: severity.color, background: severity.bg } },
            severity.label
          ),
          h("code", { style: { color: T.text, marginRight: "7px" } }, rule),
          fileLine ? h("span", { style: { color: T.text3, marginRight: "7px" } }, fileLine) : null,
          gap.message
        ),
        h(
          "div",
          { style: { padding: "0 0 9px 12px", fontSize: "12px", lineHeight: 1.85, color: T.text2 } },
          h("div", null, h("span", { style: { color: T.text3 } }, "\u539F\u56E0\uFF1A"), gap.message),
          h("div", null, h("span", { style: { color: T.text3 } }, "\u4FEE\u590D\u5EFA\u8BAE\uFF1A"), gap.fix ?? "\u6309\u89C4\u5219\u4FEE\u590D\u540E\u91CD\u65B0\u8FD0\u884C\u68C0\u67E5\u3002"),
          h("div", null, h("span", { style: { color: T.text3 } }, "\u6765\u6E90\uFF1A"), gap.rule ? "\u95E8\u7981 check" : "\u8BC1\u636E\u5224\u5B9A"),
          gap.project ? h("div", null, h("span", { style: { color: T.text3 } }, "\u9879\u76EE\uFF1A"), gap.project) : null
        )
      );
    }
    function GapsList({ decision }) {
      const gaps = decision?.gaps ?? [];
      if (!decision) {
        return h("p", { style: { margin: 0, ...muted } }, "\u51B3\u7B56\u6570\u636E\u5C1A\u672A\u8FD4\u56DE\uFF1B\u6682\u6309\u539F\u59CB\u8BC4\u5BA1\u4E0E\u9A8C\u6536\u6570\u636E\u5C55\u793A\u3002");
      }
      if (gaps.length === 0) return h("p", { style: { margin: 0, ...muted } }, "\u6CA1\u6709\u672A\u89E3\u51B3\u7684\u8BC1\u636E\u7F3A\u53E3\u3002");
      return h(
        "div",
        { style: { border: `1px solid ${T.line}`, borderRadius: "10px", padding: "2px 12px" } },
        gaps.map((gap, index) => h(GapDetail, { key: `${gap.code ?? "gap"}-${index}`, gap, index }))
      );
    }
    function AcceptanceProvenance({ latest }) {
      if (!latest) return null;
      const environment = latest.environment ? [latest.environment.platform, latest.environment.arch, latest.environment.node ? `node ${latest.environment.node}` : null, latest.environment.runner].filter(Boolean).join(" \xB7 ") : "\u2014";
      const rows = [
        ["\u9700\u6C42\u4FEE\u8BA2", shortHash(latest.requirementHash)],
        ["\u5B9E\u73B0\u63D0\u4EA4", shortHash(latest.headSha, 12)],
        ["\u6D4B\u8BD5\u4FEE\u8BA2", shortHash(latest.testRevision)],
        ["\u73AF\u5883", environment],
        ["\u65F6\u95F4", latest.finishedAt ? formatLocalStamp(latest.finishedAt) : "\u2014"],
        ["\u6765\u6E90", latest.source ?? "\u2014"]
      ];
      return h(
        "div",
        { style: { marginTop: "8px" } },
        latest.complete === false ? h(
          "p",
          { style: { margin: "0 0 6px", color: T.warn, fontSize: "12px" } },
          `\u6765\u6E90\u6216\u7248\u672C\u4E0D\u5B8C\u6574${latest.missing?.length ? `\uFF08\u7F3A\u5C11\uFF1A${latest.missing.join("\u3001")}\uFF09` : ""}`
        ) : null,
        h(
          "div",
          { style: { border: `1px solid ${T.line}`, borderRadius: "10px", padding: "2px 12px" } },
          rows.map(
            ([label, value], index) => h(
              "div",
              { key: label, style: { ...row, fontSize: "12px", borderBottom: index === rows.length - 1 ? "none" : `1px solid ${T.line}` } },
              h("span", { style: rowLabel }, label),
              h("span", { style: { color: T.text, fontSize: "12px", wordBreak: "break-all", minWidth: 0 } }, value)
            )
          )
        )
      );
    }
    function AnomalyBlock({ anomalies, summary, onOpen }) {
      const list = anomalies ?? [];
      if (list.length === 0) return null;
      const counts = summary ?? {};
      const summaryLabel = [
        counts.duplicateId ? `ID \u91CD\u590D ${counts.duplicateId}` : null,
        counts.duplicateBusinessId ? `\u4E1A\u52A1 ID \u91CD\u590D ${counts.duplicateBusinessId}` : null,
        counts.dangling ? `\u60AC\u7A7A\u5173\u7CFB ${counts.dangling}` : null
      ].filter(Boolean).join(" \xB7 ");
      return h(
        "section",
        { style: { marginTop: "28px", border: `1px solid ${T.line}`, borderLeft: `3px solid ${T.err}`, borderRadius: "12px", background: T.layer, padding: "14px 16px" } },
        h(
          "div",
          { style: { display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" } },
          h("h3", { style: { margin: 0, fontSize: "13.5px", fontWeight: 600, color: T.text } }, `\u6570\u636E\u5F02\u5E38\uFF08${list.length}\uFF09`),
          summaryLabel ? h("span", { style: muted }, summaryLabel) : null
        ),
        h(
          "p",
          { style: { margin: "6px 0 10px", fontSize: "12.5px", color: T.text2, lineHeight: 1.8 } },
          "\u8FD9\u4E9B\u8BB0\u5F55\u4E0D\u4F1A\u81EA\u52A8\u4FEE\u590D\uFF1A\u4FDD\u7559\u4E24\u6761\u8BB0\u5F55\u3001\u4E0D\u81EA\u52A8\u5408\u5E76\uFF1B\u70B9\u51FB\u6761\u76EE\u6253\u5F00\u5BF9\u5E94\u9700\u6C42\u540E\u4EBA\u5DE5\u6838\u5BF9\u3002"
        ),
        h(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: "8px" } },
          list.map(
            (anomaly, index) => h(
              "div",
              { key: `${anomaly.kind}-${index}`, style: { border: `1px solid ${T.line}`, borderRadius: "10px", padding: "9px 11px" } },
              h(
                "div",
                { style: { display: "flex", gap: "8px", alignItems: "baseline", flexWrap: "wrap", fontSize: "12.5px", color: T.text2 } },
                h("span", { style: { color: T.err, fontSize: "11px", border: `1px solid ${T.line2}`, borderRadius: "5px", padding: "0 6px" } }, ANOMALY_LABELS[anomaly.kind] ?? anomaly.kind),
                anomaly.message
              ),
              anomaly.occurrences?.length ? h(
                "div",
                { style: { display: "flex", flexDirection: "column", gap: "3px", marginTop: "6px" } },
                anomaly.occurrences.map(
                  (occurrence, occurrenceIndex) => h(
                    "button",
                    {
                      type: "button",
                      key: `${occurrence.occurrenceKey ?? occurrenceIndex}-${occurrenceIndex}`,
                      title: "\u6253\u5F00\u5BF9\u5E94\u9700\u6C42",
                      onClick: () => onOpen?.(occurrence),
                      style: { display: "flex", gap: "8px", alignItems: "baseline", flexWrap: "wrap", textAlign: "left", border: 0, background: "transparent", color: T.text2, padding: "2px 0", fontSize: "12px", cursor: "pointer" }
                    },
                    h("code", { style: { color: T.brand } }, occurrence.assetId ?? occurrence.id ?? occurrence.occurrenceKey ?? "\u2014"),
                    occurrence.title ? h("span", null, occurrence.title) : null,
                    h(
                      "span",
                      { style: { color: T.text3 } },
                      `${occurrence.file ?? anomaly.file ?? "\u2014"}${occurrence.line ?? anomaly.line ? `:${occurrence.line ?? anomaly.line}` : ""}`
                    )
                  )
                )
              ) : h(
                "button",
                {
                  type: "button",
                  onClick: () => onOpen?.({ assetId: anomaly.requirementIds?.[0], file: anomaly.file, line: anomaly.line }),
                  style: { marginTop: "4px", border: 0, background: "transparent", color: T.brand, padding: 0, fontSize: "12px", cursor: "pointer" }
                },
                `${anomaly.ref ?? anomaly.file ?? "\u2014"}${anomaly.line ? `:${anomaly.line}` : ""} \xB7 \u6253\u5F00\u9700\u6C42`
              )
            )
          )
        )
      );
    }
    const EMPTY_ANSWER_HINT = "\u8BF7\u4E3A\u6BCF\u4E2A\u4E1A\u52A1\u95EE\u9898\u9009\u62E9\u4E00\u9879\uFF0C\u65E0\u9700\u586B\u5199\u8865\u5145\u8BF4\u660E\u3002";
    function DecisionFormShell({ inline, title, lead, footer, children, ...props }) {
      if (!inline) return h(ModalShell, { title, lead, footer, ...props }, children);
      return h(
        "section",
        { "data-inline-decision": "true", "aria-label": "\u9700\u8981\u4F60\u51B3\u5B9A", style: { minWidth: 0 } },
        h("p", { style: { color: T.text2, fontSize: "13px", margin: "0 0 12px" } }, "\u9700\u8981\u4F60\u51B3\u5B9A"),
        lead ? h("p", { style: { color: T.text2, fontSize: "13px", lineHeight: 1.7, margin: "0 0 16px" } }, lead) : null,
        children,
        h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "16px" } }, footer?.filter((entry) => entry?.key !== "close"))
      );
    }
    function RejectCandidateControl({ item, root, onDone }) {
      const review = item.rejectionReview;
      const [open, setOpen] = useState(false);
      const [openedReview, setOpenedReview] = useState(null);
      const [text, setText] = useState("");
      const [saving, setSaving] = useState(false);
      const [error, setError] = useState(null);
      if ((!review?.allowed || !review.binding) && !open) return null;
      const binding = openedReview?.binding ?? review.binding;
      const submit = async () => {
        if (!text.trim() || saving) return;
        setSaving(true);
        setError(null);
        try {
          const result = await writeJson("run", { mode: "reject-candidate", requirementId: item.id, answer: text.trim(), expectedReview: binding }, root);
          if (result?.resumed !== true) throw new Error(result?.message ?? "\u672A\u9000\u56DE\u4FEE\u6539\uFF0C\u8BF7\u91CD\u65B0\u8BFB\u53D6\u5F53\u524D\u72B6\u6001");
          setOpen(false);
          setText("");
          await onDone?.();
        } catch (failure) {
          setError(failure.message);
        } finally {
          setSaving(false);
        }
      };
      return h(
        "section",
        { "data-reject-candidate": "true", style: { padding: "12px 20px" } },
        h("button", { type: "button", style: button, disabled: !review?.allowed, onClick: () => {
          setOpenedReview(review);
          setOpen(true);
          setError(null);
        } }, "\u9000\u56DE\u4FEE\u6539"),
        open ? h(
          ModalShell,
          {
            title: "\u9000\u56DE\u4FEE\u6539",
            lead: `\u539F\u8FD0\u884C ${binding.runId} \xB7 \u5019\u9009 ${binding.candidateId}`,
            onClose: () => {
              if (!saving) setOpen(false);
            },
            footer: [
              h("button", { key: "close", type: "button", disabled: saving, onClick: () => setOpen(false) }, "\u53D6\u6D88"),
              h("button", { key: "submit", type: "button", disabled: saving || !text.trim(), onClick: submit }, saving ? "\u6B63\u5728\u63D0\u4EA4\u2026" : "\u9000\u56DE\u4FEE\u6539\u5E76\u7EE7\u7EED\u539F\u8FD0\u884C")
            ]
          },
          !review?.allowed ? h("p", { role: "alert" }, "\u5F53\u524D\u5BA1\u9605\u72B6\u6001\u5DF2\u53D8\u5316\uFF1B\u53CD\u9988\u8349\u7A3F\u4FDD\u7559\uFF0C\u63D0\u4EA4\u5C06\u7531\u5BBF\u4E3B\u91CD\u65B0\u6821\u9A8C\u3002\u8BF7\u5173\u95ED\u5E76\u91CD\u65B0\u8BFB\u53D6\u540E\u64CD\u4F5C\u3002") : null,
          h("p", null, openedReview?.stale ? "\u4F60\u6B63\u5728\u9000\u56DE\u6B64\u524D\u5019\u9009\uFF1B\u5DE5\u4F5C\u533A\u5DF2\u53D8\u5316\uFF0C\u4FEE\u590D\u540E\u5FC5\u987B\u91CD\u65B0\u9A8C\u8BC1\u3002\u65E7\u5019\u9009\u4E0E\u68C0\u67E5\u8BB0\u5F55\u4FDD\u7559\u3002" : "\u53CD\u9988\u5C06\u4EA4\u56DE\u539F\u8FD0\u884C\uFF1B\u4E0D\u6269\u5927\u539F\u6388\u6743\u6216\u6267\u884C\u9884\u7B97\uFF0C\u4E0D\u4EE3\u8868\u7B7E\u6536\u3002"),
          h("label", null, "\u5B9E\u9645\u5931\u8D25\u4E0E\u4FEE\u6539\u53CD\u9988", h("textarea", { "aria-label": "\u5B9E\u9645\u5931\u8D25\u4E0E\u4FEE\u6539\u53CD\u9988", value: text, disabled: saving, onChange: (event) => setText(event.target.value), rows: 6 })),
          error ? h("p", { role: "alert" }, `${error}\u3002\u53CD\u9988\u8349\u7A3F\u5DF2\u4FDD\u7559\uFF1B\u5BA1\u9605\u5BF9\u8C61\u53D8\u5316\u65F6\u8BF7\u5173\u95ED\u5E76\u91CD\u65B0\u8BFB\u53D6\u3002`) : null
        ) : null
      );
    }
    function AnswerRunModal(props) {
      return h(DecisionForm, props);
    }
    function DecisionForm({ item, root, onClose, onDone, inline = false, onDirty, primaryActionId = null }) {
      const run = item.run ?? null;
      const [answer, setAnswer] = useState("");
      const [selections, setSelections] = useState({});
      const submitting = useRef(false);
      const [state, setState] = useState({ loading: true, decision: null, text: null, presentation: null, error: null, saving: false, result: null });
      const presentation = state.presentation;
      const decisions = presentation?.decisions ?? [];
      const selectable = presentation?.selectable === true;
      const technicalOnly = presentation?.technicalOnly === true;
      const pickedCount = decisions.filter((decision) => decision.options.some((option) => option.key === selections[decision.id])).length;
      const choicesReady = selectable && pickedCount === decisions.length;
      const identityReady = Boolean(state.decisionIdentity?.path && state.decisionIdentity?.contentHash);
      const canSubmit = !state.loading && !state.result && identityReady && (technicalOnly || choicesReady || !selectable);
      const [reloadDecision, setReloadDecision] = useState(0);
      useEffect(() => {
        onDirty?.(!state.result && (answer.trim() !== "" || Object.keys(selections).length > 0));
      }, [answer, selections, state.result]);
      useEffect(() => {
        let alive = true;
        setState((previous) => ({ ...previous, loading: true, error: null }));
        writeJson("run", { mode: "decision", requirementId: item.id }, root).then((result) => {
          if (!alive) return;
          setSelections({});
          setState({ loading: false, decision: result.decision ?? null, decisionIdentity: result.decisionIdentity ?? null, text: result.text ?? null, presentation: result.presentation ?? null, error: null, saving: false, result: null });
        }).catch((error) => {
          if (!alive) return;
          setState({ loading: false, decision: null, text: null, error: error.message, saving: false, result: null });
        });
        return () => {
          alive = false;
        };
      }, [item.id, root, item.run?.id, reloadDecision, item.run?.decisionIdentity?.contentHash, item.detailView?.question?.identity?.contentHash]);
      useEffect(() => {
        setAnswer("");
        setSelections({});
      }, [item.id, root, item.run?.id]);
      useEffect(() => {
        setAnswer("");
        setSelections({});
      }, [state.decisionIdentity?.contentHash]);
      const submit = (action = "choose") => {
        if (state.loading || state.saving || state.result || submitting.current) return;
        if (action === "choose" && !choicesReady) {
          setState((prev) => ({ ...prev, error: EMPTY_ANSWER_HINT }));
          const field = document.querySelector('[data-decision-choice="true"]:not(:checked)');
          if (field && typeof field.focus === "function") field.focus();
          return;
        }
        if (!identityReady) {
          setState((prev) => ({ ...prev, error: "\u5F53\u524D\u95EE\u9898\u4E0D\u53EF\u8BFB\u6216\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u8BFB\u53D6\u540E\u9009\u62E9\u3002" }));
          return;
        }
        submitting.current = true;
        setState((prev) => ({ ...prev, saving: true, error: null }));
        writeJson("run", { mode: "answer", requirementId: item.id, decisionResponse: { action, selections: action === "choose" ? selections : {}, note: answer.trim() }, expectedDecision: state.decisionIdentity }, root).then((result) => {
          if (result?.resumed === false) throw new Error(result.message ?? "\u8FD0\u884C\u5C1A\u672A\u6062\u590D\uFF0C\u8BF7\u5237\u65B0\u540E\u68C0\u67E5\u5F53\u524D\u72B6\u6001");
          if (result?.autoAdvanceResumed === false) window.alert(`\u5DF2\u7EE7\u7EED\u672C\u8F6E\uFF0C\u4F46\u81EA\u52A8\u63A8\u8FDB\u672A\u6062\u590D\uFF08${result.autoAdvanceReason}\uFF09\u3002\u9700\u5728\u539F\u751F\u754C\u9762\u68C0\u67E5\u7248\u672C\u4E0E\u6267\u884C\u9884\u7B97\uFF1B\u672A\u65B0\u589E\u6388\u6743\u3002`);
          setState((prev) => ({ ...prev, saving: false, result, submittedAction: action }));
          onDone?.();
        }).catch((error) => setState((prev) => ({ ...prev, saving: false, error: error.message }))).finally(() => {
          submitting.current = false;
        });
      };
      return h(
        DecisionFormShell,
        {
          inline,
          title: `\u4E1A\u52A1\u4E0E\u529F\u80FD\u51B3\u7B56 \xB7 ${item.id}`,
          lead: "\u4F60\u51B3\u5B9A\u4E1A\u52A1\u89C4\u5219\u4E0E\u529F\u80FD\u884C\u4E3A\uFF0CAI \u8D1F\u8D23\u6280\u672F\u5B9E\u73B0\u3002\u9009\u62E9\u65B9\u6848\u5373\u53EF\u7EE7\u7EED\uFF0C\u63A8\u8350\u9879\u4E0D\u4F1A\u81EA\u52A8\u9009\u4E2D\u3002",
          onClose,
          feedbackContext: feedbackContextFor(item),
          width: "780px",
          footer: [
            h("button", { key: "close", style: state.result ? primary : button, onClick: onClose }, "\u5173\u95ED"),
            state.result ? null : h(
              "button",
              {
                key: "answer",
                style: canSubmit && !state.saving ? primary : { ...primary, opacity: 0.45, cursor: "not-allowed" },
                disabled: state.saving || state.loading || !identityReady,
                title: canSubmit ? "\u7EE7\u7EED\u540C\u4E00\u8FD0\u884C" : "\u8BF7\u5B8C\u6210\u6BCF\u4E00\u9053\u4E1A\u52A1\u95EE\u9898\u7684\u9009\u62E9",
                "aria-describedby": !canSubmit ? "answer-run-hint" : void 0,
                onClick: () => submit(technicalOnly ? "delegate" : selectable ? "choose" : "reframe"),
                "data-primary-action": primaryActionId || void 0
              },
              state.saving ? "\u63D0\u4EA4\u4E2D\u2026" : technicalOnly ? "\u4EA4\u56DE AI \u81EA\u4E3B\u5904\u7406" : selectable ? "\u786E\u8BA4\u9009\u62E9\u5E76\u7EE7\u7EED" : "\u8BF7 AI \u6574\u7406\u4E1A\u52A1\u9009\u9879"
            )
          ]
        },
        selectable ? h("p", { style: { color: T.text2, fontSize: "12px", margin: "0 0 12px" }, role: "status" }, `\u5DF2\u9009\u62E9 ${pickedCount} / ${decisions.length} \u9879`) : null,
        presentation?.context?.length ? h("ul", null, ...presentation.context.map((line, index) => h("li", { key: index }, line))) : null,
        selectable ? decisions.map((decision) => h(
          "fieldset",
          {
            key: decision.id,
            style: { border: 0, borderBottom: `1px solid ${T.line}`, margin: "0 0 20px", padding: "0 0 20px", minWidth: 0 }
          },
          h("legend", { style: { fontSize: "17px", fontWeight: 650, lineHeight: 1.6, marginBottom: "8px", overflowWrap: "anywhere" } }, decision.title || decision.question),
          decision.question && decision.question !== decision.title ? h("p", { style: { color: T.text2, fontSize: "13px", lineHeight: 1.7 } }, decision.question) : null,
          decision.why ? h("p", null, decision.why) : null,
          ...decision.options.map((option) => h(
            "label",
            { key: option.key, "data-decision-option": option.key, style: { display: "flex", alignItems: "flex-start", gap: "12px", margin: "8px 0", padding: "14px", border: `1px solid ${selections[decision.id] === option.key ? T.brand : T.line}`, borderRadius: "8px", background: selections[decision.id] === option.key ? T.layer2 : T.layer, cursor: "pointer", overflowWrap: "anywhere" } },
            h("input", {
              type: "radio",
              name: `decision-${decision.id}`,
              value: option.key,
              checked: selections[decision.id] === option.key,
              disabled: state.saving || Boolean(state.result),
              "data-decision-choice": "true",
              style: { accentColor: T.brand, margin: "4px 0 0", flexShrink: 0 },
              onChange: () => {
                setSelections((prev) => ({ ...prev, [decision.id]: option.key }));
                setState((prev) => ({ ...prev, error: null }));
              }
            }),
            h(
              "span",
              { style: { minWidth: 0 } },
              h("strong", { style: { fontSize: "14px", lineHeight: 1.7 } }, option.label),
              option.recommended ? h("span", { style: { color: T.brand, fontSize: "11px", marginLeft: "8px" } }, "AI \u63A8\u8350") : null,
              h("span", { style: { display: "block", marginTop: "4px", color: T.text2, fontSize: "12px", lineHeight: 1.7 } }, `\u5F71\u54CD\uFF1A${option.impact}`)
            )
          )),
          decision.recommendation?.reason ? h("p", { style: { color: T.text2, fontSize: "12px", lineHeight: 1.7 } }, `\u63A8\u8350\u7406\u7531\uFF1A${decision.recommendation.reason}`) : null
        )) : h("p", { role: "status", style: { lineHeight: 1.8 } }, state.loading ? "\u6B63\u5728\u8BFB\u53D6\u5F85\u51B3\u4E8B\u9879\u2026" : technicalOnly ? "\u8FD9\u4EFD\u8BF7\u6C42\u6D89\u53CA\u6280\u672F\u5B9E\u73B0\uFF0C\u65E0\u9700\u4F60\u6311\u9009\u6280\u672F\u65B9\u6848\u3002\u4EA4\u56DE\u540E\uFF0CAI \u5C06\u5728\u73B0\u6709\u9700\u6C42\u8303\u56F4\u5185\u5904\u7406\u5E76\u9A8C\u8BC1\u3002" : presentation?.authorizationDecisions?.length ? "\u8FD9\u4EFD\u8BF7\u6C42\u5305\u542B\u9700\u4E13\u9879\u6388\u6743\u7684\u4E8B\u9879\u3002\u8BF7 AI \u5206\u5F00\u6574\u7406\u4E1A\u52A1\u9009\u62E9\u4E0E\u6388\u6743\u8BF7\u6C42\uFF1B\u672C\u9875\u4E0D\u4F1A\u6269\u5927\u6743\u9650\u6216\u6279\u51C6\u53D1\u5E03\u3002" : "\u5F53\u524D\u95EE\u9898\u8FD8\u6CA1\u6709\u6E05\u6670\u7684\u4E1A\u52A1\u9009\u9879\u3002\u8BF7\u8BA9 AI \u5148\u6574\u7406\uFF0C\u4F60\u65E0\u9700\u7F16\u5199\u6280\u672F\u6307\u4EE4\u3002"),
        presentation?.technicalDecisions?.length && !technicalOnly ? h("p", { "data-ai-owned-decisions": "true", style: { color: T.text2, fontSize: "12px", lineHeight: 1.8 } }, "\u6280\u672F\u5B9E\u73B0\u4EA4\u7531 AI \u5904\u7406\uFF0C\u65E0\u9700\u4F60\u9009\u62E9\u5177\u4F53\u65B9\u6848\u3002") : null,
        selectable && !state.result ? h("button", { type: "button", style: { ...button, marginBottom: "12px" }, disabled: state.saving || !identityReady, onClick: () => submit("reframe") }, "\u8FD9\u4E9B\u9009\u9879\u4E0D\u5408\u9002\uFF0C\u8BF7 AI \u91CD\u65B0\u6574\u7406") : null,
        !state.loading && !state.result ? h("details", { "data-decision-note": "true", style: { marginTop: "12px" } }, h("summary", { style: { color: T.text2, cursor: "pointer", fontSize: "12px" } }, "\u8865\u5145\u4E1A\u52A1\u8BF4\u660E\uFF08\u9009\u586B\uFF09"), h(
          "label",
          { style: { display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: T.text2, marginTop: "12px" } },
          "\u8865\u5145\u4F60\u5E0C\u671B\u4FDD\u7559\u7684\u4E1A\u52A1\u89C4\u5219\u6216\u529F\u80FD\u7EA6\u675F",
          h("textarea", {
            style: { ...input, width: "100%", minHeight: "110px", resize: "vertical", fontFamily: "inherit", lineHeight: 1.7 },
            value: answer,
            name: "decision-answer",
            autoComplete: "off",
            "aria-label": "\u8865\u5145\u4F60\u5E0C\u671B\u4FDD\u7559\u7684\u4E1A\u52A1\u89C4\u5219\u6216\u529F\u80FD\u7EA6\u675F",
            onChange: (event) => {
              const next = event.target.value;
              setAnswer(next);
              setState((prev) => prev.error === EMPTY_ANSWER_HINT ? { ...prev, error: null } : prev);
            },
            "data-answer-run-input": "true",
            maxLength: 4e3,
            placeholder: "\u4F8B\u5982\uFF1A\u4FDD\u7559\u73B0\u6709\u5BFC\u822A\uFF0C\u9ED8\u8BA4\u53EA\u663E\u793A\u5F85\u5904\u7406\u9700\u6C42\u3002",
            disabled: state.saving || Boolean(state.result)
          })
        )) : null,
        !canSubmit && !state.result ? h("p", { id: "answer-run-hint", style: { margin: "6px 0 0", fontSize: "11.5px", color: T.text3 } }, !identityReady && !state.loading ? "\u8BF7\u91CD\u65B0\u8BFB\u53D6\u5F53\u524D\u95EE\u9898\uFF0C\u672A\u8BFB\u53D6\u6210\u529F\u4E0D\u4F1A\u7EE7\u7EED\u6267\u884C\u3002" : "\u6BCF\u4E2A\u95EE\u9898\u9009\u62E9\u4E00\u9879\u540E\u5373\u53EF\u63D0\u4EA4\uFF0C\u65E0\u9700\u586B\u5199\u8865\u5145\u8BF4\u660E\u3002") : null,
        state.error ? h("div", { role: "alert", tabIndex: -1, ref: state.error === EMPTY_ANSWER_HINT ? null : (node) => node?.focus?.({ preventScroll: true }), style: { margin: "10px 0 0", color: T.err, fontSize: "13px" } }, state.error, h("button", { type: "button", style: button, onClick: () => {
          setState((prev) => ({ ...prev, loading: true }));
          setReloadDecision((value) => value + 1);
        } }, "\u91CD\u65B0\u8BFB\u53D6\u95EE\u9898")) : null,
        state.result ? h(
          "div",
          { style: { marginTop: "12px" } },
          h("p", { role: "status" }, state.submittedAction === "reframe" ? "\u5DF2\u8BF7 AI \u6574\u7406\u4E1A\u52A1\u9009\u9879\uFF0C\u5C1A\u672A\u4F5C\u51FA\u4E1A\u52A1\u51B3\u5B9A\u3002" : state.submittedAction === "delegate" ? "\u6280\u672F\u4E8B\u9879\u5DF2\u4EA4\u56DE AI\uFF0C\u5728\u73B0\u6709\u6388\u6743\u8303\u56F4\u5185\u7EE7\u7EED\u5904\u7406\u3002" : "\u4F60\u7684\u51B3\u5B9A\u5DF2\u63D0\u4EA4\uFF0CAI \u5C06\u6309\u4F60\u7684\u9009\u62E9\u7EE7\u7EED\u63A8\u8FDB\u3002"),
          state.result.message ? h("p", { style: { margin: "4px 0 0", fontSize: "12.5px", color: T.text2 } }, state.result.message) : null,
          h(
            "details",
            null,
            h("summary", null, "\u63D0\u4EA4\u8BE6\u60C5\uFF08\u53EF\u9009\u67E5\u770B\uFF09"),
            h(PlanRows, {
              rows: [
                ["\u7ED3\u679C", state.result.message ?? "\u5DF2\u7EE7\u7EED\u63A8\u8FDB"],
                ["\u8FD0\u884C", state.result.runId ?? "\u2014"],
                ["\u7EE7\u7EED\u65B9\u5F0F", state.result.continueMode === "resumed-session" ? "\u65B0\u4F1A\u8BDD\uFF08\u539F\u4F1A\u8BDD\u5DF2\u7ED3\u675F\uFF09" : "\u539F\u4F1A\u8BDD"]
              ]
            })
          )
        ) : null,
        h(
          "details",
          { "data-decision-technical": "true", style: { marginTop: "20px", borderTop: `1px solid ${T.line}`, paddingTop: "12px", color: T.text2, fontSize: "12px" } },
          h("summary", { style: { cursor: "pointer" } }, "\u8FD0\u884C\u4E0E\u6280\u672F\u8BB0\u5F55\uFF08\u6309\u9700\u67E5\u770B\uFF09"),
          run ? h(PlanRows, { rows: [["\u8FD0\u884C", run.id], ["\u72B6\u6001", run.label ?? run.status], ["\u5DF2\u56DE\u7B54", String(run.answers ?? 0)]] }) : null,
          state.decision ? h("p", null, state.decision) : null,
          h("pre", { style: { whiteSpace: "pre-wrap", maxHeight: "320px", overflow: "auto" } }, state.text || "\u6682\u65E0\u539F\u59CB\u8BB0\u5F55")
        )
      );
    }
    function acceptanceChecklistFor(item) {
      const explicit = item.detailView?.content?.doc?.acceptance;
      const criteria = explicit?.length ? explicit : item.detailView?.verificationSummary?.criteria ?? [];
      if (criteria.length) return criteria.map((entry, index) => ({ id: entry.id ?? "AC-" + (index + 1), text: entry.text || entry.title || entry.id }));
      return (item.verifiedBy ?? []).map((id) => ({ id, text: item.trace?.nodes?.find((node) => node.id === id)?.title ?? id }));
    }
    function SignoffModal({ item, root, onClose, onDone }) {
      const criteria = acceptanceChecklistFor(item);
      const [checks, setChecks] = useState({});
      const [confirmed, setConfirmed] = useState(false);
      const [state, setState] = useState({ loading: false, result: null, error: null });
      const submitting = useRef(false);
      const candidate = item.candidate;
      const identity = (candidate?.id ?? "") + ":" + (candidate?.treeHash ?? "");
      useEffect(() => {
        setChecks({});
        setConfirmed(false);
      }, [identity]);
      const complete = confirmed && criteria.length > 0 && criteria.every((entry) => checks[entry.id]);
      const allowed = item.decision?.signoff?.allowed === true && candidate?.current === true;
      const submit = async () => {
        if (submitting.current || !complete || !allowed) return;
        submitting.current = true;
        setState({ loading: true, result: null, error: null });
        try {
          const result = await writeJson("signoff", { requirementId: item.id, expectedCandidate: { id: candidate.id, treeHash: candidate.treeHash }, apply: true }, root);
          setState({ loading: false, result, error: null });
          onDone?.();
        } catch (error) {
          setState({ loading: false, result: null, error: error.message });
        } finally {
          submitting.current = false;
        }
      };
      return h(
        ModalShell,
        {
          title: "\u9A8C\u6536\u4EA4\u4ED8 \xB7 " + item.id,
          lead: "\u5148\u5728\u5B9E\u9645\u4EA4\u4ED8\u7248\u672C\u4E2D\u64CD\u4F5C\u9A8C\u8BC1\uFF0C\u518D\u9010\u9879\u786E\u8BA4\u3002\u81EA\u52A8\u68C0\u67E5\u901A\u8FC7\u53EA\u662F\u53C2\u8003\uFF1B\u672C\u6B21\u786E\u8BA4\u4F1A\u8BB0\u5F55\u4E3A\u4F60\u7684\u4EBA\u5DE5\u9A8C\u6536\u3002",
          onClose,
          feedbackContext: feedbackContextFor(item),
          width: "720px",
          footer: [
            h("button", { key: "close", style: HUMAN_CONTROL, onClick: onClose }, state.result ? "\u8FD4\u56DE\u9700\u6C42" : "\u7A0D\u540E\u9A8C\u6536"),
            !state.result ? h("button", { key: "sign", style: complete && allowed ? HUMAN_PRIMARY : { ...HUMAN_CONTROL, opacity: 0.55 }, disabled: state.loading || !complete || !allowed, onClick: submit }, state.loading ? "\u6B63\u5728\u8BB0\u5F55\u2026" : "\u786E\u8BA4\u9A8C\u6536\u901A\u8FC7") : null
          ]
        },
        h(
          "section",
          { "data-human-acceptance-guide": "true", style: { lineHeight: 1.8, fontSize: "14px", padding: "16px 0" } },
          h("h3", { style: { margin: "0 0 8px", fontSize: "18px" } }, state.result ? "\u4EBA\u5DE5\u9A8C\u6536\u5DF2\u8BB0\u5F55\uFF0C\u53EF\u4EE5\u53D1\u5E03\u5F52\u6863" : "\u5728\u4EA4\u4ED8\u7248\u672C\u4E2D\u9010\u9879\u9A8C\u8BC1"),
          h("p", { style: { margin: "0 0 12px", color: T.text2 } }, "\u6253\u5F00\u672C\u9700\u6C42\u6D89\u53CA\u7684\u529F\u80FD\u9875\u9762\uFF0C\u6309\u7167\u4E0B\u9762\u6BCF\u9879\u8981\u6C42\u5B9E\u9645\u64CD\u4F5C\uFF0C\u6BD4\u8F83\u7ED3\u679C\u3002\u53D1\u73B0\u95EE\u9898\u65F6\u6682\u4E0D\u786E\u8BA4\uFF0C\u8FD4\u56DE\u9700\u6C42\u9009\u62E9\u201C\u9000\u56DE AI \u4FEE\u590D\u201D\u3002"),
          criteria.map((entry) => h(
            "label",
            { key: entry.id, style: { display: "flex", alignItems: "flex-start", gap: "10px", padding: "12px 0", borderBottom: "1px solid " + T.line, cursor: "pointer" } },
            h("input", { type: "checkbox", name: `acceptance-${entry.id}`, "aria-label": `\u9A8C\u6536\u8981\u6C42\uFF1A${entry.text}`, checked: checks[entry.id] === true, disabled: state.loading || Boolean(state.result), onChange: (event) => setChecks((current) => ({ ...current, [entry.id]: event.target.checked })), style: { marginTop: "6px", flexShrink: 0 } }),
            h("span", null, h("span", { style: { color: T.text3, fontSize: "12px", marginRight: "8px" } }, entry.id), entry.text)
          )),
          !criteria.length ? h("p", { role: "alert", style: { color: T.warn } }, "\u7F3A\u5C11\u660E\u786E\u7684\u4E1A\u52A1\u9A8C\u6536\u6E05\u5355\uFF0C\u8BF7\u5148\u8865\u5145\u9A8C\u6536\u8981\u6C42\u3002") : null,
          h("label", { style: { display: "flex", gap: "10px", padding: "16px 0", cursor: "pointer" } }, h("input", { type: "checkbox", name: "acceptance-confirmed", "aria-label": "\u786E\u8BA4\u6211\u5DF2\u5728\u5F53\u524D\u4EA4\u4ED8\u7248\u672C\u5B9E\u9645\u9A8C\u8BC1\u4EE5\u4E0A\u8981\u6C42", checked: confirmed, disabled: state.loading || Boolean(state.result), onChange: (event) => setConfirmed(event.target.checked) }), "\u6211\u5DF2\u5728\u5F53\u524D\u4EA4\u4ED8\u7248\u672C\u5B9E\u9645\u9A8C\u8BC1\u4EE5\u4E0A\u8981\u6C42\uFF0C\u540C\u610F\u672C\u6B21\u4EA4\u4ED8\u3002"),
          !allowed && !state.result ? h("p", { role: "status", style: { color: T.warn } }, item.decision?.topGap?.message ?? "\u5F53\u524D\u4EA4\u4ED8\u8BC1\u636E\u4E0D\u518D\u6EE1\u8DB3\u9A8C\u6536\u6761\u4EF6\uFF0C\u8BF7\u91CD\u65B0\u6838\u9A8C\u3002") : null,
          state.error ? h("p", { role: "alert", style: { color: T.err } }, state.error) : null,
          h(
            "details",
            { style: { marginTop: "12px", color: T.text3, fontSize: "12px" } },
            h("summary", { style: { cursor: "pointer" } }, "\u67E5\u770B\u4EA4\u4ED8\u7248\u672C\u4E0E\u68C0\u67E5\u4F9D\u636E"),
            h("p", null, "\u5019\u9009\uFF1A" + (candidate?.id ?? "\u672A\u751F\u6210") + " \xB7 \u63D0\u4EA4\uFF1A" + (candidate?.headSha?.slice(0, 12) ?? "\u672A\u77E5")),
            h("p", null, "\u7B7E\u7F72\u8EAB\u4EFD\u7531\u5F53\u524D\u767B\u5F55\u4F1A\u8BDD\u786E\u8BA4\uFF1B\u8FD9\u91CC\u4E0D\u4F1A\u66FF\u6362\u6216\u624B\u586B\u4ED6\u4EBA\u7684\u8EAB\u4EFD\u3002")
          )
        )
      );
    }
    function ReleaseModal({ item, root, onClose, onDone }) {
      const [state, setState] = useState({ loading: false, release: null, error: null, done: false });
      const busy = useRef(false);
      const publish = useCallback(async () => {
        if (busy.current) return;
        busy.current = true;
        setState((current) => ({ ...current, loading: true, error: null }));
        try {
          const result = await writeJson("release", { mode: "archive", requirementId: item.id, apply: true }, root);
          setState({ loading: false, release: result.release ?? null, error: null, done: result.release?.status === "released" });
          onDone?.();
        } catch (error) {
          setState((current) => ({ ...current, loading: false, error: error.message }));
        } finally {
          busy.current = false;
        }
      }, [item.id, root]);
      return h(
        ModalShell,
        {
          title: "\u53D1\u5E03\u5F52\u6863 \xB7 " + item.id,
          lead: "\u672C\u64CD\u4F5C\u4F1A\u590D\u6838\u5F53\u524D\u5019\u9009\u4E0E\u4EBA\u5DE5\u7B7E\u6536\u4ECD\u7136\u6709\u6548\uFF0C\u5E76\u751F\u6210\u4E0D\u53EF\u7BE1\u6539\u7684\u53D1\u5E03\u5F52\u6863\u5FEB\u7167\u540E\u5173\u95ED\u9700\u6C42\u3002",
          onClose,
          feedbackContext: feedbackContextFor(item),
          width: "720px",
          footer: [
            h("button", { key: "close", style: HUMAN_CONTROL, disabled: state.loading, onClick: onClose }, state.done ? "\u8FD4\u56DE\u9700\u6C42" : "\u7A0D\u540E\u5904\u7406"),
            !state.done ? h("button", { key: "publish", style: HUMAN_PRIMARY, disabled: state.loading, "data-release-primary": "archive", onClick: publish }, state.loading ? "\u6B63\u5728\u751F\u6210\u5F52\u6863\u2026" : "\u{1F680} \u53D1\u5E03\u4EA4\u4ED8 (Release)") : null
          ]
        },
        h(
          "section",
          { "aria-live": "polite", "data-release-flow": "true", style: { padding: "18px 0", lineHeight: 1.8 } },
          h("div", { style: { fontSize: "20px", fontWeight: 650, color: T.text } }, state.done ? "\u53D1\u5E03\u5F52\u6863\u5B8C\u6210\uFF0C\u9700\u6C42\u5DF2\u5173\u95ED" : "\u786E\u8BA4\u53D1\u5E03\u5F52\u6863"),
          state.release?.archive?.path ? h("p", { style: { ...muted, margin: "6px 0" } }, `\u5F52\u6863\u8BB0\u5F55\uFF1A${state.release.archive.path}`) : null,
          !state.done ? h("p", { style: { color: T.text2, fontSize: "13px", margin: "14px 0 0" } }, "\u5F52\u6863\u4F1A\u518D\u6B21\u6821\u9A8C\u4EA4\u4ED8\u5019\u9009\u3001\u4EBA\u5DE5\u7B7E\u6536\u548C\u5DE5\u4F5C\u533A\u5FEB\u7167\u3002\u4EFB\u4E00\u53D7\u4FDD\u62A4\u5185\u5BB9\u5728\u7B7E\u6536\u540E\u53D1\u751F\u53D8\u5316\u90FD\u4F1A\u88AB\u62D2\u7EDD\u3002") : null,
          state.error ? h("p", { role: "alert", style: { color: T.err, fontSize: "13px" } }, state.error) : null
        )
      );
    }
    function VersionList({ item, onSnapshot, onDiff, compact }) {
      const [storedHistory, setHistory] = useState(null);
      const history = storedHistory?.root === item.root && storedHistory?.id === item.id ? storedHistory : { versions: null, head: null, next: 0, loading: false, error: false };
      const loadHistory = useRef(null);
      useEffect(() => {
        const lifetime = new AbortController();
        let head = null, offset = 0, busy = false;
        const seen = /* @__PURE__ */ new Set();
        setHistory({ root: item.root, id: item.id, versions: null, head: null, next: 0, loading: false, error: false });
        loadHistory.current = async () => {
          if (busy || lifetime.signal.aborted || offset === null) return;
          busy = true;
          const controller = new AbortController();
          const cancel = () => controller.abort();
          lifetime.signal.addEventListener("abort", cancel, { once: true });
          let timeout;
          setHistory((previous) => ({ ...previous, loading: true, error: false }));
          try {
            const params = new URLSearchParams({ root: item.root ?? "", asset: item.id, mode: "history", offset: String(offset) });
            if (head) params.set("head", head);
            const { response, data } = await Promise.race([
              fetch(`/api/alm/requirements/version?${params}`, { headers: { accept: "application/json" }, signal: controller.signal }).then(async (response2) => ({ response: response2, data: await response2.json() })),
              new Promise((_, reject) => {
                timeout = setTimeout(() => {
                  cancel();
                  reject(new Error("version timeout"));
                }, 1e4);
              })
            ]);
            if (!response.ok) throw new Error("unavailable");
            if (data.schema !== "alm.version.history/v1" || data.asset !== item.id || !/^[0-9a-f]{40,64}$/.test(data.head ?? "") || head && data.head !== head || !Array.isArray(data.versions) || data.versions.length > 20 || data.versions.some((version) => !version || !/^[0-9a-f]{40,64}$/.test(version.sha ?? "") || typeof version.subject !== "string" || seen.has(version.sha)) || new Set(data.versions.map((version) => version.sha)).size !== data.versions.length || data.next !== null && (data.next !== offset + 20 || data.versions.length !== 20)) throw new Error("invalid");
            if (controller.signal.aborted) throw new Error("cancelled");
            for (const version of data.versions) seen.add(version.sha);
            head = data.head;
            offset = data.next;
            setHistory((previous) => ({ root: item.root, id: item.id, versions: previous.versions === null ? data.versions : [...previous.versions, ...data.versions], head, next: offset, loading: false, error: false }));
          } catch {
            if (!lifetime.signal.aborted) setHistory((previous) => ({ ...previous, loading: false, error: true }));
          } finally {
            clearTimeout(timeout);
            lifetime.signal.removeEventListener("abort", cancel);
            busy = false;
          }
        };
        return () => {
          lifetime.abort();
          loadHistory.current = null;
        };
      }, [item.root, item.id]);
      const versions = history.versions ?? item.versions ?? [];
      return h(
        "div",
        null,
        h(
          "div",
          { style: { ...row, paddingTop: 0 } },
          h("span", { style: rowLabel }, "\u5F53\u524D\u4FEE\u8BA2"),
          h("span", { style: { color: T.text } }, item.revision == null || item.revision === "" ? "\u672A\u767B\u8BB0" : `v${item.revision}`)
        ),
        versions.length === 0 ? h("p", { style: { margin: "6px 0 0", ...muted } }, "\u672A\u8BFB\u53D6\u5230\u7248\u672C\u8BB0\u5F55\uFF1B\u53EF\u80FD\u5C1A\u672A\u63D0\u4EA4\u6216\u5386\u53F2\u6682\u4E0D\u53EF\u7528\u3002") : h(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: "2px" } },
          versions.map(
            (version) => h(
              "div",
              {
                key: version.sha,
                style: { display: "flex", alignItems: "baseline", gap: "8px", borderTop: `1px solid ${T.line}`, padding: "4px 0" }
              },
              h(
                "button",
                {
                  "data-version-sha": version.sha,
                  onClick: () => onSnapshot(item, version),
                  style: {
                    display: "flex",
                    alignItems: "baseline",
                    gap: "8px",
                    flex: 1,
                    minWidth: 0,
                    textAlign: "left",
                    border: 0,
                    background: "transparent",
                    color: T.text2,
                    padding: "1px 0",
                    fontSize: "12px",
                    cursor: "pointer",
                    lineHeight: 1.6
                  }
                },
                h("span", { style: { color: T.text3, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "11px", flex: "none" } }, version.short),
                h("span", { style: { color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, version.subject)
              ),
              h("span", { style: { color: T.text3, fontSize: "11px", flex: "none" } }, version.date?.slice(0, 10)),
              onDiff ? h(
                "button",
                {
                  "data-diff-sha": version.sha,
                  onClick: () => onDiff(item, version),
                  style: { border: 0, background: "transparent", color: T.brand, padding: 0, fontSize: "11px", cursor: "pointer", flex: "none" }
                },
                "\u5BF9\u6BD4\u5F53\u524D"
              ) : null
            )
          )
        ),
        history.loading ? h("p", { role: "status", style: muted }, "\u6B63\u5728\u8BFB\u53D6\u7248\u672C\u5386\u53F2\u2026") : null,
        history.error ? h("p", { role: "alert", style: muted }, "\u7248\u672C\u5386\u53F2\u6682\u4E0D\u53EF\u7528\u3002 ", h("button", { type: "button", style: DETAIL_LINK, onClick: () => loadHistory.current?.() }, "\u91CD\u8BD5")) : null,
        history.next !== null && !history.error ? h("button", { type: "button", style: DETAIL_LINK, disabled: history.loading, onClick: () => loadHistory.current?.() }, history.versions === null ? "\u8BFB\u53D6\u7248\u672C\u5386\u53F2" : "\u52A0\u8F7D\u66F4\u591A\u7248\u672C") : null,
        compact ? null : h("p", { style: { margin: "8px 0 0", ...muted } }, history.versions === null ? "\u8FD9\u91CC\u53EA\u663E\u793A\u5DF2\u8BFB\u53D6\u7684\u7248\u672C\uFF0C\u8F83\u65E9\u8BB0\u5F55\u53EF\u80FD\u672A\u5305\u542B\u3002\u5FEB\u7167\u548C\u5BF9\u6BD4\u4E0D\u4F1A\u6539\u52A8\u5DE5\u4F5C\u533A\u3002" : "\u7248\u672C\u6309\u9996\u6B21\u8BFB\u53D6\u65F6\u7684\u63D0\u4EA4\u56FA\u5B9A\uFF1B\u5FEB\u7167\u548C\u5BF9\u6BD4\u4E0D\u4F1A\u6539\u52A8\u5DE5\u4F5C\u533A\u3002")
      );
    }
    function DiffModal({ state, onClose }) {
      const { item, version, data, loading, error } = state;
      const fieldRow = (field) => h(
        "div",
        { key: field.field, style: { ...row, alignItems: "baseline" } },
        h("span", { style: { ...rowLabel, width: "110px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "11px" } }, field.field),
        h("span", { style: { color: T.text2, textDecoration: "line-through", wordBreak: "break-word" } }, field.from === null ? "\uFF08\u65E0\uFF09" : field.from),
        h("span", { style: { color: T.text3, flex: "none" } }, "\u2192"),
        h("span", { style: { color: T.ok, wordBreak: "break-word" } }, field.to === null ? "\uFF08\u5220\u9664\uFF09" : field.to)
      );
      return h(
        ModalShell,
        {
          title: `\u7248\u672C\u5BF9\u6BD4 \xB7 ${item.id}`,
          lead: `${version.short}\uFF08${version.date?.slice(0, 10) ?? ""}\uFF09\u2192 \u5F53\u524D\u5DE5\u4F5C\u533A\uFF1B\u53EA\u8BFB\uFF0C\u4E0D\u6539\u52A8\u5DE5\u4F5C\u533A\u3002`,
          onClose,
          width: "820px",
          footer: [h("button", { key: "close", style: primary, onClick: onClose }, "\u5173\u95ED")]
        },
        loading ? h("p", { style: muted }, "\u6B63\u5728\u5BF9\u6BD4\u7248\u672C\u2026") : null,
        error ? h("p", { style: { margin: 0, color: T.err, fontSize: "13px" } }, error) : null,
        data ? h(
          "div",
          null,
          h(PlanRows, {
            rows: [
              ["\u53D8\u66F4\u5B57\u6BB5", `${data.summary.changedFields}`],
              ["\u65B0\u589E\u5173\u7CFB", `${data.summary.addedRelations}`],
              ["\u79FB\u9664\u5173\u7CFB", `${data.summary.removedRelations}`],
              ["\u6587\u4EF6", data.file]
            ]
          }),
          data.fields.length ? h(
            "div",
            { style: { marginTop: "12px", border: `1px solid ${T.line}`, borderRadius: "10px", padding: "4px 12px" } },
            data.fields.map(fieldRow)
          ) : h("p", { style: { margin: "12px 0 0", ...muted } }, "\u5B57\u6BB5\u65E0\u53D8\u5316\u3002"),
          data.relations.added.length || data.relations.removed.length ? h(
            "div",
            { style: { marginTop: "12px", fontSize: "12.5px", color: T.text2, lineHeight: 1.9 } },
            data.relations.added.map((key) => h("div", { key: `add-${key}`, style: { color: T.ok } }, `+ ${key.replace("|", " \u2192 ")}`)),
            data.relations.removed.map((key) => h("div", { key: `remove-${key}`, style: { color: T.err } }, `- ${key.replace("|", " \u2192 ")}`))
          ) : h("p", { style: { margin: "10px 0 0", ...muted } }, "\u5173\u7CFB\u65E0\u53D8\u5316\u3002")
        ) : null
      );
    }
    function nextPrompt(item, root) {
      const at = root ? ` --root "${root}"` : "";
      if (item.nextAction === "missing-acceptance") {
        return `\u8BF7\u4E3A ${item.id} \u8865\u9A8C\u6536\uFF1A\u5728 tests/ \u4E0B\u65B0\u589E TEST-* \u8D44\u4EA7\uFF0C\u5E76\u5728\u9700\u6C42\u91CC\u52A0 verified_by \u5173\u7CFB\uFF1B\u7136\u540E\u8FD0\u884C node packages/alm-core/bin/alm.mjs check${at} \u786E\u8BA4 COV-001 \u901A\u8FC7\u3002`;
      }
      if (item.nextAction === "dangling-relation") {
        return `\u8BF7\u4FEE\u590D ${item.id} \u7684\u5173\u7CFB\uFF1A\u5148\u770B alm check${at} \u91CC REL-001 \u7684 file:line\uFF0C\u8865\u5EFA\u76EE\u6807\u8D44\u4EA7\u6216\u5220\u9664\u60AC\u7A7A\u5173\u7CFB\uFF0C\u518D\u91CD\u8DD1\u95E8\u7981\u3002`;
      }
      if (item.nextAction === "ready-to-change") {
        return `\u8BF7\u4E3A ${item.id} \u53D1\u8D77\u53D8\u66F4\uFF1A\u5148\u8BFB docs/planning/skill-plan.md \u4E0E alm-change-workflow \u6280\u80FD\uFF0C\u7528 alm workspace create --baseline <sha> --change CHG-<DOMAIN>-<NNN> \u5EFA\u5DE5\u4F5C\u533A\uFF0C\u518D\u6539\u8D44\u4EA7\u5E76\u8DD1 alm check${at}\u3002`;
      }
      return `\u8BF7\u8BC4\u4F30 ${item.id} \u7684\u5F71\u54CD\u9762\uFF1A\u8FD0\u884C node packages/alm-core/bin/alm.mjs impact --asset ${item.id}${at}\uFF0C\u5E76\u68C0\u67E5\u662F\u5426\u9700\u8981\u66F4\u65B0\u57FA\u7EBF\u3002`;
    }
    function CopyPrompt({ text }) {
      const [state, setState] = useState("idle");
      const copy = useCallback(async () => {
        try {
          await navigator.clipboard.writeText(text);
          setState("copied");
        } catch {
          setState("failed");
        }
        setTimeout(() => setState("idle"), 1800);
      }, [text]);
      return h(
        "div",
        { style: { marginTop: "10px" } },
        h("button", { style: button, onClick: copy }, state === "copied" ? "\u5DF2\u590D\u5236" : state === "failed" ? "\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u9009\u62E9" : "\u590D\u5236\u63D0\u793A\u8BCD"),
        h(
          "pre",
          {
            style: {
              margin: "8px 0 0",
              padding: "10px",
              fontSize: "12px",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              background: T.base,
              border: `1px solid ${T.line}`,
              borderRadius: "8px"
            }
          },
          text
        )
      );
    }
    function requirementViewCounts(data, keywordMatched) {
      const loaded = Array.isArray(data?.requirements);
      const counts = {};
      for (const [id] of FILTERS) {
        counts[id] = !loaded ? "\u2014" : id === "all" ? keywordMatched.length : keywordMatched.filter((item) => matchesView(item, id)).length;
      }
      return counts;
    }
    function useRequirements({ root, projectId }) {
      const scope = projectId === ALL_PROJECTS ? "?project=ALL" : root ? `?root=${encodeURIComponent(root)}` : null;
      const [state, setState] = useState({ scope, loading: Boolean(scope), error: null, data: null });
      const load = useCallback(function load2({ silent = false } = {}) {
        const request = (load2.request ?? 0) + 1;
        load2.request = request;
        if (!scope) {
          setState({ scope, loading: false, error: null, data: null });
          return Promise.resolve({ ok: false, error: "\u8BF7\u5148\u9009\u62E9\u5DE5\u4F5C\u533A\u9879\u76EE" });
        }
        if (!silent) setState((prev) => ({ scope, loading: true, error: null, data: prev.scope === scope ? prev.data : null }));
        return fetch(`/api/alm/requirements${scope}`, { headers: { accept: "application/json" } }).then(async (response) => {
          const body = await response.json();
          if (!response.ok || body.ok === false) {
            throw new Error(body?.error?.message ?? body?.error ?? `HTTP ${response.status}`);
          }
          if (load2.request === request) setState({ scope, loading: false, error: null, data: body });
          return { ok: true, data: body };
        }).catch((error) => {
          if (load2.request === request) setState((prev) => ({ scope, loading: false, error: error.message, data: prev.scope === scope ? prev.data : null }));
          return { ok: false, error: error.message };
        });
      }, [scope]);
      useEffect(() => {
        load();
        return () => {
          load.request = (load.request ?? 0) + 1;
        };
      }, [load]);
      const visible = state.scope === scope ? state : { loading: Boolean(scope), error: null, data: null };
      return { ...visible, reload: load };
    }
    function ProjectContextPrompt({ selectRef }) {
      return h(
        "div",
        { role: "status", "data-project-context-empty": "true", style: { ...card, cursor: "default", padding: "28px" } },
        h("p", { style: { margin: "0 0 8px", fontWeight: 600 } }, "\u8BF7\u5148\u9009\u62E9\u5DE5\u4F5C\u533A\u9879\u76EE"),
        h("p", { style: muted }, "\u5C1A\u672A\u52A0\u8F7D\u9700\u6C42\uFF0C\u4E0D\u4EE3\u8868\u6CA1\u6709\u9700\u6C42"),
        h("button", { type: "button", style: button, onClick: () => selectRef.current?.focus() }, "\u9009\u62E9\u5DE5\u4F5C\u533A\u9879\u76EE")
      );
    }
    function ProjectPicker({ projects = [], currentId, onPick, selectRef }) {
      return h(
        "label",
        { style: { display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: T.text2 } },
        "\u5DE5\u4F5C\u533A",
        h(
          "select",
          { ref: selectRef, style: input, value: currentId ?? "", onChange: (event) => onPick(event.target.value), "aria-label": "\u9009\u62E9\u5DE5\u4F5C\u533A\u9879\u76EE" },
          h("option", { value: "" }, "\u9009\u62E9\u5DE5\u4F5C\u533A\u2026"),
          projects.length > 0 ? h("option", { value: ALL_PROJECTS }, "\u5168\u90E8\u9879\u76EE\uFF08\u805A\u5408\uFF09") : null,
          projects.map(
            (project) => h(
              "option",
              { key: project.id, value: project.id, disabled: project.exists === false },
              `${project.title}${project.linked ? `\uFF08${project.projectId}\uFF09` : " \xB7 \u672A\u5173\u8054\u4ED3\u5E93"}${project.exists === false ? " \xB7 \u8DEF\u5F84\u7F3A\u5931" : ""}`
            )
          )
        )
      );
    }
    function RootPicker({ rootInput, setRootInput, onApply, onReset }) {
      return h(
        "form",
        {
          style: { display: "flex", gap: "8px", alignItems: "center", margin: "4px 0 16px", flexWrap: "wrap" },
          onSubmit: (event) => {
            event.preventDefault();
            onApply();
          }
        },
        h("span", { style: muted }, "\u4ED3\u5E93\u6839"),
        h("input", {
          style: input,
          name: "repository-root",
          autoComplete: "off",
          "aria-label": "\u4ED3\u5E93\u6839\u76EE\u5F55",
          value: rootInput,
          placeholder: "\u8F93\u5165\u4ED3\u5E93\u6839\u76EE\u5F55\uFF0C\u6216\u9009\u62E9\u5DE5\u4F5C\u533A",
          onChange: (event) => setRootInput(event.target.value)
        }),
        h("button", { style: button, type: "submit" }, "\u52A0\u8F7D"),
        h("button", { style: button, type: "button", onClick: onReset }, "\u6E05\u9664\u9009\u62E9")
      );
    }
    const LIST_COLUMNS = "minmax(0, 1fr) 108px 88px 76px 156px 124px";
    const LIST_COLUMNS_NARROW = "minmax(0, 1fr) 104px 148px 124px";
    const LIST_COLUMNS_MOBILE = "minmax(0, 1fr) 108px";
    function listColumns(narrow, mobile) {
      if (mobile) return LIST_COLUMNS_MOBILE;
      return narrow ? LIST_COLUMNS_NARROW : LIST_COLUMNS;
    }
    function listCell(extra) {
      return { minWidth: 0, display: "flex", alignItems: "center", ...extra };
    }
    function acceptanceLabel(item) {
      const count = item.detailView?.content?.doc?.acceptance?.length ?? item.docView?.doc?.acceptance?.length ?? item.detailView?.content?.acceptanceCriteria?.length ?? 0;
      if (count > 0) return `${count} \u9879\u6807\u51C6`;
      const section = String(item.briefText ?? "").match(/^#{1,6}\s*(?:验收标准|交付验证|验收要求)[^\n]*\n([\s\S]*?)(?=^#{1,6}\s|(?![\s\S]))/m)?.[1] ?? "";
      const entries = section.match(/^\s*(?:[-*+]\s+|\d+[.)、]\s*|AC[- ]?\d+[:：.、\s])/gmi) ?? [];
      return entries.length ? `${entries.length} \u9879\u6807\u51C6` : section.trim() ? "\u6B63\u6587\u5185\u542B" : "\u5F85\u7EC6\u5316";
    }
    function duplicateCountFor(item, duplicateCounts) {
      const count = duplicateCounts?.[item.id];
      if (!Number.isFinite(count) || count < 2) return 2;
      return count;
    }
    function anomalyLine(item, duplicateCounts) {
      const list = item.anomalies ?? [];
      if (list.length === 0) return null;
      const kind = list[0].kind;
      if (kind === "duplicate-id") return `\u9700\u6C42 ID \u91CD\u590D \xB7 \u6D89\u53CA ${duplicateCountFor(item, duplicateCounts)} \u6761\u8BB0\u5F55`;
      if (kind === "duplicate-business-id") return `\u4E1A\u52A1\u7F16\u53F7\u91CD\u590D \xB7 \u6D89\u53CA ${duplicateCountFor(item, duplicateCounts)} \u6761\u8BB0\u5F55`;
      if (kind === "dangling-relation") return "\u60AC\u7A7A\u5173\u7CFB \xB7 \u6765\u6E90\u8BB0\u5F55\u4FDD\u7559\uFF0C\u5F85\u4EBA\u5DE5\u6838\u5BF9";
      const label = ANOMALY_LABELS[kind] ?? kind;
      return list.length > 1 ? `${label}\u7B49 ${list.length} \u9879` : label;
    }
    const CHECK_TONE_COLOR = {
      error: () => T.err,
      warn: () => T.warn,
      success: () => T.ok,
      neutral: () => T.text3
    };
    function checkToneColor(tone) {
      return (CHECK_TONE_COLOR[tone] ?? CHECK_TONE_COLOR.neutral)();
    }
    function checkSummary(item) {
      const decision = item.decision;
      if (!decision || decision.state === "unchecked") return { label: "\u5F85\u9A8C\u8BC1", detail: null, tone: "neutral" };
      const code = decision.topGap?.code ?? "";
      let detail = null;
      if (decision.state === "blocked") detail = decision.topGap?.message ?? "\u5B58\u5728\u963B\u585E\u9879";
      else if (decision.state === "needs-clarification") detail = "\u6570\u636E\u5F02\u5E38\u5F85\u6F84\u6E05";
      else if (decision.state === "failed") detail = "\u9A8C\u6536\u6267\u884C\u5931\u8D25";
      else if (decision.state === "stale") detail = "\u8BC1\u636E\u4E0E\u5F53\u524D\u7248\u672C\u4E0D\u4E00\u81F4";
      else if (decision.state === "unchecked") {
        detail = code === "review-not-run" || code === "review-not-accepted" || code === "coverage-incomplete" ? "\u53EF\u7EE7\u7EED\u63A8\u8FDB\uFF1BAI \u4F18\u5316\u5EFA\u8BAE\u53EF\u9009" : code === "acceptance-missing" ? "\u5F85\u8865\u5145\u9A8C\u6536\u65B9\u5F0F" : code === "acceptance-not-run" ? "\u5F85\u5F00\u59CB\u9A8C\u8BC1" : decision.topGap?.message ?? null;
      } else if (decision.state === "verified") detail = null;
      return { label: decision.label ?? "\u672A\u68C0\u67E5", detail, tone: decision.tone ?? "neutral" };
    }
    function rowAction(item, { onOpen, onAiReview, onAcceptance, onSignoff, onDefect }) {
      const decision = item?.decision;
      const delivery = deliveryOf(item);
      if (item.pendingPatch || item.detailView?.question || item.currentMatter?.kind === "decision" || item.detailView?.currentMatter?.kind === "decision" || item.run?.awaitingAnswer) return { label: "\u53BB\u786E\u8BA4", icon: "alert", run: () => onOpen(item) };
      if (isExecutingRequirement(item)) return { label: "\u67E5\u770B\u63A8\u8FDB", icon: "eye", run: () => onOpen(item) };
      if (defectAwaitingConfirmation(item)) return { label: "\u5904\u7406\u7F3A\u9677", icon: "alert", run: () => (onDefect ?? onOpen)(item) };
      if (delivery.key === "closed") return { label: "\u67E5\u770B", icon: "eye", run: () => onOpen(item) };
      if (delivery.key === "awaiting-acceptance") return { label: "\u9A8C\u6536\u4EA4\u4ED8", icon: "check", run: () => (onSignoff ?? onOpen)(item) };
      if (delivery.key === "accepted") return { label: "\u67E5\u770B", icon: "eye", run: () => onOpen(item) };
      if (delivery.key === "in-progress") return { label: "\u67E5\u770B\u63A8\u8FDB", icon: "eye", run: () => onOpen(item) };
      if (delivery.key === "pending") return { label: "\u8FDB\u5165\u9700\u6C42", icon: "chevron", iconOnly: true, run: () => onOpen(item) };
      if (!decision) return { label: "\u6253\u5F00", icon: "eye", run: () => onOpen(item) };
      const code = decision.topGap?.code ?? "";
      if (decision.state === "blocked" || decision.state === "needs-clarification") {
        return { label: "\u5904\u7406", icon: "alert", run: () => onOpen(item) };
      }
      if (decision.state === "failed") return { label: "\u91CD\u8DD1\u9A8C\u6536", icon: "flask", run: () => onAcceptance(item) };
      if (decision.state === "stale") return { label: "\u91CD\u65B0\u9A8C\u6536", icon: "flask", run: () => onAcceptance(item) };
      if (decision.state === "unchecked") {
        if (code === "acceptance-missing") return { label: "\u8865\u5145\u9A8C\u8BC1\u65B9\u5F0F", icon: "flask", run: () => onAcceptance(item) };
        if (code === "acceptance-not-run") return { label: "\u5F00\u59CB\u9A8C\u8BC1", icon: "flask", run: () => onAcceptance(item) };
        if (code === "review-not-run" || code === "review-not-accepted" || code === "coverage-incomplete") {
          return { label: "\u6253\u5F00", icon: "eye", run: () => onOpen(item) };
        }
        return { label: "\u6253\u5F00", icon: "eye", run: () => onOpen(item) };
      }
      if (decision.state === "verified") return { label: "\u67E5\u770B", icon: "eye", run: () => onOpen(item) };
      return { label: "\u6253\u5F00", icon: "eye", run: () => onOpen(item) };
    }
    function RequirementRow({ item, narrow, mobile, showProject, selected = false, duplicateCounts, actionHandlers }) {
      const key = item.occurrenceKey ?? item.id;
      const decision = item.decision ?? null;
      const anomaly = anomalyLine(item, duplicateCounts);
      const check = checkSummary(item);
      const defect = isDefect(item) ? defectRecord(item) : null;
      const occurrences = Number(defect?.occurrenceCount ?? 0);
      const action = rowAction(item, actionHandlers);
      const executing = isExecutingRequirement(item);
      const githubLinks = item.detailView?.githubLinks ?? null;
      const [hover, setHover] = useState(false);
      const open = () => actionHandlers.onOpen(item);
      const actionButton = h(
        "button",
        {
          type: "button",
          onClick: (event) => {
            event.stopPropagation();
            action.run();
          },
          title: action.label,
          "aria-label": `${action.label}\uFF1A${item.title}`,
          style: {
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            height: "28px",
            padding: "0 9px",
            border: `1px solid ${T.line2}`,
            borderRadius: "7px",
            background: action.label === "\u53BB\u786E\u8BA4" ? "rgba(231,176,75,.12)" : "transparent",
            color: action.label === "\u53BB\u786E\u8BA4" ? T.warn : action.icon === "alert" ? T.err : T.text2,
            fontSize: "11.5px",
            whiteSpace: "nowrap",
            cursor: "pointer"
          }
        },
        h(ActionIcon, { name: action.icon, size: 13 }),
        action.iconOnly ? null : action.label
      );
      const archiveButton = deliveryOf(item).key === "closed" ? null : h(
        "button",
        {
          type: "button",
          onClick: (event) => {
            event.stopPropagation();
            actionHandlers.onArchive(item);
          },
          disabled: executing,
          title: executing ? "AI \u6B63\u5728\u6267\u884C\uFF0C\u8BF7\u7B49\u5F85\u5B8C\u6210\u6216\u5148\u53D6\u6D88\u8FD0\u884C" : "\u4E0D\u63A8\u8FDB\uFF0C\u5173\u95ED\u5E76\u8BB0\u5F55\u539F\u56E0",
          "aria-label": `\u5173\u95ED\u5F52\u6863\uFF1A${item.title}`,
          "data-archive": item.occurrenceKey ?? item.id,
          style: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "28px",
            height: "28px",
            padding: 0,
            border: `1px solid ${T.line2}`,
            borderRadius: "7px",
            background: "transparent",
            color: T.text3,
            cursor: "pointer",
            flex: "none"
          }
        },
        h(ActionIcon, { name: "archive", size: 13 })
      );
      const removeButton = h(
        "button",
        {
          type: "button",
          onClick: (event) => {
            event.stopPropagation();
            actionHandlers.onRemove(item);
          },
          disabled: executing,
          title: executing ? "AI \u6B63\u5728\u6267\u884C\uFF0C\u8BF7\u7B49\u5F85\u5B8C\u6210\u6216\u5148\u53D6\u6D88\u8FD0\u884C" : "\u4ECE\u4ED3\u5E93\u5220\u9664\u8FD9\u6761\u9700\u6C42\u8BB0\u5F55",
          "aria-label": `\u5220\u9664\u9700\u6C42\uFF1A${item.title}`,
          "data-remove": item.occurrenceKey ?? item.id,
          style: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "28px",
            height: "28px",
            padding: 0,
            border: `1px solid ${T.line2}`,
            borderRadius: "7px",
            background: "transparent",
            color: T.text3,
            cursor: "pointer",
            flex: "none"
          }
        },
        h(ActionIcon, { name: "trash", size: 13 })
      );
      const secondaryActions = h(
        "details",
        { onClick: (event) => event.stopPropagation(), style: { position: "relative", flex: "none" } },
        h("summary", { "aria-label": `\u66F4\u591A\u64CD\u4F5C\uFF1A${item.title}`, title: "\u66F4\u591A\u64CD\u4F5C", style: { cursor: "pointer", listStyle: "none", padding: "6px", color: T.text2, borderRadius: "6px" } }, h(ActionIcon, { name: "more", size: 16 })),
        h("div", { style: { display: "flex", gap: "6px", padding: "6px 0" } }, archiveButton, removeButton)
      );
      return h(
        "div",
        {
          role: "row",
          "data-req": key,
          style: {
            display: "grid",
            gridTemplateColumns: listColumns(narrow, mobile),
            columnGap: "14px",
            alignItems: "center",
            boxSizing: "border-box",
            minHeight: mobile ? "76px" : "80px",
            contentVisibility: "auto",
            containIntrinsicSize: `auto ${mobile ? 76 : 80}px`,
            padding: mobile ? "12px 14px" : "13px 18px",
            borderTop: `1px solid ${T.line}`,
            background: selected ? T.layer2 : "transparent",
            boxShadow: selected ? `inset 2px 0 0 ${T.brand}` : "none",
            cursor: "pointer",
            transition: REDUCE_MOTION ? "none" : "background-color 140ms ease"
          },
          "aria-selected": selected,
          onMouseEnter: (event) => {
            if (!selected) event.currentTarget.style.background = T.layer2;
          },
          onMouseLeave: (event) => {
            event.currentTarget.style.background = selected ? T.layer2 : "transparent";
          },
          onClick: open
        },
        h(
          "div",
          { role: "cell", style: { minWidth: 0 } },
          h(
            "div",
            { style: { display: "flex", alignItems: "baseline", gap: "8px", minWidth: 0 } },
            h(
              "button",
              {
                type: "button",
                onClick: (event) => {
                  event.stopPropagation();
                  open();
                },
                onMouseEnter: () => setHover(true),
                onMouseLeave: () => setHover(false),
                onFocus: () => setHover(true),
                onBlur: () => setHover(false),
                title: item.title,
                style: {
                  display: "block",
                  minWidth: 0,
                  maxWidth: "100%",
                  overflow: "hidden",
                  overflowWrap: "anywhere",
                  whiteSpace: "nowrap",
                  textOverflow: "ellipsis",
                  lineHeight: 1.5,
                  border: 0,
                  padding: 0,
                  background: "transparent",
                  color: T.text,
                  fontFamily: "inherit",
                  fontSize: "14px",
                  fontWeight: 600,
                  letterSpacing: "-.005em",
                  textAlign: "left",
                  cursor: "pointer",
                  textDecoration: hover ? "underline" : "none",
                  textUnderlineOffset: "3px",
                  outlineColor: T.brand
                }
              },
              item.title
            )
          ),
          h(
            "div",
            { style: { display: "flex", alignItems: "center", gap: "8px", minWidth: 0, marginTop: "5px", flexWrap: "wrap", overflowWrap: "anywhere" } },
            isDefect(item) ? h(DefectPill, null) : h("span", { style: { fontSize: "11px", color: T.text2, whiteSpace: "nowrap" } }, isChatSource(item) ? "\u{1F4AC} \u5BF9\u8BDD\u751F\u6210" : isFeedbackSource(item) ? "\u53CD\u9988" : "\u270D\uFE0F \u624B\u52A8\u521B\u5EFA"),
            h(
              "code",
              { style: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: "11.5px", color: T.text2 } },
              item.id
            ),
            h("span", { title: item.specConvergences?.length ? [...item.specConvergences].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0]?.evolutionNote || "\u9700\u6C42\u5DF2\u6F14\u8FDB" : "\u9700\u6C42\u7248\u672C", tabIndex: 0, style: Number(item.revision) > 1 ? { color: "#8bd5f5", background: "rgba(63,160,205,.14)", border: "1px solid rgba(106,190,225,.4)", borderRadius: "999px", padding: "1px 7px", fontSize: "11px", whiteSpace: "nowrap" } : { color: T.text3, fontSize: "11px" } }, `v${item.revision ?? 1}${Number(item.revision) > 1 ? " \xB7 \u5DF2\u6F14\u8FDB" : ""}`),
            item.pendingPatch ? h("span", { style: { color: T.warn, fontSize: "11px", fontWeight: 600 } }, "\u25CF \u5F85\u786E\u8BA4\u53D8\u66F4") : null,
            githubLinks?.devBranchUrl ? h(GitHubLinkButton, { href: githubLinks.devBranchUrl, compact: true, title: "\u5728 GitHub \u67E5\u770B\u5F00\u53D1\u5206\u652F" }, `\u{1F33F} ${githubLinks.devBranch ?? "develop"}`) : null,
            githubLinks?.mainBranchUrl && githubLinks.mainMergeCommitSha ? h(GitHubLinkButton, { href: githubLinks.mainBranchUrl, compact: true, title: "\u5728 GitHub \u67E5\u770B\u4E3B\u5E72\u5206\u652F" }, `\u2705 ${githubLinks.mainBranch ?? "main"}`) : null,
            defect?.impact?.stage ? h("span", { style: { color: T.text3, fontSize: "11px" } }, `\u5931\u8D25\u4E8E${defectStageText(item)}`) : null,
            defect && occurrences > 1 ? h("span", { style: { color: T.text2, fontSize: "11px", fontVariantNumeric: "tabular-nums" } }, `\xD7${occurrences}`) : null,
            defect?.regressionSuspected ? h("span", { style: { color: T.warn, fontSize: "11px" } }, "\u7591\u4F3C\u56DE\u5F52") : null,
            showProject && item.projectName ? h("span", { style: { color: T.text3, fontSize: "11px" } }, item.projectName) : null,
            mobile ? h(DeliveryPill, { item }) : null,
            mobile && check.label !== "\u5F85\u9A8C\u8BC1" ? h(
              "span",
              { style: { display: "inline-flex", alignItems: "center", gap: "5px", color: check.tone === "neutral" ? T.text2 : checkToneColor(check.tone), fontSize: "11.5px", fontWeight: 500 } },
              h("span", { style: { width: "6px", height: "6px", borderRadius: "50%", background: checkToneColor(check.tone), flex: "none" } }),
              check.label
            ) : null
          ),
          anomaly ? h(
            "div",
            { style: { marginTop: "3px", color: T.err, fontSize: "11.5px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } },
            anomaly
          ) : item.duplicateCount > 1 ? null : null
        ),
        mobile ? null : h("div", { role: "cell", style: listCell() }, h(DeliveryPill, { item })),
        narrow || mobile ? null : h(
          "div",
          { role: "cell", style: listCell({ color: item.owner ? T.text2 : T.text3, fontSize: "12.5px" }) },
          item.owner || "\u672A\u5206\u914D"
        ),
        narrow || mobile ? null : h(
          "div",
          {
            role: "cell",
            style: listCell({ color: (item.verifiedBy?.length ?? 0) > 0 ? T.text2 : T.text3, fontSize: "12.5px" }),
            title: "\u9700\u6C42\u4E2D\u7684\u9A8C\u6536\u6807\u51C6\u6570\u91CF"
          },
          acceptanceLabel(item)
        ),
        mobile ? h(
          "div",
          { role: "cell", style: listCell({ justifyContent: "flex-end", gap: "6px" }) },
          actionButton,
          secondaryActions
        ) : h(
          "div",
          { role: "cell", style: listCell({ flexDirection: "column", alignItems: "flex-start", gap: "2px" }) },
          h("span", { title: "\u6700\u8FD1\u66F4\u65B0", style: { color: T.text2, fontSize: "12px", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } }, item.updatedAt || item.createdAt ? formatLocalStamp(item.updatedAt ?? item.createdAt).slice(0, 16) : "\u2014"),
          check.label !== "\u5F85\u9A8C\u8BC1" && ["verified", "failed"].includes(decision?.state) ? h("span", { style: { color: checkToneColor(check.tone), fontSize: "11px" } }, check.label) : null
        ),
        mobile ? null : h("div", { role: "cell", style: listCell({ justifyContent: "flex-end", gap: "6px" }) }, actionButton, secondaryActions)
      );
    }
    function RequirementTable({ items, narrow, mobile, showProject, selectedKey, onOpen, onAiReview, onAcceptance, onArchive, onRemove, duplicateCounts, emptyNode, stickyTop = 0, contained = false, onDefect }) {
      const columns = listColumns(narrow, mobile);
      const actionHandlers = { onOpen, onAiReview, onAcceptance, onArchive, onRemove, onDefect };
      const headerCell = (label, extra) => h(
        "div",
        { role: "columnheader", style: { minWidth: 0, fontSize: "11px", color: T.text3, fontWeight: 500, letterSpacing: ".02em", ...extra } },
        label
      );
      return h(
        "div",
        {
          role: "table",
          "aria-label": "\u9700\u6C42\u5217\u8868",
          style: contained ? { overflow: "visible" } : { border: `1px solid ${T.line}`, borderRadius: "12px", background: T.layer, overflow: "visible" }
        },
        h(
          "div",
          {
            role: "row",
            style: {
              display: "grid",
              gridTemplateColumns: columns,
              columnGap: "14px",
              alignItems: "center",
              padding: mobile ? "9px 14px" : "9px 18px",
              background: contained ? T.layer : T.base,
              borderBottom: `1px solid ${T.line}`,
              borderTopLeftRadius: contained ? 0 : "12px",
              borderTopRightRadius: contained ? 0 : "12px",
              position: "sticky",
              top: `${stickyTop}px`,
              zIndex: 15
            }
          },
          headerCell("\u9700\u6C42"),
          mobile ? null : headerCell("\u4EA4\u4ED8\u72B6\u6001"),
          narrow || mobile ? null : headerCell("\u8D1F\u8D23\u4EBA"),
          narrow || mobile ? null : headerCell("\u9A8C\u6536\u6807\u51C6"),
          mobile ? null : headerCell("\u6700\u8FD1\u66F4\u65B0"),
          headerCell("\u64CD\u4F5C", { textAlign: "right" })
        ),
        items.length > 0 ? items.map(
          (item) => h(RequirementRow, {
            key: item.occurrenceKey ?? item.id,
            item,
            narrow,
            mobile,
            showProject,
            duplicateCounts,
            actionHandlers,
            selected: selectedKey === (item.occurrenceKey ?? item.id)
          })
        ) : emptyNode ?? null
      );
    }
    function SkeletonTable({ narrow, mobile }) {
      const columns = listColumns(narrow, mobile);
      const row2 = (index) => h(
        "div",
        {
          key: index,
          style: { display: "grid", gridTemplateColumns: columns, columnGap: "14px", alignItems: "center", minHeight: mobile ? "76px" : "80px", padding: mobile ? "12px 14px" : "13px 18px", boxSizing: "border-box", borderTop: `1px solid ${T.line}` }
        },
        h(
          "div",
          null,
          h("div", { style: { width: `${48 + index * 17 % 30}%`, height: "12px", borderRadius: "5px", background: T.layer2 } }),
          h("div", { style: { width: "110px", height: "9px", borderRadius: "4px", background: T.layer2, marginTop: "8px" } })
        ),
        mobile ? null : h("div", { style: { width: "58px", height: "18px", borderRadius: "999px", background: T.layer2 } }),
        narrow || mobile ? null : h("div", { style: { width: "46px", height: "10px", borderRadius: "4px", background: T.layer2 } }),
        narrow || mobile ? null : h("div", { style: { width: "34px", height: "10px", borderRadius: "4px", background: T.layer2 } }),
        mobile ? null : h("div", { style: { width: "72px", height: "18px", borderRadius: "999px", background: T.layer2 } }),
        h("div", { style: { justifySelf: "end", width: "46px", height: "22px", borderRadius: "6px", background: T.layer2 } })
      );
      return h(
        "div",
        { "aria-busy": "true", "aria-label": "\u6B63\u5728\u8BFB\u53D6\u9700\u6C42", style: { border: `1px solid ${T.line}`, borderRadius: "12px", background: T.layer, overflow: "hidden" } },
        h("div", { style: { height: "35px", borderBottom: `1px solid ${T.line}`, background: T.base } }),
        [0, 1, 2, 3, 4, 5, 6, 7].map(row2)
      );
    }
    function NoResults({ filter, keyword, source, onClear }) {
      return h(
        "div",
        { style: { textAlign: "center", padding: "54px 24px" } },
        h("p", { style: { margin: 0, color: T.text, fontSize: "14px", fontWeight: 600 } }, "\u6CA1\u6709\u7B26\u5408\u6761\u4EF6\u7684\u9700\u6C42"),
        h(
          "p",
          { style: { margin: "7px 0 18px", color: T.text2, fontSize: "12.5px" } },
          [filter !== "all" ? `\u89C6\u56FE\uFF1A${(FILTERS.find(([id]) => id === filter) ?? [])[1] ?? filter}` : null, source && source !== "all" ? `\u6765\u6E90\uFF1A${(SOURCE_FILTERS.find(([id]) => id === source) ?? [])[1] ?? source}` : null, keyword ? `\u641C\u7D22\uFF1A${keyword}` : null].filter(Boolean).join(" \xB7 ") || "\u5F53\u524D\u7B5B\u9009\u4E0B\u6CA1\u6709\u8BB0\u5F55\u3002"
        ),
        h(
          "button",
          {
            type: "button",
            onClick: onClear,
            style: { border: `1px solid ${T.line2}`, background: T.layer2, color: T.text, borderRadius: "8px", padding: "6px 12px", fontSize: "12px", cursor: "pointer" }
          },
          "\u6E05\u9664\u7B5B\u9009"
        )
      );
    }
    function AnomalyNotice({ anomalies, summary, expanded, anomalyOnly, onToggleExpanded, onToggleOnly, onOpen }) {
      const list = anomalies ?? [];
      if (list.length === 0) return null;
      const records = /* @__PURE__ */ new Set();
      for (const anomaly of list) {
        for (const occurrence of anomaly.occurrences ?? []) {
          records.add(occurrence.occurrenceKey ?? occurrence.assetId ?? occurrence.id ?? occurrence.file ?? JSON.stringify(occurrence));
        }
      }
      const counts = summary ?? {};
      const breakdown = [
        counts.duplicateId ? `\u9700\u6C42 ID \u91CD\u590D ${counts.duplicateId} \u7EC4` : null,
        counts.duplicateBusinessId ? `\u4E1A\u52A1\u7F16\u53F7\u91CD\u590D ${counts.duplicateBusinessId} \u7EC4` : null,
        counts.dangling ? `\u60AC\u7A7A\u5173\u7CFB ${counts.dangling} \u7EC4` : null
      ].filter(Boolean).join(" \xB7 ");
      return h(
        "section",
        {
          "aria-label": "\u6570\u636E\u5F02\u5E38\u63D0\u793A",
          style: { margin: "0 0 8px", border: `1px solid ${T.line}`, borderLeft: `3px solid ${T.err}`, borderRadius: "10px", background: "rgba(255,139,139,.055)", padding: "7px 12px" }
        },
        h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" } },
          h(ActionIcon, { name: "alert", size: 15 }),
          h(
            "div",
            {
              style: { minWidth: 0, flex: 1, display: "flex", alignItems: "baseline", gap: "8px", overflow: "hidden", whiteSpace: "nowrap" },
              title: "\u4FDD\u7559\u5168\u90E8\u8BB0\u5F55\uFF0C\u4E0D\u81EA\u52A8\u5408\u5E76\uFF1B\u6253\u5F00\u8BB0\u5F55\u4EBA\u5DE5\u6838\u5BF9\u3002"
            },
            h("span", { style: { color: T.text, fontSize: "12.5px", fontWeight: 500, flex: "none" } }, `\u53D1\u73B0 ${list.length} \u7EC4\u6570\u636E\u5F02\u5E38\uFF0C\u6D89\u53CA ${records.size} \u6761\u8BB0\u5F55`),
            breakdown ? h("span", { style: { color: T.text2, fontSize: "11.5px", overflow: "hidden", textOverflow: "ellipsis" } }, breakdown) : null
          ),
          h(
            "button",
            {
              type: "button",
              onClick: onToggleOnly,
              "aria-pressed": anomalyOnly,
              style: {
                border: `1px solid ${anomalyOnly ? "rgba(255,139,139,.45)" : T.line}`,
                background: anomalyOnly ? "rgba(255,139,139,.12)" : "transparent",
                color: anomalyOnly ? T.err : T.text2,
                borderRadius: "7px",
                padding: "5px 10px",
                fontSize: "11.5px",
                cursor: "pointer"
              }
            },
            anomalyOnly ? "\u663E\u793A\u5168\u90E8" : "\u53EA\u770B\u5F02\u5E38"
          ),
          h(
            "button",
            {
              type: "button",
              onClick: onToggleExpanded,
              "aria-expanded": expanded,
              style: { border: `1px solid ${T.line}`, background: "transparent", color: T.text2, borderRadius: "7px", padding: "5px 10px", fontSize: "11.5px", cursor: "pointer" }
            },
            expanded ? "\u6536\u8D77\u539F\u56E0" : "\u67E5\u770B\u539F\u56E0"
          )
        ),
        expanded ? h(
          "div",
          { style: { marginTop: "10px", borderTop: `1px solid ${T.line}`, paddingTop: "8px", display: "flex", flexDirection: "column", gap: "8px" } },
          list.map(
            (anomaly, index) => h(
              "div",
              { key: `${anomaly.kind}-${index}`, style: { fontSize: "12px", color: T.text2, lineHeight: 1.7 } },
              h("span", { style: { color: T.err, marginRight: "7px", fontSize: "11px" } }, ANOMALY_LABELS[anomaly.kind] ?? anomaly.kind),
              anomaly.message,
              (anomaly.occurrences ?? []).length ? h(
                "div",
                { style: { display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "3px" } },
                anomaly.occurrences.map(
                  (occurrence, occurrenceIndex) => h(
                    "button",
                    {
                      type: "button",
                      key: `${occurrence.occurrenceKey ?? occurrenceIndex}-${occurrenceIndex}`,
                      onClick: () => onOpen?.(occurrence),
                      style: { border: 0, padding: 0, background: "transparent", color: T.brand, fontSize: "11.5px", cursor: "pointer" }
                    },
                    `${occurrence.assetId ?? occurrence.id ?? occurrence.occurrenceKey ?? "\u2014"}${occurrence.title ? ` \xB7 ${occurrence.title}` : ""}`
                  )
                )
              ) : null
            )
          )
        ) : null
      );
    }
    function CheckNotice({ data, expanded, onToggleExpanded }) {
      if (!data) return null;
      const failedProjects = (data.projects ?? []).filter((project) => project.error);
      const gaps = data.gaps ?? [];
      const executionFailed = failedProjects.length > 0 || data.summary?.failed > 0;
      const gateFailed = data.result && data.result !== "pass";
      if (!executionFailed && gaps.length === 0) return null;
      const tone = executionFailed ? T.err : T.warn;
      const title = executionFailed ? `\u68C0\u67E5\u6267\u884C\u5931\u8D25\uFF1A${failedProjects.length || data.summary?.failed || 0} \u4E2A\u5DE5\u4F5C\u533A\u65E0\u6CD5\u8BFB\u53D6` : `\u68C0\u67E5\u672A\u901A\u8FC7\uFF1A${gaps.length} \u4E2A\u95E8\u7981\u7F3A\u53E3`;
      const detail = executionFailed ? "\u8FD9\u662F\u8BFB\u53D6\u6216\u6267\u884C\u5931\u8D25\uFF0C\u4E0D\u662F\u9700\u6C42\u672A\u901A\u8FC7\uFF1B\u4FEE\u590D\u540E\u91CD\u65B0\u68C0\u67E5\u3002" : "\u9700\u6C42\u6587\u4EF6\u5DF2\u8BFB\u53D6\uFF0C\u95E8\u7981\u89C4\u5219\u672A\u5168\u90E8\u901A\u8FC7\uFF1B\u5C55\u5F00\u67E5\u770B\u89C4\u5219\u4E0E\u4FEE\u590D\u5EFA\u8BAE\u3002";
      return h(
        "section",
        {
          "aria-label": "\u68C0\u67E5\u7ED3\u679C\u63D0\u793A",
          style: { margin: "0 0 8px", border: `1px solid ${T.line}`, borderLeft: `3px solid ${tone}`, borderRadius: "10px", background: T.layer, padding: "7px 12px" }
        },
        h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" } },
          h("span", { style: { width: "7px", height: "7px", borderRadius: "50%", background: tone, flex: "none" } }),
          h(
            "div",
            { style: { minWidth: 0, flex: 1, display: "flex", alignItems: "baseline", gap: "8px", overflow: "hidden", whiteSpace: "nowrap" }, title: detail },
            h("span", { style: { color: T.text, fontSize: "12.5px", fontWeight: 500, flex: "none" } }, title),
            h("span", { style: { color: T.text2, fontSize: "11.5px", overflow: "hidden", textOverflow: "ellipsis" } }, executionFailed ? "\u8BFB\u53D6\u5931\u8D25\u540E\u91CD\u8BD5\uFF0C\u4E0D\u4EE3\u8868\u9700\u6C42\u672A\u901A\u8FC7" : "\u5C55\u5F00\u67E5\u770B\u89C4\u5219\u4E0E\u4FEE\u590D\u5EFA\u8BAE")
          ),
          executionFailed || gaps.length > 0 ? h(
            "button",
            {
              type: "button",
              onClick: onToggleExpanded,
              "aria-expanded": expanded,
              style: { border: `1px solid ${T.line}`, background: "transparent", color: T.text2, borderRadius: "7px", padding: "5px 10px", fontSize: "11.5px", cursor: "pointer" }
            },
            expanded ? "\u6536\u8D77" : "\u67E5\u770B\u539F\u56E0"
          ) : null
        ),
        expanded ? h(
          "div",
          { style: { marginTop: "9px", borderTop: `1px solid ${T.line}`, paddingTop: "4px" } },
          failedProjects.map(
            (project) => h(
              "div",
              { key: project.project, style: { padding: "5px 0", fontSize: "12px", color: T.text2 } },
              h("b", { style: { color: T.text } }, project.projectName ?? project.project),
              `\uFF1A${project.error}`
            )
          ),
          gaps.length ? h("div", { style: { border: `1px solid ${T.line}`, borderRadius: "9px", padding: "2px 10px", marginTop: "4px" } }, gaps.map((gap, index) => h(GapDetail, { key: `${gap.project ?? ""}-${gap.rule ?? gap.code}-${index}`, gap, index }))) : null
        ) : null
      );
    }
    function renderBrief(text) {
      if (!text) return null;
      const blocks = [];
      let list = null;
      const flush = () => {
        if (!list) return;
        blocks.push(
          h(
            "ul",
            { key: `ul-${blocks.length}`, style: { margin: "2px 0 8px", paddingLeft: "18px", color: T.text2, fontSize: "13px", lineHeight: 1.85 } },
            list
          )
        );
        list = null;
      };
      text.split(/\r?\n/).forEach((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) {
          flush();
          return;
        }
        if (trimmed.startsWith("- ")) {
          if (!list) list = [];
          list.push(h("li", { key: index }, trimmed.slice(2)));
          return;
        }
        flush();
        const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
        if (heading) {
          if (heading[1].length === 1) return;
          blocks.push(
            h(
              "div",
              { key: index, style: { margin: "14px 0 6px", fontSize: "13px", fontWeight: 600, color: T.text } },
              heading[2]
            )
          );
          return;
        }
        blocks.push(h("p", { key: index, style: { margin: "0 0 6px", color: T.text2, fontSize: "13px", lineHeight: 1.85 } }, trimmed));
      });
      flush();
      return h("div", null, blocks);
    }
    function Section({ title, action, children, style }) {
      return h(
        "div",
        { style },
        h("div", { style: sectionTitle }, title, action ?? null),
        children
      );
    }
    function GithubBlock({ item, projectMeta }) {
      const projectName = projectMeta?.name ?? item.projectName ?? item.project ?? "\u672A\u5F52\u5C5E\u9879\u76EE";
      const repo = item.github?.repo ?? projectMeta?.repo ?? "\u2014";
      if (!item.github) {
        return h(
          "div",
          {
            style: {
              border: `1px dashed ${T.line2}`,
              borderRadius: "10px",
              padding: "12px 14px",
              fontSize: "12.5px",
              color: T.text2,
              lineHeight: 1.8
            }
          },
          h("div", null, "\u5C1A\u672A\u5EFA\u7ACB GitHub \u5F52\u5C5E\uFF1A\u9700\u6C42 Issue\u3001\u4EFB\u52A1\u5B50\u8BAE\u9898\u4E0E\u770B\u677F\u6761\u76EE\u4F1A\u5728\u300C\u4EA4\u7ED9 AI \u63A8\u8FDB\u300D\u65F6\u6309\u9879\u76EE\u914D\u7F6E\u521B\u5EFA\u3002"),
          h("div", { style: { ...muted, marginTop: "6px" } }, `${projectName} \xB7 ${repo}${projectMeta?.board ? ` \xB7 ProjectV2 #${projectMeta.board}` : ""}`)
        );
      }
      const labels = item.github.labels ?? [];
      const board = item.github.board;
      return h(
        "div",
        { style: { border: `1px solid ${T.line}`, borderRadius: "10px", overflow: "hidden" } },
        [
          ["\u4ED3\u5E93", h("span", { style: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "11.5px" } }, repo)],
          [
            "\u9700\u6C42 Issue",
            h(
              "span",
              null,
              item.github.url ? h("a", { href: item.github.url, target: "_blank", rel: "noreferrer", style: { color: T.brand } }, `#${item.github.issue}`) : `#${item.github.issue}`,
              ` \xB7 [${item.id}] ${item.title}`
            )
          ],
          ["\u6807\u7B7E", h("span", { style: { display: "flex", gap: "6px", flexWrap: "wrap" } }, labels.map((label) => h(Chip, { key: label }, label)))],
          [
            "\u770B\u677F",
            h(
              "span",
              null,
              board ? `ProjectV2 #${board.number}` : "\u672A\u914D\u7F6E\u770B\u677F",
              board?.status ? h("span", { style: { marginLeft: "8px", color: T.ok } }, `\xB7 ${board.status}`) : null
            )
          ],
          [
            "\u4EFB\u52A1\u5B50\u8BAE\u9898",
            h(
              "span",
              null,
              (item.github.tasks ?? []).length ? item.github.tasks.map((task) => `#${task.number}`).join(" \xB7 ") : "\u5C1A\u672A\u521B\u5EFA\uFF08\u4EA4\u7ED9 AI \u63A8\u8FDB\u65F6\u751F\u6210\uFF09",
              item.github.tasks?.length ? h("span", { style: { ...muted, marginLeft: "6px" } }, `\uFF08parent #${item.github.issue}\uFF09`) : null
            )
          ],
          [
            "PR / \u4EA4\u4ED8",
            h("span", { style: muted }, "\u5C1A\u672A\u5173\u8054 PR\uFF1BPR \u6A21\u677F\u8981\u6C42\u586B\u5199\u9879\u76EE / \u9700\u6C42 Issue / \u53D8\u66F4 / \u770B\u677F\u72B6\u6001")
          ]
        ].map(
          ([label, value], index) => h("div", { key: label, style: { ...row, borderBottom: index === 5 ? "none" : `1px solid ${T.line}` } }, h("span", { style: rowLabel }, label), h("span", { style: { color: T.text, minWidth: 0 } }, value))
        )
      );
    }
    function relationsOf(item, allItems) {
      const groups = [
        ["\u4E0A\u7EA7", []],
        ["\u5B50\u9700\u6C42", []],
        ["\u9A8C\u6536", []],
        ["\u4F9D\u8D56", []],
        ["\u7EA6\u675F", []],
        ["\u5206\u914D\u5230", []]
      ];
      const byLabel = Object.fromEntries(groups);
      for (const other of allItems ?? []) {
        if (other.id === item.id) continue;
        if ((other.links ?? []).some((link) => link.type === "parent_of" && link.target === item.id)) byLabel["\u4E0A\u7EA7"].push(other.id);
      }
      for (const link of item.links ?? []) {
        const label = REL_LABELS[link.type] ?? link.type;
        if (label === "\u5B50\u9700\u6C42") byLabel["\u5B50\u9700\u6C42"].push(link.target);
        else if (label === "\u9A8C\u6536") byLabel["\u9A8C\u6536"].push(link.target);
        else if (label === "\u4F9D\u8D56") byLabel["\u4F9D\u8D56"].push(link.target);
        else if (label === "\u7EA6\u675F") byLabel["\u7EA6\u675F"].push(link.target);
        else if (label === "\u5206\u914D\u5230") byLabel["\u5206\u914D\u5230"].push(link.target);
        else if (!byLabel[label]) byLabel[label] = [link.target];
      }
      return groups.filter(([, items]) => items.length > 0);
    }
    function Attachments({ item }) {
      const files = item.attachmentFiles ?? [];
      if (files.length === 0) return h("p", { style: { ...muted, margin: "4px 0 0" } }, "\u65E0\u9644\u4EF6");
      return h(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "4px", marginTop: "6px" } },
        files.map(
          (file) => h(
            "div",
            {
              key: file.name,
              style: {
                display: "flex",
                justifyContent: "space-between",
                gap: "10px",
                border: `1px solid ${T.line}`,
                borderRadius: "8px",
                padding: "6px 10px",
                fontSize: "12px",
                color: T.text2
              }
            },
            h("span", null, file.name),
            h("span", { style: { color: T.text3 } }, file.kind ?? "\u9644\u4EF6")
          )
        )
      );
    }
    function TraceLink({ onClick }) {
      return h(
        "button",
        { style: { border: 0, background: "transparent", color: T.text2, padding: 0, fontSize: "11.5px", cursor: "pointer" }, onClick },
        "\u67E5\u770B\u8FFD\u6EAF\u56FE \u203A"
      );
    }
    function GroupCard({ title, hint, accent, children }) {
      return h(
        "section",
        {
          style: {
            marginTop: "14px",
            border: `1px solid ${T.line}`,
            borderLeft: `2px solid ${accent}`,
            borderRadius: "12px",
            background: T.layer,
            padding: "13px 16px 15px"
          }
        },
        h(
          "div",
          { style: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "10px", marginBottom: "10px" } },
          h("div", { style: { fontSize: "12.5px", fontWeight: 600, color: T.text2, letterSpacing: ".01em" } }, title),
          hint ?? null
        ),
        children
      );
    }
    function SubBlock({ title, action, children, first = false }) {
      return h(
        "div",
        { style: { marginTop: first ? 0 : 12, paddingTop: first ? 0 : 12, borderTop: first ? 0 : `1px solid ${T.line}` } },
        h(
          "div",
          { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: "7px" } },
          h("span", { style: { fontSize: "10.5px", letterSpacing: ".08em", textTransform: "uppercase", color: T.text3 } }, title),
          action ?? null
        ),
        children
      );
    }
    function MetaChip({ children, color }) {
      return h(
        "span",
        {
          style: {
            border: `1px solid ${T.line}`,
            borderRadius: "999px",
            padding: "1px 9px",
            fontSize: "11.5px",
            color: color ?? T.text2,
            background: T.layer2,
            whiteSpace: "nowrap"
          }
        },
        children
      );
    }
    const ICON_PATHS = {
      sparkles: "M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7z",
      play: "M8 5v14l11-7z",
      check: "M20 6L9 17l-5-5",
      flask: "M9 3h6M10 3v5l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3",
      eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z M12 9a3 3 0 100 6 3 3 0 000-6z",
      close: "M6 6l12 12M18 6L6 18",
      search: "M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16M16.65 16.65 21 21",
      refresh: "M20 11a8 8 0 10-2.3 5.7M20 5v6h-6",
      more: "M5 12h.01M12 12h.01M19 12h.01",
      plus: "M12 5v14M5 12h14",
      chevron: "M9 6l6 6-6 6",
      folder: "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z",
      link: "M10 13a5 5 0 007 0l2-2a5 5 0 00-7-7l-1 1M14 11a5 5 0 00-7 0l-2 2a5 5 0 007 7l1-1",
      alert: "M12 3l9 16H3zM12 9v5M12 17h.01",
      archive: "M4 7h16M6 7v12a1 1 0 001 1h10a1 1 0 001-1V7M9 7V4h6v3M12 11v5M9.5 13.5L12 16l2.5-2.5",
      message: "M21 11.5a8.5 8.5 0 0 1-8.5 8.5H7l-4 3v-4.6A8.5 8.5 0 0 1 11.5 3h1A8.5 8.5 0 0 1 21 11.5z",
      download: "M12 4v11M7 11l5 5 5-5M4 20h16"
    };
    function ActionIcon({ name, size = 14 }) {
      return h(
        "svg",
        { width: size, height: size, style: { flexShrink: 0 }, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" },
        h("path", { d: ICON_PATHS[name] ?? ICON_PATHS.sparkles })
      );
    }
    function ActionButton({ label, icon, onClick, variant = "secondary", disabled = false, title, ...rest }) {
      const variants = {
        primary: { background: T.text, color: T.base, borderColor: "transparent" },
        secondary: { background: T.layer2, color: T.text, borderColor: T.line2 },
        ghost: { background: "transparent", color: T.text2, borderColor: T.line2 },
        accent: { background: "rgba(231,176,75,.12)", color: T.warn, borderColor: "rgba(231,176,75,.32)" }
      };
      return h(
        "button",
        {
          type: "button",
          title: title ?? label,
          disabled,
          onClick,
          ...rest,
          style: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
            padding: "7px 12px",
            borderRadius: "8px",
            border: "1px solid",
            fontSize: "12px",
            fontWeight: 500,
            lineHeight: 1.4,
            whiteSpace: "nowrap",
            cursor: disabled ? "default" : "pointer",
            opacity: disabled ? 0.5 : 1,
            ...variants[variant] ?? variants.secondary
          }
        },
        icon ? h(ActionIcon, { name: icon }) : null,
        label
      );
    }
    function renderInline(text, prefix) {
      const source = String(text ?? "");
      const nodes = [];
      const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^\s)]+)\))/g;
      let last = 0;
      let match = pattern.exec(source);
      let index = 0;
      while (match !== null) {
        if (match.index > last) nodes.push(source.slice(last, match.index));
        const token = match[0];
        if (token.startsWith("**")) {
          nodes.push(h("b", { key: `${prefix}-b-${index}`, style: { color: T.text, fontWeight: 600 } }, token.slice(2, -2)));
        } else if (token.startsWith("`")) {
          nodes.push(
            h(
              "code",
              {
                key: `${prefix}-c-${index}`,
                style: {
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: "11.5px",
                  background: T.layer2,
                  borderRadius: "4px",
                  padding: "0 3px",
                  color: T.text
                }
              },
              token.slice(1, -1)
            )
          );
        } else {
          const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(token);
          nodes.push(h("a", { key: `${prefix}-a-${index}`, href: link[2], target: "_blank", rel: "noreferrer", style: { color: T.brand } }, link[1]));
        }
        last = match.index + token.length;
        index += 1;
        match = pattern.exec(source);
      }
      if (last < source.length) nodes.push(source.slice(last));
      return nodes;
    }
    function renderRich(text) {
      const lines = String(text ?? "").replace(/<!--\s*alm:meta\b[\s\S]*?-->/g, "").split(/\r?\n/);
      const blocks = [];
      let list = null;
      let ordered = false;
      const flush = () => {
        if (!list) return;
        blocks.push(
          h(
            ordered ? "ol" : "ul",
            { key: `list-${blocks.length}`, style: { margin: "2px 0 8px", paddingLeft: "18px", color: T.text2, fontSize: "12.5px", lineHeight: 1.7 } },
            list
          )
        );
        list = null;
      };
      lines.forEach((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) {
          flush();
          return;
        }
        const orderedMatch = /^(\d+)\.\s+(.*)$/.exec(trimmed);
        if (orderedMatch) {
          if (!list || !ordered) {
            flush();
            ordered = true;
            list = [];
          }
          list.push(h("li", { key: `o-${index}` }, renderInline(orderedMatch[2], `oli-${index}`)));
          return;
        }
        if (/^[-*]\s+/.test(trimmed)) {
          if (!list || ordered) {
            flush();
            ordered = false;
            list = [];
          }
          list.push(h("li", { key: `u-${index}` }, renderInline(trimmed.replace(/^[-*]\s+/, ""), `li-${index}`)));
          return;
        }
        flush();
        if (trimmed.startsWith(">")) {
          blocks.push(
            h(
              "blockquote",
              { key: `q-${index}`, style: { margin: "4px 0 8px", padding: "2px 0 2px 10px", borderLeft: `2px solid ${T.line2}`, color: T.text2, fontSize: "12.5px", lineHeight: 1.7 } },
              renderInline(trimmed.replace(/^>\s?/, ""), `q-${index}`)
            )
          );
          return;
        }
        const heading = /^(#{2,6})\s+(.*)$/.exec(trimmed);
        if (heading) {
          blocks.push(h("div", { key: `h-${index}`, style: { margin: "10px 0 4px", fontSize: "12px", fontWeight: 600, color: T.text } }, renderInline(heading[2], `h-${index}`)));
          return;
        }
        blocks.push(h("p", { key: `p-${index}`, style: { margin: "0 0 6px", color: T.text2, fontSize: "12.5px", lineHeight: 1.75 } }, renderInline(trimmed, `p-${index}`)));
      });
      flush();
      return blocks;
    }
    function renderBrief(text) {
      return h("div", null, renderRich(text));
    }
    const BRIEF_SECTION_TITLES = /^(背景|目标|范围|验收|约束|风险|备注|原始诉求|AI|评审|重构|建议|决策)/;
    const BRIEF_INLINE_TITLES = /^(背景|目标|范围|验收标准|验收|约束|风险|备注|原始诉求|用户诉求)$/;
    function peelInlineLabels(text, title) {
      const out = [];
      String(text ?? "").split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim();
        const match = /^(背景|目标|范围|验收标准|验收|约束|风险|备注)[:：]\s*(.*)$/.exec(trimmed);
        if (!match) {
          out.push(line);
          return;
        }
        if (match[1] === title) {
          if (match[2]) out.push(match[2]);
          return;
        }
        out.push(`**${match[1]}**`);
        if (match[2]) out.push(match[2]);
      });
      return out.join("\n").trim();
    }
    function briefSections(text) {
      const lines = String(text ?? "").split(/\r?\n/);
      const sections = [];
      let current = null;
      const startSection = (title) => {
        current = { title, body: [] };
        sections.push(current);
      };
      lines.forEach((line) => {
        const trimmed = line.trim();
        const heading = /^##\s+(.+)$/.exec(trimmed);
        if (heading) {
          startSection(heading[1].trim());
          return;
        }
        if (/^#\s+/.test(trimmed)) return;
        if (BRIEF_INLINE_TITLES.test(trimmed)) {
          startSection(trimmed);
          return;
        }
        if (!current) {
          if (!trimmed) return;
          startSection("\u539F\u59CB\u8BC9\u6C42");
        }
        current.body.push(line);
      });
      return sections.map((section) => ({ title: section.title, text: peelInlineLabels(section.body.join("\n"), section.title) })).filter((section) => section.text || BRIEF_SECTION_TITLES.test(section.title));
    }
    function isAiSection(section) {
      return /AI|评审|重构|建议/.test(section.title) || /(^|\n)\s*>?\s*AI (结论|评审|建议)/.test(section.text);
    }
    function compactBody(text) {
      return String(text ?? "").replace(/\s+/g, " ").trim();
    }
    function CopyTextButton({ value, label = "\u590D\u5236" }) {
      const [copied, setCopied] = useState(false);
      const [failed, setFailed] = useState(false);
      const manualRef = useRef(null);
      const copy = async () => {
        const text = String(value ?? "");
        let success = false;
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            success = true;
          }
        } catch {
        }
        if (!success) {
          const previous = document.activeElement;
          const input2 = document.createElement("textarea");
          input2.value = text;
          input2.setAttribute("aria-label", "\u5F85\u590D\u5236\u5185\u5BB9");
          input2.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0";
          (previous?.closest('[role="dialog"]') ?? document.body).appendChild(input2);
          input2.select();
          try {
            success = document.execCommand("copy");
          } catch {
            success = false;
          }
          input2.remove();
          previous?.focus?.();
        }
        setFailed(!success);
        setCopied(success);
        if (success) window.setTimeout(() => setCopied(false), 1600);
      };
      useEffect(() => {
        if (failed) {
          manualRef.current?.focus();
          manualRef.current?.select();
        }
      }, [failed]);
      return h(
        "span",
        { style: { display: "inline-flex", alignItems: "center", gap: "5px", flexWrap: "wrap" } },
        h(
          "button",
          { type: "button", onClick: copy, title: copied ? "\u5DF2\u590D\u5236" : `${label}\u5230\u526A\u8D34\u677F`, style: { border: 0, background: "transparent", color: copied ? T.ok : T.text3, fontSize: "10.5px", cursor: "pointer", padding: "0 2px", flex: "none" } },
          copied ? "\u5DF2\u590D\u5236" : label
        ),
        copied ? h("span", { role: "status", style: { fontSize: "11px", color: T.ok } }, "\u590D\u5236\u6210\u529F") : null,
        failed ? h("span", { role: "alert", style: { fontSize: "11px", color: T.warn } }, "\u81EA\u52A8\u590D\u5236\u53D7\u9650\uFF0C\u8BF7\u6309 Ctrl+C\uFF1A", h("input", { ref: manualRef, readOnly: true, value: String(value ?? ""), "aria-label": "\u624B\u52A8\u590D\u5236\u5185\u5BB9", style: { width: "150px", color: T.text, background: T.layer, border: `1px solid ${T.line}` } })) : null
      );
    }
    const DETAIL_CARD = {
      background: T.layer,
      border: `1px solid ${T.line}`,
      borderRadius: "10px",
      padding: "12px 14px",
      marginBottom: "12px",
      minWidth: 0
    };
    const DETAIL_TITLE = { margin: 0, fontSize: "12px", fontWeight: 600, color: T.text, letterSpacing: ".01em" };
    const DETAIL_SUB = { margin: 0, fontSize: "11px", color: T.text3 };
    const DETAIL_ROW = { display: "flex", alignItems: "baseline", gap: "8px", padding: "3px 0", fontSize: "12px", minWidth: 0 };
    const DETAIL_LABEL = { flex: "none", width: "68px", color: T.text3, fontSize: "11.5px" };
    function DetailRow({ label, children }) {
      return h("div", { style: DETAIL_ROW }, h("span", { style: DETAIL_LABEL }, label), h("span", { style: { color: T.text, minWidth: 0, wordBreak: "break-word" } }, children));
    }
    function DetailsToggle({ summary, children, defaultOpen = false }) {
      return h(
        "details",
        { style: { borderTop: `1px solid ${T.line}`, marginTop: "8px", paddingTop: "8px" }, open: defaultOpen },
        h("summary", { style: { cursor: "pointer", color: T.text2, fontSize: "11.5px", lineHeight: 1.7 } }, summary),
        h("div", { style: { marginTop: "6px" } }, children)
      );
    }
    let warnedFallbackDetailView = false;
    function detailTitleId(item) {
      return `req-detail-title-${String(item?.occurrenceKey ?? item?.id ?? "detail").replace(/[^A-Za-z0-9_-]/g, "-")}`;
    }
    function detailToneColor(tone) {
      if (tone === "danger") return T.err;
      if (tone === "attention") return T.warn;
      if (tone === "success") return T.ok;
      return T.text3;
    }
    function fallbackDetailView(item, allItems) {
      if (!warnedFallbackDetailView) {
        warnedFallbackDetailView = true;
        if (typeof console !== "undefined" && console.warn) {
          console.warn("[requirements] item.detailView \u7F3A\u5931\uFF08\u65E7\u5BBF\u4E3B\u6216\u65E7\u7F13\u5B58\uFF09\uFF0C\u8BE6\u60C5\u9875\u4F7F\u7528\u6700\u5C0F\u517C\u5BB9\u6295\u5F71\uFF1B\u8BF7\u5237\u65B0\u9875\u9762\u6216\u5347\u7EA7\u63D2\u4EF6\u3002");
        }
      }
      const delivery = deliveryOf(item);
      const decision = item?.decision ?? null;
      const acceptance = item?.acceptance ?? null;
      const candidate = item?.candidate ?? null;
      const run = item?.run ?? null;
      const closed = item?.closed === true || delivery.key === "closed";
      const waiting = Boolean(run && (run.awaitingAnswer === true || run.awaitingAnswer === void 0 && run.status === "waiting-input" && Boolean(decision)));
      const idleHandback = Boolean(run && (run.idleHandback === true || run.awaitingAnswer === void 0 && run.status === "waiting-input" && !decision));
      const stale = Boolean(run && run.stale === true);
      const active = Boolean(run && run.active === true);
      const acceptanceResult = acceptance?.result ?? null;
      const acceptanceRegistered = Boolean(acceptance?.registered ?? acceptance);
      const acceptancePassedCurrent = acceptance?.latest?.result === "pass" && acceptance?.latest?.current !== false;
      const accepted = delivery.key === "accepted";
      const released = item?.release?.exists === true && (item.release.released === true || item.release.status === "released");
      const blockedFeedback = decision?.state === "blocked" || decision?.state === "needs-clarification";
      let primaryAction = null;
      if (!closed) {
        if (waiting) primaryAction = { id: "answer-run", label: "\u56DE\u7B54\u5E76\u7EE7\u7EED", enabled: Boolean(run?.id), reason: run?.id ? null : "\u672A\u627E\u5230\u51B3\u7B56\u8FD0\u884C\u53F7", target: { runId: run?.id ?? null } };
        else if (stale) primaryAction = { id: "resume-run", label: "\u6062\u590D\u63A8\u8FDB", enabled: Boolean(run?.id), reason: run?.id ? null : "\u672A\u627E\u5230\u53EF\u6062\u590D\u7684\u8FD0\u884C\u53F7", target: { runId: run?.id ?? null } };
        else if (active) primaryAction = { id: "watch-run", label: "\u67E5\u770B\u8FD0\u884C", enabled: true, reason: null, target: { runId: run?.id ?? null } };
        else if (idleHandback) {
          primaryAction = acceptancePassedCurrent ? { id: "create-candidate", label: "\u751F\u6210\u4EA4\u4ED8\u5019\u9009", enabled: true, reason: null, target: {} } : { id: "continue-run", label: "\u7EE7\u7EED\u63A8\u8FDB", enabled: true, reason: null, target: { runId: run?.id ?? null } };
        } else if (delivery.key === "awaiting-acceptance") primaryAction = { id: "signoff", label: "\u9A8C\u6536\u4EA4\u4ED8", enabled: true, reason: null, target: { candidateId: candidate?.id ?? null } };
        else if (accepted && released) primaryAction = null;
        else if (accepted) primaryAction = { id: "release", label: "\u51B3\u5B9A\u53D1\u5E03", enabled: true, reason: null, target: { candidateId: candidate?.id ?? null } };
        else if (blockedFeedback) primaryAction = null;
        else if (acceptanceRegistered && acceptanceResult !== "pass") primaryAction = { id: "start-fix", label: "\u5F00\u59CB\u4FEE\u590D", enabled: true, reason: null, target: {} };
        else if (delivery.key === "pending" && String(delivery.source ?? "").startsWith("run-")) primaryAction = { id: "start", label: "\u4EA4\u7ED9 AI \u63A8\u8FDB", enabled: true, reason: null, target: {} };
        else if (delivery.key === "in-progress") primaryAction = { id: "watch-run", label: "\u67E5\u770B\u8FD0\u884C", enabled: true, reason: null, target: {} };
        else primaryAction = { id: "start", label: "\u4EA4\u7ED9 AI \u63A8\u8FDB", enabled: true, reason: null, target: {} };
      }
      const explanation = closed ? "\u8BE5\u9700\u6C42\u5DF2\u5173\u95ED\uFF0C\u53EA\u4FDD\u7559\u8BB0\u5F55\u3002" : delivery.reason ? String(delivery.reason) : "\u5BBF\u4E3B\u672A\u63D0\u4F9B\u8BE6\u60C5\u6295\u5F71\uFF0C\u4EE5\u4E0B\u4E3A\u517C\u5BB9\u89C6\u56FE\u3002";
      const contextKind = closed ? "closed" : waiting ? "answer" : stale ? "run-interrupted" : active ? "run-active" : idleHandback ? acceptancePassedCurrent ? "candidate-pending" : "run-idle-handback" : delivery.key === "awaiting-acceptance" ? "awaiting-acceptance" : accepted && released ? "released" : accepted ? "accepted" : blockedFeedback ? "needs-attention" : acceptanceRegistered && acceptanceResult !== "pass" ? "acceptance-failed" : delivery.key === "pending" && String(delivery.source ?? "").startsWith("run-") ? "run-rolled-back" : "not-started";
      const headlines = {
        closed: "\u5DF2\u5173\u95ED",
        answer: "\u9700\u8981\u4F60\u56DE\u7B54",
        "run-interrupted": "\u63A8\u8FDB\u5DF2\u4E2D\u65AD",
        "run-active": "AI \u6B63\u5728\u5F00\u53D1",
        "run-idle-handback": "\u7B49\u5F85\u4F60\u51B3\u5B9A\u4E0B\u4E00\u6B65",
        "candidate-pending": "\u7B49\u5F85\u751F\u6210\u4EA4\u4ED8\u5019\u9009",
        "awaiting-acceptance": "\u7B49\u5F85\u9A8C\u6536",
        released: "\u5DF2\u53D1\u5E03",
        accepted: "\u5DF2\u9A8C\u6536",
        "needs-attention": "\u9700\u6C42\u9700\u8981\u4FEE\u6539",
        "acceptance-failed": "\u9A8C\u6536\u5931\u8D25\uFF0C\u53EF\u4FEE\u590D",
        "run-rolled-back": "\u63A8\u8FDB\u5DF2\u56DE\u9000\uFF0C\u7B49\u5F85\u542F\u52A8",
        "not-started": "\u5C1A\u672A\u5F00\u59CB"
      };
      const tones = { closed: "neutral", answer: "attention", "run-interrupted": "danger", "run-active": "attention", "run-idle-handback": "attention", "awaiting-acceptance": "attention", released: "success", accepted: "success", "needs-attention": "danger", "acceptance-failed": "danger", "run-rolled-back": "attention", "not-started": "neutral" };
      const attentionItems = [];
      if (!closed) {
        if (blockedFeedback) {
          attentionItems.push({ id: "needs-attention", kind: "needs-attention", current: true, tone: "danger", title: "\u9700\u6C42\u9700\u8981\u4FEE\u6539", detail: decision?.topGap?.message ?? decision?.label ?? "\u5B58\u5728\u9700\u8981\u5904\u7406\u7684\u95EE\u9898\u3002", ref: { tab: "requirement", anchor: "requirement-main" } });
        }
        if (acceptanceRegistered && acceptanceResult !== "pass") {
          attentionItems.push({ id: "acceptance-failed", kind: "acceptance-failed", current: true, tone: "danger", title: "\u9A8C\u6536\u5931\u8D25\uFF0C\u53EF\u4FEE\u590D", detail: acceptanceResult ? `\u6700\u8FD1\u4E00\u6B21\u9A8C\u6536\u7ED3\u679C\uFF1A${acceptanceResult}` : "\u9A8C\u6536\u5C1A\u672A\u901A\u8FC7\u3002", ref: { tab: "delivery", anchor: "delivery-acceptance" } });
        }
      }
      const parsed = briefSections(item?.briefText).map((section, index) => ({
        id: `sec-${index + 1}`,
        title: section.title,
        kind: /验收/.test(section.title) ? "acceptance" : /目标|范围|场景|问题/.test(section.title) ? "claim" : /背景|原始诉求|用户诉求|备注/.test(section.title) ? "background" : /约束|风险|依赖/.test(section.title) ? "constraint" : "other",
        text: section.text,
        sameAs: null
      }));
      const missing = [];
      if (!parsed.some((section) => section.kind === "claim")) missing.push("\u76EE\u6807", "\u8303\u56F4");
      if (!parsed.some((section) => section.kind === "acceptance")) missing.push("\u9A8C\u6536\u8981\u6C42");
      const aiReview = item?.aiReview ?? null;
      return {
        schema: "alm.detail.view/v1",
        identity: {
          id: item?.id ?? "\u2014",
          revision: item?.revision ?? item?.version ?? null,
          title: item?.title ?? item?.id ?? "",
          owner: item?.owner ?? null,
          priority: item?.priority ?? null,
          project: item?.project ?? null,
          projectName: item?.projectName ?? item?.project ?? null,
          updatedAt: item?.versions?.[0]?.date ?? null,
          file: item?.file ?? null,
          line: item?.line ?? null,
          brief: item?.briefPath ?? null,
          sources: item?.sources ?? [],
          attachmentCount: (item?.attachmentFiles ?? []).length
        },
        context: {
          kind: contextKind,
          headline: headlines[contextKind],
          explanation,
          tone: tones[contextKind],
          question: waiting ? { ref: decision?.topGap?.code ?? null, title: decision?.label ?? decision?.title ?? "\u51B3\u7B56\u8BF7\u6C42", excerpt: null, runId: run?.id ?? null } : null,
          relatedRefs: []
        },
        primaryAction,
        secondaryActions: closed ? [] : [{ id: "refresh", label: "\u5237\u65B0", enabled: true, reason: null }],
        attentionItems,
        summaries: {
          delivery: { key: delivery.key, label: delivery.label, reason: delivery.reason ?? null, source: delivery.source ?? null, runId: run?.id ?? null, runStatus: run?.status ?? null },
          run: {
            exists: Boolean(run),
            id: run?.id ?? null,
            status: run?.status ?? null,
            phase: run?.phase ?? null,
            active,
            stale,
            awaitingAnswer: waiting,
            idleHandback,
            lastActivityAt: run?.lastActivityAt ?? run?.updatedAt ?? null,
            label: run?.statusLabel ?? run?.label ?? null,
            failure: run?.failure ? { message: run.failure.message ?? String(run.failure) } : null
          },
          review: {
            ai: {
              stored: Boolean(aiReview?.stored),
              verdict: aiReview?.verdict ?? null,
              suggestions: aiReview?.suggestions ?? [],
              adopted: aiReview?.adopted === true,
              adoptionValid: aiReview?.adoption?.valid !== false,
              generatedAt: aiReview?.generatedAt ?? null
            }
          },
          acceptance: {
            registered: acceptanceRegistered,
            commandCount: acceptance?.commandCount ?? 0,
            result: acceptanceResult,
            current: acceptance?.current ?? null,
            complete: acceptance?.complete ?? false,
            finishedAt: acceptance?.finishedAt ?? null,
            headSha: acceptance?.headSha ?? null,
            headShaShort: acceptance?.headSha ? shortHash(acceptance.headSha) : null,
            environment: acceptance?.environment ?? null,
            provenance: { commandIds: [], evidencePath: null, ruleCodes: [] }
          },
          candidate: {
            exists: Boolean(candidate),
            id: candidate?.id ?? null,
            current: candidate?.current ?? null,
            treeHash: candidate?.treeHash ?? null,
            treeHashShort: candidate?.treeHash ? shortHash(candidate.treeHash) : null,
            reasons: candidate?.reasons ?? []
          },
          defects: { own: null, related: [], closedHistory: [], counts: { open: 0, closed: 0 } },
          release: item?.release?.exists ? { exists: true, id: item.release.id ?? null, label: item.release.label ?? item.release.status ?? null, status: item.release.status ?? null, released } : null
        },
        tabs: { requirement: { badge: null }, delivery: { badge: attentionItems.filter((entry) => entry.current && entry.kind !== "defect-closed").length }, record: { badge: null } },
        content: {
          sections: parsed,
          missing,
          verifiedBy: item?.verifiedBy ?? [],
          acceptanceCriteria: parsed.filter((section) => section.kind === "acceptance").map((section, index) => ({ id: `AC-${index + 1}`, title: section.title, text: section.text })),
          attachments: item?.attachmentFiles ?? []
        },
        record: {
          timeline: [],
          relations: relationsOf(item, allItems),
          github: item?.github ?? null,
          technical: { file: item?.file ?? null, brief: item?.briefPath ?? null, prompt: null }
        },
        freshness: {
          readAt: (/* @__PURE__ */ new Date()).toISOString(),
          requirementRevision: item?.revision ?? null,
          briefPresent: Boolean(item?.briefText),
          candidateCurrent: candidate?.current ?? null,
          acceptanceApplicable: acceptance?.current ?? null,
          missing: []
        }
      };
    }
    const DETAIL_SMALL = { margin: 0, fontSize: "11.5px", color: T.text3, lineHeight: 1.65 };
    const DETAIL_LINK = { border: 0, background: "transparent", color: T.text3, fontSize: "11.5px", padding: 0, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: "2px", lineHeight: 1.6 };
    const DETAIL_HEADER_ACTION = { border: `1px solid ${T.line2}`, background: "transparent", color: T.text2, fontSize: "12px", lineHeight: 1.4, padding: "4px 8px", borderRadius: "6px", cursor: "pointer" };
    const DETAIL_GHOST = { border: `1px solid ${T.line2}`, background: "transparent", color: T.text2, fontSize: "11.5px", padding: "6px 10px", borderRadius: "7px", cursor: "pointer", lineHeight: 1.5 };
    const DETAIL_PRIMARY = { border: 0, borderRadius: "8px", background: T.text, color: T.base, fontSize: "13px", fontWeight: 600, padding: "9px 18px", minHeight: "36px", cursor: "pointer", flex: "none" };
    const DETAIL_TABS = [
      { id: "requirement", label: "\u9700\u6C42" },
      { id: "delivery", label: "\u4EA4\u4ED8" },
      { id: "record", label: "\u8BB0\u5F55" }
    ];
    const DETAIL_SHELL_CSS = [
      "@keyframes alm-detail-fade{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}",
      "[data-detail-shell] [data-detail-body]{animation:alm-detail-fade 150ms ease-out}",
      "@media (prefers-reduced-motion: reduce){[data-detail-shell] [data-detail-body]{animation:none}}",
      "[data-detail-shell] details>summary{list-style:none}",
      "[data-detail-shell] details>summary::-webkit-details-marker{display:none}",
      `[data-detail-shell] details>summary::before{content:"\u25B8 ";color:${T.text2}}`,
      '[data-detail-shell] details[open]>summary::before{content:"\u25BE "}',
      "[data-detail-shell] *{box-sizing:border-box}"
    ].join("\n");
    function acceptanceResultText(value) {
      if (value === "pass") return "\u901A\u8FC7";
      if (value === "fail") return "\u5931\u8D25";
      if (value === "stale") return "\u5DF2\u8FC7\u671F";
      if (value === "not-run" || !value) return "\u5C1A\u672A\u6267\u884C";
      return String(value);
    }
    function acceptanceResultColor(value) {
      if (value === "pass") return T.ok;
      if (value === "fail") return T.err;
      if (value === "stale") return T.warn;
      return T.text3;
    }
    function humanAcceptanceState(acceptance = {}) {
      if (!acceptance.registered) return { label: "\u5C1A\u672A\u6267\u884C\u68C0\u67E5", color: T.text2 };
      if (acceptance.current === false) return { label: acceptance.result === "pass" ? "\u5386\u53F2\u901A\u8FC7\uFF0C\u5F53\u524D\u5DF2\u8FC7\u671F" : "\u5386\u53F2\u68C0\u67E5\u5DF2\u8FC7\u671F", color: T.warn };
      if (acceptance.current !== true && acceptance.result != null) return { label: acceptance.result === "pass" ? "\u5386\u53F2\u901A\u8FC7\uFF0C\u5F53\u524D\u9002\u7528\u6027\u672A\u786E\u8BA4" : "\u5386\u53F2\u68C0\u67E5\u672A\u901A\u8FC7\uFF0C\u5F53\u524D\u9002\u7528\u6027\u672A\u786E\u8BA4", color: T.warn };
      if (acceptance.result === "pass" && acceptance.complete !== true) return { label: "\u5DF2\u6709\u68C0\u67E5\u901A\u8FC7\uFF0C\u5B8C\u6574\u9A8C\u8BC1\u5C1A\u672A\u786E\u8BA4", color: T.warn };
      return { label: acceptance.result === "pass" ? "\u5F53\u524D\u6280\u672F\u68C0\u67E5\u901A\u8FC7" : acceptanceResultText(acceptance.result), color: acceptanceResultColor(acceptance.result) };
    }
    function canCancelRequirementRun(run = {}) {
      return run.exists === true && ["queued", "running", "waiting-input", "paused"].includes(run.status);
    }
    function safeHttpHref(value) {
      return typeof value === "string" && /^https?:\/\//i.test(value) ? value : null;
    }
    function GitHubLinkButton({ href, children, title = null, compact = false }) {
      const safe = safeHttpHref(href);
      if (!safe) return null;
      return h("a", {
        href: safe,
        target: "_blank",
        rel: "noopener",
        title: title ?? String(children ?? ""),
        onClick: (event) => event.stopPropagation(),
        style: compact ? { color: T.ok, fontSize: "11px", textDecoration: "none", whiteSpace: "nowrap" } : { display: "inline-flex", alignItems: "center", minHeight: "32px", padding: "5px 9px", border: `1px solid ${T.line2}`, borderRadius: "7px", color: T.text, background: T.layer, fontSize: "12px", textDecoration: "none" }
      }, children);
    }
    function GitHubDeliveryLinks({ links, showCompare = false, compact = false }) {
      if (!links?.repoWebUrl) return null;
      const short = (value) => String(value ?? "").slice(0, 7);
      const entries = [
        links.mainCommitUrl ? ["main", links.mainCommitUrl, "\u2197 \u67E5\u770B GitHub \u4E3B\u5E72\u63D0\u4EA4"] : null,
        links.devCommitUrl ? ["develop", links.devCommitUrl, `\u{1F33F} \u67E5\u770B\u672C\u6B21\u4EA4\u4ED8\u63D0\u4EA4 (${short(links.devCommitSha)})`] : links.devBranchUrl ? ["develop", links.devBranchUrl, `\u{1F33F} \u67E5\u770B GitHub ${links.devBranch ?? "develop"} \u5206\u652F`] : null,
        showCompare && links.compareUrl ? ["compare", links.compareUrl, "\u6BD4\u8F83 main \u4E0E develop"] : null
      ].filter(Boolean);
      if (!entries.length) return null;
      return h(
        "div",
        { "data-github-delivery-links": "true", style: { display: "flex", gap: "7px", flexWrap: "wrap", marginTop: compact ? "5px" : "10px" } },
        entries.map(([key, href, label]) => h(GitHubLinkButton, { key, href, compact }, label))
      );
    }
    function GitHubDeliveryProperties({ links }) {
      if (!links?.repoWebUrl) return null;
      const row2 = (label, children) => h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", padding: "6px 0", fontSize: "13px", color: T.text2 } }, h("div", null, label), h("div", { style: { color: T.text, overflowWrap: "anywhere", textAlign: "right", minWidth: 0 } }, children));
      const branch = h(
        "span",
        { style: { display: "inline-flex", gap: "5px", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" } },
        links.devBranchUrl ? h(GitHubLinkButton, { href: links.devBranchUrl, compact: true }, links.devBranch ?? "develop") : null,
        links.mainBranchUrl && links.mainMergeCommitSha ? h("span", { style: { color: T.text3 } }, "\u2192") : null,
        links.mainBranchUrl && links.mainMergeCommitSha ? h(GitHubLinkButton, { href: links.mainBranchUrl, compact: true }, links.mainBranch ?? "main") : null
      );
      const commitHref = links.mainCommitUrl ?? links.devCommitUrl;
      const commitSha = links.mainMergeCommitSha ?? links.devCommitSha;
      return h(
        "div",
        { "data-github-delivery-properties": "true" },
        links.devBranchUrl || links.mainBranchUrl ? row2("\u4EE3\u7801\u5206\u652F", branch) : null,
        commitHref && commitSha ? row2("\u6700\u65B0\u63D0\u4EA4", h(GitHubLinkButton, { href: commitHref, compact: true, title: "\u5728 GitHub \u67E5\u770B\u63D0\u4EA4 Diff" }, commitSha.slice(0, 7))) : null
      );
    }
    function relationRows(relations) {
      return (relations ?? []).map((entry, index) => {
        if (Array.isArray(entry)) return { label: String(entry[0] ?? `\u5173\u7CFB ${index + 1}`), ids: Array.isArray(entry[1]) ? entry[1] : [] };
        return { label: String(entry?.label ?? entry?.key ?? `\u5173\u7CFB ${index + 1}`), ids: Array.isArray(entry?.ids) ? entry.ids : Array.isArray(entry?.items) ? entry.items : [] };
      });
    }
    function DetailBlock({ title, aside = null, anchor = null, sectionId = null, children }) {
      const progressive = /^(delivery-|record-)/.test(sectionId ?? "") && !["delivery-attention", "record-timeline"].includes(sectionId);
      return h(
        progressive ? "details" : "section",
        {
          "data-detail-section": sectionId ?? void 0,
          "data-detail-anchor": anchor ?? void 0,
          tabIndex: anchor ? -1 : void 0,
          style: { marginTop: "18px", paddingTop: "14px", borderTop: `1px solid ${T.line}`, minWidth: 0 }
        },
        h(
          progressive ? "summary" : "div",
          { style: { display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "8px", flexWrap: "wrap", cursor: progressive ? "pointer" : void 0 } },
          h("h3", { style: { margin: 0, fontSize: "13px", fontWeight: 600, color: T.text, letterSpacing: ".01em" } }, title),
          aside ? h("div", { style: { marginLeft: "auto", fontSize: "11.5px", color: T.text3 } }, aside) : null
        ),
        children
      );
    }
    function DetailBodySection({ section }) {
      if (!section) return null;
      const body = section.sameAs ? h(
        "details",
        { style: { margin: "0 0 6px" } },
        h("summary", { style: { cursor: "pointer", fontSize: "11px", color: T.text3 } }, `\u4E0E\u300C${section.sameAs}\u300D\u5185\u5BB9\u76F8\u540C\uFF08\u5C55\u5F00\u67E5\u770B\uFF09`),
        h("div", { style: { marginTop: "4px" } }, renderRich(section.text))
      ) : h("div", null, renderRich(section.text));
      return h(
        "div",
        { "data-detail-section": section.kind ?? "other", style: { margin: "0 0 20px", minWidth: 0 } },
        h("h4", { style: { margin: "0 0 3px", fontSize: "11.5px", fontWeight: 600, color: T.text3, letterSpacing: ".02em" } }, section.title || "\u6B63\u6587"),
        body
      );
    }
    function DetailHeader({ item, detail, tab, root, narrow, notice, setNotice, onClose, onArchive, onRemove, onCancelRun, onRefresh }) {
      const [moreOpen, setMoreOpen] = useState(false);
      const [metaOpen, setMetaOpen] = useState(false);
      const moreRef = useRef(null);
      const identity = detail.identity ?? {};
      const technical = detail.record?.technical ?? {};
      const summaries = detail.summaries ?? {};
      const archived = (summaries.delivery?.key ?? "") === "closed";
      const run = summaries.run ?? null;
      const requirementId = identity.id ?? item?.id ?? "";
      const titleId = detailTitleId(item);
      useEffect(() => {
        if (!moreOpen) return void 0;
        const onDown = (event) => {
          if (moreRef.current && !moreRef.current.contains(event.target)) setMoreOpen(false);
        };
        if (typeof document === "undefined") return void 0;
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
      }, [moreOpen]);
      const copyPrompt = () => {
        const text = nextPrompt(item, root);
        if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(text).then(
            () => setNotice("\u63D0\u793A\u8BCD\u5DF2\u590D\u5236"),
            () => setNotice("\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u5728\u8BB0\u5F55\u9875\u624B\u52A8\u590D\u5236")
          );
        } else {
          setNotice("\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u5728\u8BB0\u5F55\u9875\u624B\u52A8\u590D\u5236");
        }
      };
      const openSource = () => {
        if (!root) {
          setNotice("\u7F3A\u5C11\u5DE5\u4F5C\u533A\u8DEF\u5F84\uFF0C\u65E0\u6CD5\u6253\u5F00\u6587\u4EF6\u7BA1\u7406\u5668");
          return;
        }
        const base = String(root).replace(/[\\/]+$/, "");
        const relative = String(technical.file ?? "").replace(/\\/g, "/");
        const folder = relative.includes("/") ? relative.slice(0, relative.lastIndexOf("/")) : "";
        const reveal = (target) => writeJson("reveal", { root: target }, root).then(() => true, () => false);
        const fail = () => setNotice(technical.file ? `\u65E0\u6CD5\u6253\u5F00\u6587\u4EF6\u7BA1\u7406\u5668\uFF1B\u6E90\u6587\u4EF6\u8DEF\u5F84\uFF1A${technical.file}` : "\u65E0\u6CD5\u6253\u5F00\u6587\u4EF6\u7BA1\u7406\u5668");
        if (!folder) {
          reveal(base).then((ok) => ok ? setNotice(technical.file ? `\u5DF2\u6253\u5F00\u9879\u76EE\u76EE\u5F55\uFF1B\u6E90\u6587\u4EF6\uFF1A${technical.file}` : "\u5DF2\u6253\u5F00\u9879\u76EE\u5DE5\u4F5C\u533A\u76EE\u5F55") : fail());
          return;
        }
        reveal(`${base}/${folder}`).then((ok) => {
          if (ok) {
            setNotice(`\u5DF2\u6253\u5F00\u6E90\u6587\u4EF6\u6240\u5728\u76EE\u5F55\uFF1A${folder}`);
            return;
          }
          reveal(base).then(
            (fallback) => fallback ? setNotice(`\u5DF2\u6253\u5F00\u9879\u76EE\u76EE\u5F55\uFF1B\u6E90\u6587\u4EF6\uFF1A${technical.file}`) : fail()
          );
        });
      };
      const menuItems = [
        { id: "archive", label: "\u5F52\u6863", hide: archived || !onArchive, onClick: () => onArchive && onArchive(item) },
        { id: "remove", label: "\u5220\u9664", hide: !onRemove, onClick: () => onRemove && onRemove(item) },
        { id: "copy-prompt", label: "\u590D\u5236\u63D0\u793A\u8BCD", hide: false, onClick: copyPrompt },
        { id: "open-source", label: "\u6253\u5F00\u6E90\u6587\u4EF6", hide: false, onClick: openSource },
        { id: "cancel-run", label: "\u53D6\u6D88\u8FD0\u884C", hide: !run?.exists || !onCancelRun, onClick: () => onCancelRun && onCancelRun(item) }
      ].filter((entry) => !entry.hide);
      const metaRows = [
        ["\u6E90\u6587\u4EF6", technical.file ? `${technical.file}${technical.line ? ":" + technical.line : ""}` : "\u672A\u767B\u8BB0"],
        ["brief", technical.brief ?? identity.brief ?? "\u672A\u767B\u8BB0"],
        ["\u8D1F\u8D23\u4EBA", identity.owner ?? "\u672A\u5206\u914D"],
        ["\u9879\u76EE", identity.projectName ?? identity.project ?? "\u672A\u767B\u8BB0"],
        ["\u4F18\u5148\u7EA7", identity.priority ?? "\u672A\u8BBE\u7F6E"],
        ["\u6700\u8FD1\u66F4\u65B0", identity.updatedAt ? formatLocalStamp(identity.updatedAt) : "\u672A\u77E5"],
        ["\u9644\u4EF6", identity.attachmentCount ? `${identity.attachmentCount} \u4E2A` : "\u65E0"]
      ];
      return h(
        "header",
        { "data-detail-header": "true", style: { flex: "none", padding: narrow ? "14px 16px 10px" : "18px 20px 12px", borderBottom: `1px solid ${T.line}`, background: T.base, display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 } },
        h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "8px", minWidth: 0, flexWrap: "nowrap", minHeight: "24px" } },
          h(
            "span",
            { style: { display: "inline-flex", alignItems: "center", gap: "2px", fontSize: "12px", color: T.text2, whiteSpace: "nowrap", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" } },
            h("span", { "data-detail-id": requirementId, style: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 } }, requirementId),
            h(CopyTextButton, { value: requirementId, label: "\u590D\u5236 ID" })
          ),
          h("span", { "data-detail-revision": String(identity.revision ?? "\u2014"), title: "\u9700\u6C42\u4FEE\u8BA2", style: { fontSize: "11.5px", color: T.text3, flex: "none" } }, `v${identity.revision ?? "\u2014"}`),
          isDefect(item) ? h(DefectStatusPill, { item, prefix: "\u7F3A\u9677" }) : null,
          h(
            "div",
            { style: { marginLeft: "auto", display: "flex", alignItems: "center", gap: "6px", flex: "none" } },
            h(
              "button",
              {
                type: "button",
                title: "\u53CD\u9988\u8FD9\u4E2A\u9875\u9762",
                onClick: () => launchFeedbackFromLayer({ kind: "drawer", label: `\u9700\u6C42\u8BE6\u60C5 ${requirementId}`, requirementId, tab }),
                style: DETAIL_HEADER_ACTION
              },
              "\u53CD\u9988"
            ),
            h(
              "div",
              { ref: moreRef, style: { position: "relative" } },
              h(
                "button",
                {
                  type: "button",
                  "data-detail-more": "true",
                  title: "\u66F4\u591A\u64CD\u4F5C",
                  "aria-haspopup": "menu",
                  "aria-expanded": moreOpen,
                  onClick: () => setMoreOpen((value) => !value),
                  style: DETAIL_HEADER_ACTION
                },
                "\u66F4\u591A"
              ),
              moreOpen ? h(
                "div",
                { role: "menu", style: { position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 8, background: T.layer2, border: `1px solid ${T.line2}`, borderRadius: "8px", padding: "4px", minWidth: "172px", boxShadow: "0 12px 32px rgba(0,0,0,.4)" } },
                menuItems.map(
                  (entry) => h(
                    "button",
                    {
                      key: entry.id,
                      type: "button",
                      role: "menuitem",
                      "data-detail-more-item": entry.id,
                      onClick: () => {
                        setMoreOpen(false);
                        entry.onClick();
                      },
                      style: { display: "block", width: "100%", textAlign: "left", border: 0, background: "transparent", color: T.text2, fontSize: "12px", padding: "7px 10px", borderRadius: "6px", cursor: "pointer" }
                    },
                    entry.label
                  )
                )
              ) : null
            ),
            h(
              "button",
              { type: "button", "data-drawer-close": "true", title: "\u5173\u95ED\uFF08Esc\uFF09", "aria-label": "\u5173\u95ED\u8BE6\u60C5", onClick: onClose, style: { ...DETAIL_LINK, display: "inline-flex", alignItems: "center", padding: "2px" } },
              h(ActionIcon, { name: "close", size: 14 })
            )
          )
        ),
        h("h2", { id: titleId, style: { margin: 0, fontSize: "20px", lineHeight: 1.35, fontWeight: 600, color: T.text, overflowWrap: "anywhere" } }, identity.title ?? requirementId),
        h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", fontSize: "12px", color: T.text3, minWidth: 0 } },
          h("span", { style: { color: T.text2, minWidth: 0, overflowWrap: "anywhere" } }, [identity.owner || "\u672A\u5206\u914D", identity.priority, identity.projectName || identity.project].filter(Boolean).join(" \xB7 ")),
          identity.updatedAt ? h("span", { title: "\u6700\u8FD1\u66F4\u65B0" }, `\u66F4\u65B0\u4E8E ${formatLocalStamp(identity.updatedAt)}`) : null,
          h("button", { type: "button", "aria-expanded": metaOpen, onClick: () => setMetaOpen((value) => !value), style: DETAIL_LINK }, metaOpen ? "\u6536\u8D77\u8BE6\u60C5" : "\u8BE6\u60C5"),
          notice ? h("span", { role: "status", "data-detail-notice": "true", style: { marginLeft: "auto", color: T.text2, fontSize: "11.5px" } }, notice) : null
        ),
        metaOpen ? h(
          "div",
          { "data-detail-meta": "true", style: { marginTop: "2px", paddingTop: "8px", borderTop: `1px solid ${T.line}`, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1px 18px" } },
          metaRows.map(([label, value]) => h(DetailRow, { key: label, label }, value)),
          technical.file ? h("div", { style: { marginTop: "6px", gridColumn: "1 / -1" } }, h(CopyTextButton, { value: technical.file, label: "\u590D\u5236\u6E90\u6587\u4EF6\u8DEF\u5F84" })) : null
        ) : null
      );
    }
    function CurrentTaskSummary({ detail, onQuestion, onJump }) {
      const context = detail.context ?? {};
      const tone = context.tone ?? "neutral";
      const needsAttention = tone === "attention" || tone === "danger";
      const color = detailToneColor(tone);
      const question = context.question ?? null;
      const relatedRefs = context.relatedRefs ?? [];
      const secondary = question ? { label: "\u67E5\u770B\u95EE\u9898", run: onQuestion } : relatedRefs.length ? { label: relatedRefs[0].label ?? "\u67E5\u770B\u8BE6\u60C5", run: () => onJump(relatedRefs[0]) } : null;
      const surface = needsAttention ? {
        padding: "12px 14px",
        borderLeft: `3px solid ${color}`,
        background: tone === "danger" ? "rgba(255,139,139,.06)" : "rgba(231,176,75,.06)",
        borderRadius: "0 8px 8px 0"
      } : { padding: "0" };
      return h(
        "section",
        { "data-detail-context": context.kind ?? "unknown", "data-tone": tone, "aria-label": `\u5F53\u524D\u5F85\u529E\uFF1A${context.headline ?? "\u72B6\u6001\u672A\u77E5"}`, style: { margin: needsAttention ? "12px 0 4px" : "14px 0 2px", minWidth: 0, ...surface } },
        h(
          "div",
          { style: { display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" } },
          h("h3", { style: { margin: 0, fontSize: "13px", fontWeight: 600, letterSpacing: ".01em", color: needsAttention ? color : T.text2 } }, context.headline ?? "\u5F53\u524D\u5F85\u529E"),
          secondary ? h("button", { type: "button", "data-detail-context-action": "true", onClick: secondary.run, style: { marginLeft: "auto", ...DETAIL_LINK } }, secondary.label) : null
        ),
        h("p", { "data-detail-focus-message": "true", style: { margin: "4px 0 0", fontSize: "13px", lineHeight: 1.7, color: T.text2 } }, {
          answer: "AI \u9700\u8981\u4F60\u7684\u51B3\u5B9A\uFF0C\u786E\u8BA4\u540E\u7EE7\u7EED\u63A8\u8FDB\u3002",
          "run-active": "AI \u6B63\u5728\u6267\u884C\u3002\u9700\u8981\u4F60\u51B3\u5B9A\u65F6\uFF0C\u4F1A\u5728\u8FD9\u91CC\u63D0\u51FA\u3002",
          "run-interrupted": "AI \u7684\u63A8\u8FDB\u5DF2\u4E2D\u65AD\uFF0C\u53EF\u4EE5\u6062\u590D\u540E\u7EE7\u7EED\u3002",
          "run-idle-handback": "\u8FD9\u4E00\u8F6E\u5DF2\u6682\u505C\uFF0C\u786E\u8BA4\u4E0B\u4E00\u6B65\u540E\u7EE7\u7EED\u3002",
          "acceptance-failed": "\u5F53\u524D\u7ED3\u679C\u672A\u901A\u8FC7\u9A8C\u6536\u3002\u4FEE\u590D\u540E\u9700\u8981\u91CD\u65B0\u9A8C\u8BC1\u3002",
          "awaiting-acceptance": "\u4EA4\u4ED8\u5DF2\u51C6\u5907\u597D\uFF0C\u8BF7\u6838\u5BF9\u7ED3\u679C\u5E76\u51B3\u5B9A\u662F\u5426\u63A5\u53D7\u3002",
          "needs-attention": "\u9700\u6C42\u4E2D\u5B58\u5728\u5C1A\u672A\u89E3\u51B3\u7684\u95EE\u9898\uFF0C\u8BF7\u5904\u7406\u540E\u7EE7\u7EED\u3002",
          accepted: "\u4F60\u5DF2\u63A5\u53D7\u8FD9\u6B21\u4EA4\u4ED8\uFF0C\u53D1\u5E03\u4ECD\u9700\u5355\u72EC\u51B3\u5B9A\u3002",
          released: "\u8FD9\u6B21\u4EA4\u4ED8\u5DF2\u53D1\u5E03\uFF0C\u76F8\u5173\u8BB0\u5F55\u53EF\u968F\u65F6\u67E5\u9605\u3002",
          "run-rolled-back": "\u4E0A\u4E00\u8F6E\u5DF2\u56DE\u9000\uFF0C\u53EF\u4EE5\u91CD\u65B0\u786E\u8BA4\u540E\u542F\u52A8\u3002",
          "release-authorized": "\u5DF2\u6388\u6743\u53D1\u5E03\uFF0C\u5C1A\u672A\u6267\u884C\u3002",
          "release-failed": "\u53D1\u5E03\u672A\u5B8C\u6210\uFF0C\u8BF7\u6838\u5BF9\u539F\u56E0\u540E\u518D\u51B3\u5B9A\u3002",
          "candidate-pending": "\u63A5\u4E0B\u6765\u751F\u6210\u4EA4\u4ED8\u5019\u9009\uFF1B\u4ECD\u9700\u901A\u8FC7\u670D\u52A1\u7AEF\u95E8\u7981\u3002",
          "not-started": "\u76EE\u6807\u786E\u8BA4\u540E\uFF0C\u53EF\u4EA4\u7ED9 AI \u63A8\u8FDB\u3002",
          closed: "\u8FD9\u6761\u9700\u6C42\u5DF2\u5173\u95ED\uFF0C\u539F\u59CB\u6750\u6599\u548C\u8BB0\u5F55\u4ECD\u53EF\u67E5\u9605\u3002"
        }[context.kind] ?? context.headline ?? "\u72B6\u6001\u5C1A\u672A\u786E\u8BA4"),
        context.explanation && needsAttention && !question ? h(
          "details",
          { "data-detail-focus-reason": "true", style: { marginTop: "6px", fontSize: "12px", lineHeight: 1.7, color: T.text2 } },
          h("summary", { style: { cursor: "pointer" } }, "\u67E5\u770B\u539F\u56E0\u4E0E\u5904\u7406\u4F9D\u636E"),
          h("p", { style: { margin: "6px 0 0", overflowWrap: "anywhere", whiteSpace: "pre-wrap" } }, context.explanation)
        ) : null
      );
    }
    function DetailTabs({ tab, onChange, badges }) {
      const refs = useRef({});
      const onKeyDown = (event) => {
        const index = DETAIL_TABS.findIndex((entry) => entry.id === tab);
        let next = null;
        if (event.key === "ArrowRight") next = (index + 1) % DETAIL_TABS.length;
        else if (event.key === "ArrowLeft") next = (index - 1 + DETAIL_TABS.length) % DETAIL_TABS.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = DETAIL_TABS.length - 1;
        if (next === null || next === index) {
          if (next !== null) event.preventDefault();
          return;
        }
        event.preventDefault();
        const id = DETAIL_TABS[next].id;
        onChange(id);
        const node = refs.current[id];
        if (node && node.focus) node.focus();
      };
      return h(
        "div",
        {
          role: "tablist",
          "aria-label": "\u8BE6\u60C5\u5206\u533A",
          "data-detail-tabs": "true",
          onKeyDown,
          style: { display: "flex", gap: "2px", borderTop: `1px solid ${T.line}`, borderBottom: `1px solid ${T.line}`, margin: "10px 0 2px", position: "sticky", top: 0, background: T.base, zIndex: 2, overflowX: "auto", overflowY: "hidden", overscrollBehaviorX: "contain", touchAction: "pan-x", scrollbarWidth: "thin" }
        },
        DETAIL_TABS.map((entry) => {
          const selected = tab === entry.id;
          const badge = Number(badges?.[entry.id] ?? 0);
          return h(
            "button",
            {
              key: entry.id,
              ref: (node) => {
                refs.current[entry.id] = node;
              },
              type: "button",
              role: "tab",
              id: `detail-tab-${entry.id}`,
              "aria-controls": "detail-panel",
              "aria-selected": selected,
              tabIndex: selected ? 0 : -1,
              "data-detail-tab": entry.id,
              "aria-label": badge > 0 ? `${entry.label}\uFF0C${badge} \u9879\u5F85\u5904\u7406` : entry.label,
              onClick: () => onChange(entry.id),
              style: {
                border: 0,
                borderBottom: selected ? `2px solid ${T.text}` : "2px solid transparent",
                marginBottom: "-1px",
                background: "transparent",
                cursor: "pointer",
                padding: "10px 12px 9px",
                fontSize: "12.5px",
                fontWeight: selected ? 600 : 400,
                color: selected ? T.text : T.text2,
                display: "inline-flex",
                flex: "0 0 auto",
                alignItems: "center",
                gap: "6px"
              }
            },
            entry.label,
            badge > 0 ? h("span", { "data-detail-tab-badge": entry.id, style: { minWidth: "16px", height: "16px", borderRadius: "999px", padding: "0 5px", background: "rgba(231,176,75,.16)", color: T.warn, fontSize: "10.5px", fontWeight: 600, display: "inline-flex", alignItems: "center", justifyContent: "center" } }, String(badge)) : null
          );
        })
      );
    }
    function RequirementContent({ item, detail, onNavigate }) {
      const content = detail.content ?? {};
      const sections = content.sections ?? [];
      const [casesOpen, setCasesOpen] = useState(false);
      const ordered = [
        ...sections.filter((section) => section.kind === "claim"),
        ...sections.filter((section) => section.kind === "constraint"),
        ...sections.filter((section) => section.kind === "acceptance"),
        ...sections.filter((section) => section.kind === "other")
      ];
      const background = sections.filter((section) => section.kind === "background" || section.kind === "provenance");
      const aiSections = sections.filter((section) => section.kind === "ai-suggestion");
      const acceptanceSections = ordered.filter((section) => section.kind === "acceptance");
      const verifiedBy = content.verifiedBy ?? [];
      const criteria = content.acceptanceCriteria ?? [];
      const missing = content.missing ?? [];
      const attachments = content.attachments ?? item?.attachmentFiles ?? [];
      const aiReview = item?.aiReview ?? null;
      const adoption = aiReview?.adopted;
      const adopted = adoption === true || adoption && typeof adoption === "object" || aiReview?.adoption?.valid === true;
      return h(
        "div",
        { "data-detail-content": "requirement", style: { minWidth: 0 } },
        ordered.length ? ordered.map((section) => h(DetailBodySection, { key: section.id, section })) : h("p", { style: { ...DETAIL_SMALL, margin: "0 0 14px" } }, "\u5C1A\u672A\u89E3\u6790\u5230\u53EF\u5C55\u793A\u7684\u6B63\u6587\u3002"),
        !acceptanceSections.length && criteria.length ? h(
          "div",
          { style: { margin: "0 0 14px" } },
          h("h4", { style: { margin: "0 0 3px", fontSize: "11.5px", fontWeight: 600, color: T.text3, letterSpacing: ".02em" } }, "\u9A8C\u6536\u8981\u6C42"),
          criteria.map(
            (criterion) => h("div", { key: criterion.id, style: { display: "flex", gap: "8px", fontSize: "12.5px", lineHeight: 1.65, color: T.text2, padding: "2px 0", minWidth: 0 } }, h("span", { style: { color: T.text3, flex: "none" } }, criterion.id), h("span", { style: { minWidth: 0, overflowWrap: "anywhere" } }, [criterion.title, criterion.text ? `\uFF1A${criterion.text}` : ""].join("")))
          )
        ) : null,
        h(
          "div",
          { style: { margin: "18px 0 0", paddingTop: "12px", borderTop: `1px solid ${T.line}` } },
          verifiedBy.length ? h(
            "div",
            null,
            h("button", { type: "button", "data-detail-cases-toggle": "true", onClick: () => setCasesOpen((value) => !value), style: DETAIL_LINK }, casesOpen ? `\u6536\u8D77\u5173\u8054\u7528\u4F8B\uFF08${verifiedBy.length}\uFF09` : `\u67E5\u770B\u5173\u8054\u7528\u4F8B\uFF08${verifiedBy.length}\uFF09`),
            casesOpen ? h(
              "div",
              null,
              h("div", { style: { marginTop: "6px", display: "flex", flexWrap: "wrap", gap: "6px" } }, verifiedBy.map((id) => h(MetaChip, { key: id }, id))),
              h("p", { style: { margin: "6px 0 0", ...DETAIL_SMALL } }, "\u5173\u8054\u7528\u4F8B\uFF08TEST-*\uFF09\u53EA\u8868\u793A\u8986\u76D6\u5173\u7CFB\uFF0C\u4E0D\u7B49\u4E8E\u6267\u884C\u901A\u8FC7\uFF1B\u901A\u8FC7\u72B6\u6001\u4EE5\u9A8C\u6536\u7ED3\u679C\u4E3A\u51C6\u3002")
            ) : null
          ) : h("p", { style: DETAIL_SMALL }, "\u5C1A\u672A\u5173\u8054\u9A8C\u6536\u7528\u4F8B\uFF08TEST-*\uFF09\u3002")
        ),
        missing.length ? h(
          "div",
          { "data-detail-missing": "true", style: { margin: "12px 0 0", padding: "8px 12px", borderLeft: `2px solid ${T.warn}`, background: "rgba(231,176,75,.05)", borderRadius: "0 6px 6px 0", fontSize: "12px", lineHeight: 1.65, color: T.text2 } },
          h("div", null, `\u6B63\u6587\u5C1A\u672A\u660E\u786E\uFF1A${missing.join("\u3001")}\u3002`),
          h("div", { style: { ...DETAIL_SMALL, marginTop: "2px" } }, "\u8FD9\u91CC\u4E0D\u4F1A\u7F16\u9020\u8981\u6C42\uFF1B\u53EF\u67E5\u770B\u6E90\u6587\u4EF6\u8865\u5145\uFF0C\u6216\u5148\u5728\u5217\u8868\u9875\u5411 AI \u6F84\u6E05\u3002"),
          onNavigate ? h("button", { type: "button", onClick: () => onNavigate("record", "record-technical"), style: { ...DETAIL_LINK, marginTop: "2px" } }, "\u67E5\u770B\u6E90\u6587\u4EF6\u4E0E\u6280\u672F\u4FE1\u606F") : null
        ) : null,
        background.length ? h(
          "details",
          { style: { marginTop: "18px", borderTop: `1px solid ${T.line}`, paddingTop: "10px" } },
          h("summary", { style: { cursor: "pointer", fontSize: "12px", color: T.text2 } }, `\u80CC\u666F\u4E0E\u539F\u59CB\u8BC9\u6C42\uFF08${background.length} \u8282\uFF09`),
          h("div", { style: { marginTop: "8px" } }, background.map((section) => h(DetailBodySection, { key: section.id, section })))
        ) : null,
        aiSections.length ? h(
          "details",
          { style: { marginTop: "10px" } },
          h("summary", { style: { cursor: "pointer", fontSize: "12px", color: T.text2 } }, `AI \u4F18\u5316\u5EFA\u8BAE\uFF08${aiSections.length} \u8282 \xB7 ${adopted ? "\u5DF2\u91C7\u7EB3" : "\u672A\u91C7\u7EB3"} \xB7 \u975E\u4E8B\u5B9E\u6765\u6E90\uFF09`),
          h("div", { style: { marginTop: "8px" } }, aiSections.map((section) => h(DetailBodySection, { key: section.id, section })))
        ) : null,
        attachments.length ? h(
          "div",
          { style: { marginTop: "18px", paddingTop: "12px", borderTop: `1px solid ${T.line}` } },
          h("h4", { style: { margin: "0 0 6px", fontSize: "11.5px", fontWeight: 600, color: T.text3, letterSpacing: ".02em" } }, "\u9644\u4EF6"),
          h(Attachments, { item })
        ) : null
      );
    }
    function DeliveryWorkspace({ item, detail, root, onNavigate, onOpenDecision, onAcceptance, onSignoff, onRelease, onAiReview, onRehearsal, onCancelRun, onRefresh, onDefect, onTrace, onSnapshot, onDiff }) {
      const summaries = detail.summaries ?? {};
      const delivery = summaries.delivery ?? {};
      const run = summaries.run ?? {};
      const review = summaries.review ?? {};
      const acceptance = summaries.acceptance ?? {};
      const candidate = summaries.candidate ?? {};
      const defects = summaries.defects ?? {};
      const release = summaries.release ?? null;
      const attention = (detail.attentionItems ?? []).filter((entry) => entry.kind !== "defect-closed");
      const question = detail.context?.question ?? null;
      const closed = delivery.key === "closed";
      const showQuestion = Boolean(question) || run.awaitingAnswer === true;
      const ai = review.ai ?? summaries.aiReview ?? {};
      const ownDefect = defects.own ?? null;
      const relatedDefects = defects.related ?? [];
      const closedHistory = defects.closedHistory ?? [];
      const acceptanceState = humanAcceptanceState(acceptance);
      const relationIds = relationRows(detail.record?.relations ?? []);
      const traceLink = h(TraceLink, { onClick: onTrace });
      return h(
        "div",
        { "data-detail-content": "delivery", style: { minWidth: 0 } },
        h(
          "section",
          { "data-delivery-outcome": "true", style: { padding: "16px 0 8px" } },
          h("h3", { style: { margin: "0 0 12px", fontSize: "15px", fontWeight: 600 } }, "\u4EA4\u4ED8\u7ED3\u679C"),
          h(DetailRow, { label: "\u68C0\u67E5\u7ED3\u679C" }, h("span", { style: { color: acceptanceState.color } }, acceptanceState.label)),
          acceptance.current === false ? h("p", { style: { color: T.warn, fontSize: "12.5px", lineHeight: 1.7 } }, "\u5DF2\u6709\u9A8C\u6536\u7ED3\u679C\u5DF2\u8FC7\u671F\uFF0C\u4E0D\u80FD\u4F5C\u4E3A\u672C\u6B21\u4EA4\u4ED8\u4F9D\u636E\u3002") : null,
          candidate.exists && candidate.current === false ? h("p", { style: { color: T.warn, fontSize: "12.5px", lineHeight: 1.7 } }, "\u4EA4\u4ED8\u5185\u5BB9\u53D1\u751F\u53D8\u5316\uFF0C\u9700\u8981\u91CD\u65B0\u6574\u7406\u5E76\u9A8C\u6536\u3002") : null,
          h(DetailRow, { label: "\u53D1\u5E03" }, release?.released ? "\u5DF2\u53D1\u5E03" : release?.status === "authorized" || release?.status === "releasing" ? "\u5DF2\u6388\u6743\uFF0C\u5C1A\u672A\u53D1\u5E03" : release?.status === "failed" ? "\u53D1\u5E03\u5931\u8D25" : "\u5C1A\u672A\u53D1\u5E03"),
          run.failure?.message ? h("p", { role: "status", style: { color: T.err, fontSize: "12.5px", lineHeight: 1.7 } }, run.failure.message) : null,
          h("p", { style: { ...DETAIL_SMALL, margin: "12px 0 0" } }, "\u8FD9\u91CC\u4FDD\u7559\u5B8C\u6574\u6280\u672F\u8BB0\u5F55\u3002\u5F53\u524D\u8FDB\u5C55\u548C\u4E0B\u4E00\u6B65\u64CD\u4F5C\u5728\u9875\u9762\u4E0A\u65B9\u3002")
        ),
        h(
          DetailBlock,
          {
            key: "run",
            title: "\u8FD0\u884C\u4E0E\u4EA4\u4ED8",
            sectionId: "delivery-run",
            anchor: "delivery-run",
            aside: h("span", { "data-delivery": delivery.key ?? "unknown", "data-delivery-source": delivery.source ?? void 0, style: { fontSize: "11.5px", color: T.text2 } }, delivery.label ?? "\u2014")
          },
          h(
            "div",
            { style: { display: "grid", gap: "1px" } },
            h(DetailRow, { label: "\u4EA4\u4ED8\u72B6\u6001" }, delivery.reason ? `${delivery.label ?? "\u2014"} \xB7 ${delivery.reason}` : delivery.label ?? "\u2014"),
            h(DetailRow, { label: "\u8FD0\u884C" }, run.exists ? [run.id, run.label ?? run.status, run.phase].filter(Boolean).join(" \xB7 ") : "\u5F53\u524D\u6CA1\u6709\u6D3B\u52A8\u8FD0\u884C"),
            run.exists && run.lastActivityAt ? h(DetailRow, { label: "\u6700\u540E\u6D3B\u52A8" }, formatLocalStamp(run.lastActivityAt)) : null,
            run.failure?.message ? h(DetailRow, { label: "\u5931\u8D25\u539F\u56E0" }, h("span", { style: { color: T.err } }, run.failure.message)) : null,
            candidate.exists ? h(DetailRow, { label: "\u4EA4\u4ED8\u5019\u9009" }, `${candidate.id ?? "\u5019\u9009"}${candidate.current === false ? "\uFF08\u975E\u5F53\u524D\uFF09" : candidate.current === null ? "\uFF08\u6709\u6548\u6027\u672A\u77E5\uFF09" : ""}`) : null
          ),
          h(
            "div",
            { style: { display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "10px" } },
            h("button", { type: "button", "data-detail-secondary": "refresh", onClick: () => onRefresh && onRefresh(), style: DETAIL_GHOST }, "\u5237\u65B0\u72B6\u6001")
          )
        ),
        showQuestion ? h(
          "section",
          { key: "question", "data-detail-anchor": "delivery-question", tabIndex: -1, style: { marginTop: "16px", padding: "12px 14px", borderLeft: `3px solid ${T.warn}`, background: "rgba(231,176,75,.06)", borderRadius: "0 8px 8px 0" } },
          h(
            "div",
            { style: { display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" } },
            h("h3", { style: { margin: 0, fontSize: "12.5px", fontWeight: 600, color: T.warn } }, "AI \u6B63\u5728\u7B49\u5F85\u4F60\u7684\u56DE\u7B54"),
            h("button", { type: "button", "data-detail-question-open": "true", onClick: onOpenDecision, style: { marginLeft: "auto", ...DETAIL_GHOST } }, "\u67E5\u770B\u95EE\u9898\u4E0E\u9009\u9879")
          ),
          question?.title ? h("p", { style: { margin: "6px 0 0", fontSize: "13px", color: T.text } }, question.title) : h("p", { style: { margin: "6px 0 0", ...DETAIL_SMALL } }, "\u8FD0\u884C\u6B63\u5728\u7B49\u5F85\u8F93\u5165\uFF0C\u4F46\u6CA1\u6709\u53EF\u8BFB\u7684\u51B3\u7B56\u6458\u8981\u3002"),
          h("p", { style: { margin: "8px 0 0", ...DETAIL_SMALL } }, "\u5728\u51B3\u7B56\u9762\u677F\u6838\u5BF9\u95EE\u9898\u548C\u9009\u9879\u540E\u56DE\u7B54\u3002\u4FE1\u606F\u4E0D\u5B8C\u6574\u65F6\uFF0C\u53EF\u4EE5\u8981\u6C42 AI \u8865\u5145\uFF1B\u4E0D\u4F1A\u9ED8\u8BA4\u540C\u610F\u63A8\u8350\u65B9\u6848\u3002")
        ) : null,
        attention.length ? h(
          DetailBlock,
          { key: "attention", title: "\u5F85\u5904\u7406\u4E8B\u9879", sectionId: "delivery-attention", anchor: "delivery-attention" },
          h(
            "div",
            { style: { display: "grid", gap: "8px" } },
            attention.map((entry) => {
              const hot = entry.current === true && entry.tone !== "neutral";
              const color = detailToneColor(entry.tone);
              return h(
                "div",
                { key: entry.id, "data-attention-item": entry.id ?? entry.kind, "data-attention-tone": entry.tone ?? "neutral", "data-attention-current": entry.current === true ? "true" : "false", style: { padding: hot ? "8px 10px" : "4px 0", borderLeft: hot ? `2px solid ${color}` : "none", background: hot ? entry.tone === "danger" ? "rgba(255,139,139,.06)" : "rgba(231,176,75,.06)" : "transparent", borderRadius: hot ? "0 6px 6px 0" : 0, minWidth: 0 } },
                h(
                  "div",
                  { style: { display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" } },
                  h("span", { style: { fontSize: "12.5px", fontWeight: 600, color: hot ? color : entry.tone === "neutral" ? T.text3 : T.text } }, entry.title ?? entry.kind),
                  entry.current === true ? h("span", { style: { fontSize: "10.5px", color: T.text3 } }, "\u73B0\u5728\u9700\u8981\u5904\u7406") : null,
                  entry.ref?.tab ? h("button", { type: "button", onClick: () => onNavigate(entry.ref.tab, entry.ref.anchor), style: { marginLeft: "auto", ...DETAIL_GHOST } }, "\u67E5\u770B\u5904\u7406\u4F9D\u636E") : null
                ),
                entry.detail ? h("p", { style: { margin: "2px 0 0", fontSize: "11.5px", lineHeight: 1.6, color: entry.tone === "neutral" ? T.text3 : T.text2 } }, entry.detail) : null
              );
            })
          ),
          h("p", { style: { margin: "8px 0 0", ...DETAIL_SMALL } }, "\u4EE5\u4E0A\u662F\u4EA4\u4ED8\u8BB0\u5F55\u4E2D\u7684\u771F\u5B9E\u72B6\u6001\uFF1B\u4E0D\u6539\u53D8\u89C4\u5219\uFF0C\u4E5F\u4E0D\u4EE3\u8868\u9700\u6C42\u5DF2\u5B8C\u6210\u3002")
        ) : null,
        h(
          DetailBlock,
          { key: "ai-suggestions", title: "AI \u4F18\u5316\u5EFA\u8BAE", sectionId: "delivery-ai-suggestions", anchor: "delivery-ai-suggestions" },
          h("p", { style: DETAIL_SMALL }, "AI \u5EFA\u8BAE\u4EC5\u4F9B\u53C2\u8003\uFF0C\u4E0D\u662F\u5BA1\u6279\u3001\u9A8C\u6536\u6216\u63A8\u8FDB\u95E8\u7981\uFF1B\u4F60\u53EF\u4EE5\u663E\u5F0F\u91C7\u7EB3\u6240\u9009\u5EFA\u8BAE\uFF0C\u4E5F\u53EF\u4EE5\u6682\u4E0D\u91C7\u7EB3\u5E76\u7EE7\u7EED\u3002"),
          ai.stored ? h(
            "div",
            { "data-review-ai": "true", style: { marginTop: "8px", paddingTop: "8px", borderTop: `1px solid ${T.line}` } },
            h("div", { style: { fontSize: "12px", color: T.text2 } }, ["AI \u4F18\u5316\u5EFA\u8BAE\u5DF2\u751F\u6210", ai.verdict ? `\u5EFA\u8BAE\u7EA7\u522B\uFF1A${ai.verdict}` : null, ai.adopted ? "\u5DF2\u5E94\u7528\u6240\u9009\u5EFA\u8BAE" : "\u5C1A\u672A\u5E94\u7528\u5EFA\u8BAE"].filter(Boolean).join(" \xB7 ")),
            ai.suggestions?.length ? h("ul", { style: { margin: "4px 0 0", paddingLeft: "18px", fontSize: "12px", lineHeight: 1.7, color: T.text2 } }, ai.suggestions.map((suggestion, index) => h("li", { key: index }, typeof suggestion === "string" ? suggestion : suggestion?.text ?? suggestion?.title ?? ""))) : null,
            ai.generatedAt ? h("p", { style: { margin: "2px 0 0", ...DETAIL_SMALL } }, `\u751F\u6210\u4E8E ${formatLocalStamp(ai.generatedAt)}`) : null
          ) : h("p", { style: { ...DETAIL_SMALL, marginTop: "8px" } }, "\u5C1A\u672A\u751F\u6210\u4F18\u5316\u5EFA\u8BAE\u3002"),
          h(
            "div",
            { style: { display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap" } },
            onAiReview ? h("button", { type: "button", "data-detail-secondary": "ai-review", onClick: () => onAiReview(item), style: DETAIL_GHOST }, ai.stored ? "\u91CD\u65B0\u751F\u6210\u4F18\u5316\u5EFA\u8BAE" : "AI \u4F18\u5316\u5EFA\u8BAE") : null,
            onRehearsal ? h("button", { type: "button", "data-detail-secondary": "rehearsal", onClick: () => onRehearsal(item), style: DETAIL_GHOST }, "\u53D8\u66F4\u8BD5\u6F14") : null
          )
        ),
        h(
          DetailBlock,
          { key: "acceptance", title: "\u9A8C\u6536\u6267\u884C", sectionId: "delivery-acceptance", anchor: "delivery-acceptance", aside: h("span", { style: { fontSize: "12px", color: acceptanceState.color } }, acceptanceState.label) },
          h(
            "div",
            { style: { display: "grid", gap: "1px" } },
            h(DetailRow, { label: "\u7ED3\u679C" }, acceptanceState.label),
            h(DetailRow, { label: "\u662F\u5426\u9002\u7528" }, acceptance.current === true ? "\u9002\u7528\u4E8E\u5F53\u524D\u5019\u9009" : acceptance.current === false ? "\u5DF2\u4E0D\u9002\u7528\u4E8E\u5F53\u524D\u5019\u9009\uFF08\u8BC1\u636E\u8FC7\u671F\uFF09" : "\u65E0\u6CD5\u5224\u5B9A"),
            acceptance.finishedAt ? h(DetailRow, { label: "\u6700\u8FD1\u6267\u884C" }, formatLocalStamp(acceptance.finishedAt)) : null,
            acceptance.commandCount ? h(DetailRow, { label: "\u547D\u4EE4" }, `${acceptance.commandCount} \u6761`) : null,
            acceptance.headShaShort ? h(DetailRow, { label: "HEAD" }, acceptance.headShaShort) : null,
            acceptance.environment ? h(DetailRow, { label: "\u73AF\u5883" }, acceptance.environment) : null,
            acceptance.provenance?.commandIds?.length ? h(DetailRow, { label: "\u6267\u884C\u547D\u4EE4" }, acceptance.provenance.commandIds.join(" \xB7 ")) : null,
            acceptance.provenance?.ruleCodes?.length ? h(DetailRow, { label: "\u89C4\u5219\u7801" }, acceptance.provenance.ruleCodes.join(" \xB7 ")) : null,
            acceptance.provenance?.evidencePath ? h(DetailRow, { label: "\u8BC1\u636E\u6587\u4EF6" }, acceptance.provenance.evidencePath) : null
          ),
          acceptance.provenance?.headSha || acceptance.headSha ? h(
            "details",
            { style: { marginTop: "8px" } },
            h("summary", { style: { cursor: "pointer", fontSize: "11.5px", color: T.text3 } }, "\u5B8C\u6574\u8BC1\u636E hash \u4E0E\u8BB0\u5F55"),
            h("div", { style: { marginTop: "4px" } }, h(DetailRow, { label: "\u5B8C\u6574 HEAD" }, acceptance.headSha ?? acceptance.provenance.headSha), acceptance.provenance?.evidencePath ? h(DetailRow, { label: "\u8BC1\u636E\u6587\u4EF6" }, acceptance.provenance.evidencePath) : null)
          ) : null,
          onAcceptance && !closed ? h("div", { style: { marginTop: "10px" } }, h("button", { type: "button", "data-detail-secondary": "acceptance", onClick: () => onAcceptance(item), style: DETAIL_GHOST }, acceptance.registered ? "\u91CD\u65B0\u8FD0\u884C\u9A8C\u6536" : "\u8FD0\u884C\u9A8C\u6536")) : null
        ),
        ownDefect || relatedDefects.length || closedHistory.length ? h(
          DetailBlock,
          { key: "defects", title: "\u7F3A\u9677\u5173\u7CFB", sectionId: "delivery-defects", anchor: "delivery-defects" },
          ownDefect ? h(
            "div",
            { "data-defect-own": "true", style: { padding: "4px 0" } },
            h(
              "div",
              { style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } },
              h("span", { style: { fontSize: "12px", color: T.text2 } }, ownDefect.id),
              h("span", { style: { fontSize: "11.5px", color: ownDefect.closed ? T.text3 : T.warn } }, ownDefect.statusLabel ?? ownDefect.status ?? "\u2014"),
              ownDefect.regressionSuspected ? h("span", { style: { fontSize: "11px", color: T.warn } }, "\u7591\u4F3C\u56DE\u5F52") : null,
              ownDefect.occurrenceCount ? h("span", { style: { fontSize: "11px", color: T.text3 } }, `\u51FA\u73B0 ${ownDefect.occurrenceCount} \u6B21`) : null
            ),
            ownDefect.closed ? h("p", { style: { margin: "2px 0 0", ...DETAIL_SMALL } }, "\u7F3A\u9677\u5DF2\u5173\u95ED\uFF0C\u4EC5\u4F5C\u5386\u53F2\u8BB0\u5F55\uFF1B\u4E0D\u4EE3\u8868\u9700\u6C42\u5B8C\u6210\u6216\u672A\u5B8C\u6210\u3002") : onDefect ? h("button", { type: "button", onClick: () => onDefect(item), style: { ...DETAIL_GHOST, marginTop: "6px" } }, "\u5904\u7406\u7F3A\u9677") : null
          ) : null,
          relatedDefects.length ? h(
            "div",
            { style: { marginTop: "8px" } },
            h("div", { style: { fontSize: "11.5px", color: T.text3 } }, "\u76F8\u5173\u7F3A\u9677"),
            relatedDefects.map((defect) => h("div", { key: defect.id ?? defect, "data-defect-related": defect.id ?? defect, style: { fontSize: "12px", color: T.text2, padding: "2px 0" } }, `${defect.id ?? defect}${defect.statusLabel ? " \xB7 " + defect.statusLabel : ""}`))
          ) : null,
          closedHistory.length ? h(
            "details",
            { "data-defect-closed-history": "true", style: { marginTop: "8px" } },
            h("summary", { style: { cursor: "pointer", fontSize: "11.5px", color: T.text3, lineHeight: 1.7 } }, `\u5DF2\u5173\u95ED\u7F3A\u9677\uFF08\u5386\u53F2 ${closedHistory.length}\uFF09`),
            closedHistory.map((defect) => h("div", { key: defect.id ?? defect, style: { fontSize: "11.5px", color: T.text3, padding: "2px 0" } }, `${defect.id ?? defect}${defect.statusLabel ? " \xB7 " + defect.statusLabel : ""}${defect.closedAt ? " \xB7 " + formatLocalStamp(defect.closedAt) : ""}`))
          ) : null
        ) : null,
        h(
          DetailBlock,
          { key: "candidate", title: "\u4EA4\u4ED8\u5019\u9009", sectionId: "delivery-candidate", anchor: "delivery-candidate", aside: candidate.exists ? h("span", { style: { fontSize: "11.5px", color: candidate.current === true ? T.ok : T.warn } }, candidate.current === true ? "\u5F53\u524D\u5019\u9009" : candidate.current === false ? "\u5DF2\u8FC7\u671F" : "\u6709\u6548\u6027\u672A\u77E5") : null },
          candidate.exists ? h(
            "div",
            { style: { display: "grid", gap: "1px" } },
            h(DetailRow, { label: "\u5019\u9009" }, candidate.id ?? "\u2014"),
            candidate.treeHashShort ? h(DetailRow, { label: "\u6811\u54C8\u5E0C" }, candidate.treeHashShort) : null,
            candidate.architecture?.path ? h(DetailRow, { label: "\u5DE5\u7A0B\u6863\u6848" }, `\u5DF2\u5F52\u6863\uFF1A${candidate.architecture.path}`) : null,
            candidate.development?.pushedToRemoteDev ? h(DetailRow, { label: "\u5F00\u53D1\u5206\u652F" }, `\u{1F33F} \u5F00\u53D1\u5206\u652F\u5DF2\u540C\u6B65\uFF1A\u5DF2\u63D0\u4EA4\u5E76\u63A8\u9001\u81F3 origin/${candidate.development.devBranch ?? "develop"}\uFF08Commit: ${(candidate.development.devCommitSha ?? "").slice(0, 7)}\uFF09\xB7 \u67B6\u6784\u4E0E\u6570\u636E\u6863\u6848\u5DF2\u5F52\u6863`) : candidate.development?.reason ? h(DetailRow, { label: "\u5F00\u53D1\u5206\u652F" }, `\u672A\u81EA\u52A8\u540C\u6B65\uFF1A${candidate.development.reason}`) : null,
            candidate.reasons?.length ? h(DetailRow, { label: "\u8BF4\u660E" }, candidate.reasons.join("\uFF1B")) : null
          ) : h(
            "div",
            null,
            h("p", { style: DETAIL_SMALL }, "\u5C1A\u672A\u751F\u6210\u4EA4\u4ED8\u5019\u9009\uFF1B\u5019\u9009\u7ED1\u5B9A\u5F53\u524D\u9700\u6C42\u5185\u5BB9\u4E0E\u5DE5\u4F5C\u533A\u5FEB\u7167\u3002"),
            h(
              "button",
              {
                type: "button",
                "data-create-candidate": "true",
                disabled: isExecutingRequirement(item) || closed,
                title: isExecutingRequirement(item) ? "AI \u6B63\u5728\u63A8\u8FDB\uFF0C\u7ED3\u675F\u540E\u624D\u80FD\u751F\u6210\u4EA4\u4ED8\u5019\u9009" : void 0,
                style: { ...DETAIL_GHOST, marginTop: "6px" },
                onClick: () => {
                  writeJson("candidate", { requirementId: item.id }, root).then(() => onRefresh && onRefresh()).catch((error) => window.alert("\u751F\u6210\u4EA4\u4ED8\u5019\u9009\u5931\u8D25\uFF1A" + error.message));
                }
              },
              "\u751F\u6210\u4EA4\u4ED8\u5019\u9009"
            )
          )
        ),
        h(
          DetailBlock,
          { key: "release", title: "\u53D1\u5E03", sectionId: "delivery-release", anchor: "delivery-release", aside: release?.exists ? h("span", { style: { fontSize: "11.5px", color: release.released ? T.ok : T.text2 } }, release.label ?? release.status ?? "\u2014") : null },
          release?.exists ? h(
            "div",
            { style: { display: "grid", gap: "1px" } },
            h(DetailRow, { label: "\u72B6\u6001" }, release.label ?? release.status ?? "\u2014"),
            release.id ? h(DetailRow, { label: "\u53D1\u5E03\u8BB0\u5F55" }, release.id) : null,
            !release.released && delivery.key === "accepted" ? h("p", { style: { margin: "4px 0 0", ...DETAIL_SMALL } }, "\u9A8C\u6536\u5DF2\u901A\u8FC7\uFF1B\u53D1\u5E03\u51B3\u5B9A\u5728\u5E95\u90E8\u6267\u884C\u3002") : null
          ) : h("p", { style: DETAIL_SMALL }, "\u5C1A\u672A\u53D1\u5E03\u3002")
        ),
        h(
          DetailBlock,
          { key: "trace", title: "\u8BC1\u636E\u4E0E\u8FFD\u6EAF", sectionId: "delivery-trace", anchor: "delivery-trace" },
          h("p", { style: { margin: "0 0 8px", ...DETAIL_SMALL } }, "\u8FFD\u6EAF\u9700\u6C42\u3001\u8FD0\u884C\u3001\u5019\u9009\u3001\u9A8C\u6536\u4E0E\u8BC4\u5BA1\u4E4B\u95F4\u7684\u8BC1\u636E\u94FE\uFF1B\u53EA\u8BFB\u67E5\u770B\u3002"),
          traceLink,
          relationIds.length ? h("p", { style: { margin: "6px 0 0", ...DETAIL_SMALL } }, `\u5DF2\u767B\u8BB0\u5F52\u5C5E\uFF1A${relationIds.map((entry) => entry.label).join(" \xB7 ")}`) : null
        )
      );
    }
    function RunHistory({ root, requirementId, onOpenRun }) {
      const [storedState, setState] = useState(null);
      const state = storedState?.root === root && storedState?.requirementId === requirementId ? storedState : { loading: true, runs: [], error: false, next: null };
      const loadMore = useRef(null);
      useEffect(() => {
        const controller = new AbortController();
        let cursor = null, busy = false;
        setState({ root, requirementId, loading: true, runs: [], error: false, next: null });
        const load = async () => {
          if (busy || controller.signal.aborted) return;
          busy = true;
          setState((previous) => ({ ...previous, loading: true, error: false }));
          const requestController = new AbortController();
          const cancelRequest = () => requestController.abort();
          controller.signal.addEventListener("abort", cancelRequest, { once: true });
          let timeout;
          try {
            const params = new URLSearchParams({ root: root ?? "", requirementId, mode: "history" });
            if (cursor) params.set("before", cursor);
            const { response, data } = await Promise.race([
              fetch(`/api/alm/requirements/run-observation?${params}`, { headers: { accept: "application/json" }, signal: requestController.signal }).then(async (response2) => ({ response: response2, data: await response2.json() })),
              new Promise((_, reject) => {
                timeout = setTimeout(() => {
                  cancelRequest();
                  reject(new Error("history timeout"));
                }, 1e4);
              })
            ]);
            if (!response.ok) throw new Error("unavailable");
            if (!Array.isArray(data.runs) || data.runs.some((run) => !run || typeof run.id !== "string" || !run.id.trim()) || data.next !== null && (typeof data.next !== "string" || !data.next || data.next === cursor)) throw new Error("invalid");
            if (controller.signal.aborted) return;
            cursor = data.next;
            setState((previous) => {
              const runs = new Map(previous.runs.map((run) => [run.id, run]));
              for (const run of data.runs) if (!runs.has(run.id)) runs.set(run.id, run);
              return { root, requirementId, loading: false, runs: [...runs.values()], error: false, next: data.next };
            });
          } catch {
            if (!controller.signal.aborted) setState((previous) => ({ ...previous, loading: false, error: true }));
          } finally {
            clearTimeout(timeout);
            controller.signal.removeEventListener("abort", cancelRequest);
            busy = false;
          }
        };
        loadMore.current = load;
        void load();
        return () => {
          controller.abort();
          loadMore.current = null;
        };
      }, [root, requirementId]);
      const labels = { queued: "\u6392\u961F", running: "\u8FD0\u884C\u4E2D", "waiting-input": "\u7B49\u5F85\u8F93\u5165", paused: "\u6682\u505C", failed: "\u5931\u8D25", done: "\u7ED3\u675F", cancelled: "\u5DF2\u53D6\u6D88" };
      return h(
        "section",
        { "aria-label": "\u8FD0\u884C\u5386\u53F2", style: { borderTop: `1px solid ${T.line}`, marginTop: "18px", paddingTop: "14px" } },
        h("h3", { style: { fontSize: "15px", margin: "0 0 8px" } }, "\u8FD0\u884C\u5386\u53F2"),
        state.loading ? h("p", { role: "status", style: DETAIL_SMALL }, "\u6B63\u5728\u8BFB\u53D6\u8FD0\u884C\u5386\u53F2\u2026") : null,
        state.error ? h("div", { role: "alert", style: DETAIL_SMALL }, "\u8FD0\u884C\u5386\u53F2\u6682\u4E0D\u53EF\u7528\u3002 ", h("button", { type: "button", style: DETAIL_LINK, onClick: () => loadMore.current?.() }, "\u91CD\u8BD5")) : null,
        !state.loading && !state.error && !state.runs.length ? h("p", { style: DETAIL_SMALL }, "\u6682\u65E0\u8FD0\u884C\u8BB0\u5F55\u3002") : null,
        state.runs.length ? h("ol", { style: { margin: 0, paddingLeft: "20px" } }, state.runs.map((run) => h(
          "li",
          { key: run.id, style: { padding: "6px 0", color: T.text2, fontSize: "13px" } },
          h("span", null, `${run.id} \xB7 ${labels[run.status] ?? "\u72B6\u6001\u672A\u77E5"}${run.createdAt ? ` \xB7 ${formatLocalStamp(run.createdAt)}` : ""}`),
          " ",
          h("button", { type: "button", style: DETAIL_LINK, onClick: () => onOpenRun(run.id), "aria-label": `\u67E5\u770B\u8FD0\u884C ${run.id}` }, "\u67E5\u770B\u8FD0\u884C")
        ))) : null,
        state.next && !state.error ? h("button", { type: "button", style: DETAIL_LINK, disabled: state.loading, onClick: () => loadMore.current?.() }, "\u52A0\u8F7D\u66F4\u591A\u8FD0\u884C") : null
      );
    }
    function VisualSpecDiff({ delta }) {
      const before = Array.isArray(delta.acceptanceCriteria?.before) ? delta.acceptanceCriteria.before : [];
      const after = Array.isArray(delta.acceptanceCriteria?.after) ? delta.acceptanceCriteria.after : [];
      const desc = (entry) => typeof entry === "string" ? entry : String(entry?.text ?? entry?.label ?? entry?.expected ?? "");
      const key = (entry, index) => entry?.id || `AC-${String(index + 1).padStart(2, "0")}`;
      const left = new Map(before.map((entry, i) => [key(entry, i), desc(entry)]));
      const right = new Map(after.map((entry, i) => [key(entry, i), desc(entry)]));
      const changes = [];
      for (const [id, text] of right) if (!left.has(id)) changes.push({ type: "added", id, after: text });
      else if (left.get(id) !== text) changes.push({ type: "modified", id, before: left.get(id), after: text });
      for (const [id, text] of left) if (!right.has(id)) changes.push({ type: "removed", id, before: text });
      const fields = [["title", "\u6807\u9898"], ["goal", "\u9884\u671F\u53D8\u5316"], ["problem", "\u4EF7\u503C"]].flatMap(([field, label]) => {
        const a = delta.beforeDocument?.[field], b = delta.afterDocument?.[field];
        return typeof a === "string" && typeof b === "string" && a !== b ? [{ label, before: a, after: b }] : [];
      });
      const count = (type) => changes.filter((entry) => entry.type === type).length + (type === "modified" ? fields.length : 0);
      const box = (label, value, color) => h("div", { style: { borderLeft: `3px solid ${color}`, padding: "6px 10px", whiteSpace: "pre-wrap", overflowWrap: "anywhere", background: T.layer } }, h("strong", null, label), " ", value || "\u2014");
      return h(
        "div",
        { "data-visual-spec-diff": "true", style: { margin: "10px 0", padding: "12px", border: `1px solid ${T.line}`, borderRadius: "8px" } },
        h("div", { style: { display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "10px" } }, h("strong", null, `\u7248\u672C\u5BF9\u6BD4${delta.beforeRevision && delta.revision ? ` (v${delta.beforeRevision} \u2192 v${delta.revision})` : ""}`), h("span", { style: { color: T.ok } }, `+${count("added")} \u65B0\u589E`), h("span", { style: { color: T.warn } }, `~${count("modified")} \u4FEE\u6539`), h("span", { style: { color: T.err } }, `-${count("removed")} \u79FB\u9664`)),
        fields.map((field) => h("div", { key: field.label, style: { marginBottom: "10px" } }, h("strong", null, field.label), box("\u4FEE\u6539\u524D\uFF1A", field.before, T.err), box("\u4FEE\u6539\u540E\uFF1A", field.after, T.ok))),
        changes.map((change) => h("div", { key: change.id, style: { borderLeft: `3px solid ${change.type === "added" ? T.ok : change.type === "removed" ? T.err : T.warn}`, padding: "8px 10px", margin: "6px 0", background: T.layer, overflowWrap: "anywhere" } }, h("strong", { style: { color: change.type === "added" ? T.ok : change.type === "removed" ? T.err : T.warn } }, `${change.type === "added" ? "+ \u65B0\u589E" : change.type === "removed" ? "- \u79FB\u9664" : "~ \u4FEE\u6539"} ${change.id}`), change.type === "modified" ? h("div", null, box("\u4FEE\u6539\u524D\uFF1A", change.before, T.err), box("\u4FEE\u6539\u540E\uFF1A", change.after, T.ok)) : h("div", { style: { textDecoration: change.type === "removed" ? "line-through" : "none" } }, change.after ?? change.before))),
        !fields.length && !changes.length ? h("p", { style: DETAIL_SMALL }, "\u672C\u6B21\u672A\u8BB0\u5F55\u53EF\u5C55\u793A\u7684\u9700\u6C42\u6216\u9A8C\u6536\u53D8\u66F4\u3002") : null
      );
    }
    function timelineStyle(entry) {
      if (["candidate", "human-signoff", "release"].includes(entry.kind)) return { color: T.ok, label: entry.kind === "candidate" ? "\u4EA4\u4ED8\u5019\u9009" : entry.kind === "human-signoff" ? "\u4EBA\u5DE5\u7B7E\u6536" : "\u53D1\u5E03\u5F52\u6863" };
      if (entry.kind === "spec_converged") return { color: T.brand, label: entry.title?.match(/v\d+\s*→\s*v\d+/u)?.[0] ?? "\u7248\u672C\u6F14\u8FDB" };
      return { color: T.text3, label: entry.kind === "run" ? "\u542F\u52A8\u63A8\u8FDB" : entry.kind === "created" ? "\u521B\u5EFA\u9700\u6C42" : "\u8BB0\u5F55" };
    }
    function CollectedTimeline({ root, requirementId, record, onNavigate, onRefresh }) {
      const [state, setState] = useState({ older: [], next: record.timelineOmitted ?? 0, loading: false, error: null, loaded: 0 });
      const controllerRef = useRef(null);
      const recordRef = useRef(record);
      useEffect(() => () => {
        const controller = controllerRef.current;
        controllerRef.current = null;
        controller?.abort();
      }, []);
      useEffect(() => {
        if (recordRef.current === record) return;
        recordRef.current = record;
        const controller = controllerRef.current;
        controllerRef.current = null;
        controller?.abort();
        setState({ older: [], next: record.timelineOmitted ?? 0, loading: false, error: null, loaded: 0 });
      }, [record]);
      const load = async () => {
        if (state.loading || !state.next || state.error === "changed" || controllerRef.current) return;
        const controller = new AbortController();
        controllerRef.current = controller;
        setState((previous) => ({ ...previous, loading: true, error: null }));
        let timeout;
        try {
          const params = new URLSearchParams({ root: root ?? "", requirementId, mode: "timeline", before: String(state.next), fingerprint: record.timelineFingerprint ?? "" });
          const { response, data } = await Promise.race([
            fetch(`/api/alm/requirements/run-observation?${params}`, { headers: { accept: "application/json" }, signal: controller.signal }).then(async (response2) => ({ response: response2, data: await response2.json() })),
            new Promise((_, reject) => {
              timeout = setTimeout(() => {
                controller.abort();
                reject(new Error("timeout"));
              }, 1e4);
            })
          ]);
          if (response.status === 409) throw new Error("changed");
          if (!response.ok || data.fingerprint !== record.timelineFingerprint || !Array.isArray(data.entries) || !data.entries.length || data.entries.some((entry) => !entry || typeof entry.at !== "string" || typeof entry.kind !== "string") || data.next !== null && (!Number.isSafeInteger(data.next) || data.next < 1 || data.next >= state.next) || data.entries.length !== state.next - (data.next ?? 0)) throw new Error("invalid");
          if (!controller.signal.aborted) setState((previous) => ({ older: [...data.entries, ...previous.older], next: data.next, loading: false, error: null, loaded: data.entries.length }));
        } catch (error) {
          if (controllerRef.current === controller) setState((previous) => ({ ...previous, loading: false, error: error?.message === "changed" ? "changed" : "unavailable" }));
        } finally {
          clearTimeout(timeout);
          if (controllerRef.current === controller) controllerRef.current = null;
        }
      };
      const timeline = [...state.older, ...record.timeline ?? []];
      return h(
        DetailBlock,
        { title: "\u7248\u672C\u6F14\u8FDB\u4E0E\u4E8B\u4EF6\u65F6\u95F4\u7EBF", sectionId: "record-timeline", anchor: "record-timeline" },
        state.error ? h("p", { role: "alert", style: DETAIL_SMALL }, state.error === "changed" ? "\u65F6\u95F4\u7EBF\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u9700\u6C42\u540E\u91CD\u65B0\u8BFB\u53D6\u3002" : "\u8F83\u65E9\u4E8B\u4EF6\u6682\u4E0D\u53EF\u7528\uFF0C\u8BF7\u91CD\u8BD5\u3002") : null,
        (state.error === "changed" || state.next && !record.timelineFingerprint) && onRefresh ? h("button", { type: "button", style: DETAIL_LINK, onClick: onRefresh }, "\u5237\u65B0\u9700\u6C42") : null,
        h("p", { role: "status", "aria-live": "polite", style: { ...DETAIL_SMALL, margin: state.loading || !state.error && state.loaded ? "6px 0" : 0 } }, state.loading ? "\u6B63\u5728\u8BFB\u53D6\u8F83\u65E9\u4E8B\u4EF6\u2026" : !state.error && state.loaded ? `\u5DF2\u8BFB\u53D6 ${state.loaded} \u6761\u8F83\u65E9\u4E8B\u4EF6\u3002` : ""),
        state.next && !record.timelineFingerprint ? h("p", { style: DETAIL_SMALL }, `\u53E6\u6709 ${state.next} \u6761\u8F83\u65E9\u4E8B\u4EF6\uFF1B\u8BF7\u5237\u65B0\u9700\u6C42\u540E\u8BFB\u53D6\u3002`) : null,
        record.timelineOmitted > 0 && record.timelineFingerprint ? h("button", { type: "button", style: { ...DETAIL_LINK, cursor: state.loading || !state.next || state.error === "changed" ? "not-allowed" : "pointer" }, "aria-disabled": state.loading || !state.next || state.error === "changed", onClick: load }, state.loading ? "\u8BFB\u53D6\u4E2D\u2026" : state.error === "changed" ? "\u8BF7\u5237\u65B0\u9700\u6C42\u540E\u8BFB\u53D6" : state.next ? `\u52A0\u8F7D\u8F83\u65E9\u4E8B\u4EF6\uFF08\u5269\u4F59 ${state.next} \u6761\uFF09` : "\u5DF2\u663E\u793A\u5168\u90E8\u5DF2\u6536\u96C6\u4E8B\u4EF6") : null,
        timeline.length ? h("ul", { "data-version-timeline": "true", style: { position: "relative", margin: "12px 0 0 8px", paddingLeft: "18px", borderLeft: `1px solid ${T.line}`, display: "grid", gap: "14px", listStyle: "none" } }, [...timeline].reverse().map((entry, index) => {
          const appearance = timelineStyle(entry);
          return h(
            "li",
            { key: `${entry.at ?? "event"}-${index}`, style: { position: "relative", fontSize: "12px", color: T.text2, lineHeight: 1.6, minWidth: 0 } },
            h("span", { "aria-hidden": "true", style: { position: "absolute", left: "-24px", top: "5px", width: "10px", height: "10px", borderRadius: "50%", background: appearance.color, boxShadow: `0 0 0 3px ${T.bg ?? T.layer}` } }),
            h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } }, h("span", { style: { color: appearance.color, background: T.layer2, border: `1px solid ${appearance.color}`, borderRadius: "999px", padding: "1px 7px", fontSize: "11px", fontWeight: 600 } }, appearance.label), h("time", { dateTime: entry.at, style: { color: T.text3, fontSize: "11px", flex: "none" } }, formatLocalStamp(entry.at))),
            h("div", { style: { color: T.text, marginTop: "3px", fontWeight: 600, overflowWrap: "anywhere" } }, entry.title ?? entry.kind ?? "\u4E8B\u4EF6"),
            entry.detail ? h("div", { style: { color: T.text3, fontSize: "11.5px", marginTop: "3px", overflowWrap: "anywhere" } }, entry.detail) : null,
            entry.specDelta ? h("details", { style: { marginTop: "7px" } }, h("summary", { style: { cursor: "pointer" } }, "\u67E5\u770B\u9700\u6C42\u4E0E\u9A8C\u6536\u53D8\u66F4"), h(VisualSpecDiff, { delta: entry.specDelta })) : null
          );
        })) : h("p", { style: DETAIL_SMALL }, "\u6682\u65E0\u5386\u53F2\u8BB0\u5F55\u3002")
      );
    }
    function RequirementRecord({ item, detail, allItems, projectMeta, root, onSnapshot, onDiff, onTrace, onNavigate, onOpenRun, onRefresh }) {
      const record = detail.record ?? {};
      const relations = relationRows((record.relations ?? []).length ? record.relations : relationsOf(item, allItems)).filter((entry) => entry.ids?.length);
      const github = record.github;
      const githubLinks = record.githubLinks ?? detail.githubLinks;
      const architecture = record.architecture;
      const defects = detail.summaries?.defects ?? {};
      const hasDefects = defects.own || defects.related?.length || defects.closedHistory?.length;
      const evidence = Array.isArray(item.investigationEvidence) ? item.investigationEvidence : [];
      const fingerprint = String(item.docMeta?.docHash ?? "").replace(/^sha256:/, "").slice(0, 8);
      return h(
        "div",
        { "data-detail-content": "record", style: { minWidth: 0 } },
        h(CollectedTimeline, { key: `${item.root ?? root}:${item.id}:${record.timelineFingerprint ?? ""}`, root: item.root ?? root, requirementId: item.id, record, onNavigate, onRefresh }),
        h(ArchitectureLedgerPanel, { architecture, release: detail.summaries?.release, githubLinks }),
        h(GitHubDeliveryLinks, { links: githubLinks, showCompare: true }),
        relations.length ? h(DetailBlock, { title: "\u5F52\u5C5E\u5173\u7CFB", sectionId: "record-relations" }, relations.map((entry) => h(DetailRow, { key: entry.label, label: entry.label }, entry.ids.join("\u3001")))) : null,
        github && (github.issue || github.url || github.board || github.tasks) ? h(DetailBlock, { title: "GitHub", sectionId: "record-github" }, github.issue ? h(DetailRow, { label: "Issue" }, github.issue) : null, github.url ? h(DetailRow, { label: "\u94FE\u63A5" }, safeHttpHref(github.url) ? h("a", { href: github.url, target: "_blank", rel: "noreferrer" }, github.url) : github.url) : null, github.board ? h(DetailRow, { label: "\u770B\u677F" }, github.board) : null) : null,
        hasDefects ? h(DetailBlock, { title: "\u7F3A\u9677\u8BB0\u5F55", sectionId: "record-defects" }, [defects.own, ...defects.related ?? [], ...defects.closedHistory ?? []].filter(Boolean).map((defect, index) => h(DetailRow, { key: index, label: "\u7F3A\u9677" }, `${defect.id ?? defect}${defect.statusLabel ? " \xB7 " + defect.statusLabel : ""}`))) : null,
        h(
          "details",
          { style: { marginTop: "24px", color: T.text2 } },
          h("summary", { style: { cursor: "pointer" } }, "\u8C03\u67E5\u8BC1\u636E\u4E0E\u6280\u672F\u8BCA\u65AD"),
          evidence.length ? h("ul", { style: { paddingLeft: "20px", lineHeight: 1.8, overflowWrap: "anywhere" } }, evidence.map((ref, index) => h("li", { key: index }, [ref.investigationId, ref.path + (ref.line ? `:${ref.line}${ref.endLine && ref.endLine !== ref.line ? `\u2013${ref.endLine}` : ""}` : "")].filter(Boolean).join(" \xB7 ")))) : h("p", { style: DETAIL_SMALL }, "\u6682\u65E0\u8C03\u67E5\u8BC1\u636E\u3002"),
          fingerprint ? h("p", { style: DETAIL_SMALL }, `\u5185\u5BB9\u6307\u7EB9\uFF1A${fingerprint}`) : null,
          onTrace ? h(TraceLink, { onClick: onTrace }) : null
        )
      );
    }
    function ContextActionFooter({ detail, onNavigate, handlers, startIsolate, onToggleIsolate, narrow }) {
      const action = detail.primaryAction ?? null;
      const context = detail.context ?? {};
      const startLike = Boolean(action && (action.id === "start" || action.id === "start-fix"));
      const secondary = (detail.secondaryActions ?? []).filter((entry) => entry && entry.id !== action?.id).slice(0, 2);
      const enabled = Boolean(action) && action.enabled !== false;
      const runEntry = (entry) => {
        if (!entry || entry.enabled === false) return;
        const fn = handlers[entry.id];
        if (fn) fn(entry);
      };
      return h(
        "footer",
        { "data-detail-footer": "true", style: { flex: "none", borderTop: `1px solid ${T.line}`, background: T.base, padding: narrow ? "9px 16px 10px" : "10px 24px 11px" } },
        h(
          "div",
          { style: { maxWidth: "720px", margin: "0 auto", display: "flex", flexDirection: narrow ? "column" : "row", alignItems: narrow ? "stretch" : "center", gap: "10px", flexWrap: "wrap", minWidth: 0 } },
          h(
            "div",
            { style: { flex: narrow ? "none" : "1 1 200px", minWidth: 0 } },
            h("div", { style: { fontSize: "11.5px", color: T.text3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, context.headline ? `\u5F53\u524D\uFF1A${context.headline}` : "\u5F53\u524D\u72B6\u6001\u672A\u77E5"),
            action && enabled === false && action.reason ? h("div", { style: { fontSize: "11px", color: T.text3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, action.reason) : null
          ),
          secondary.length ? h(
            "div",
            { style: { display: "flex", gap: "8px", flexWrap: "wrap", flex: "none", justifyContent: narrow ? "flex-start" : "flex-end" } },
            secondary.map(
              (entry) => h(
                "button",
                { key: entry.id, type: "button", disabled: entry.enabled === false, title: entry.reason ?? entry.label ?? entry.id, "data-detail-secondary": entry.id, onClick: () => runEntry(entry), style: { ...DETAIL_LINK, opacity: entry.enabled === false ? 0.5 : 1 } },
                entry.label ?? entry.id
              )
            )
          ) : null,
          startLike ? h(
            "label",
            { "data-detail-launch-config": "true", title: "\u9694\u79BB worktree\uFF1A\u5728\u72EC\u7ACB\u5DE5\u4F5C\u533A\u5F00\u53D1\uFF0C\u4E0D\u6539\u52A8\u4E3B\u5DE5\u4F5C\u533A", style: { display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "11.5px", color: T.text3, cursor: "pointer", flex: "none" } },
            h("input", { type: "checkbox", checked: startIsolate, onChange: (event) => onToggleIsolate(event.target.checked) }),
            "\u542F\u52A8\u914D\u7F6E\uFF1A\u5728\u72EC\u7ACB\u5DE5\u4F5C\u533A\u5F00\u53D1"
          ) : null,
          action ? h("button", { type: "button", "data-primary-action": action.id, disabled: !enabled, title: enabled ? action.label ?? "" : action.reason ?? action.label ?? "", onClick: () => runEntry(action), style: { ...DETAIL_PRIMARY, width: narrow ? "100%" : void 0, opacity: enabled ? 1 : 0.55, cursor: enabled ? "pointer" : "not-allowed" } }, action.label ?? "\u7EE7\u7EED") : h("span", { "data-primary-action-none": "true", style: { fontSize: "11.5px", color: T.text3 } }, context.kind === "closed" ? "\u5DF2\u5173\u95ED\uFF1A\u6CA1\u6709\u53EF\u63A8\u8FDB\u7684\u52A8\u4F5C" : "\u5F53\u524D\u6CA1\u6709\u53EF\u6267\u884C\u7684\u52A8\u4F5C")
        ),
        h("div", { "data-detail-disclaimer": "true", style: { maxWidth: "720px", margin: narrow ? "8px auto 0" : "4px auto 0", fontSize: "10.5px", color: T.text3, lineHeight: 1.6, overflowWrap: "anywhere" } }, "AI \u4EA7\u51FA\u9700\u4EBA\u5DE5\u6838\u5BF9\uFF1B\u7248\u672C\u3001\u6388\u6743\u4E0E\u8BC1\u636E\u4EE5\u670D\u52A1\u7AEF\u6821\u9A8C\u4E3A\u51C6\u3002")
      );
    }
    function DecisionTextModal({ item, root, onClose }) {
      const [state, setState] = useState({ loading: true, text: null, decision: null, error: null });
      useEffect(() => {
        let alive = true;
        writeJson("run", { mode: "decision", requirementId: item.id }, root).then(
          (payload) => {
            if (!alive) return;
            setState({ loading: false, text: payload?.text ?? payload?.result?.text ?? null, decision: payload?.decision ?? payload?.result?.decision ?? null, error: null });
          },
          (error) => {
            if (!alive) return;
            setState({ loading: false, text: null, decision: null, error: error?.message ?? "\u8BFB\u53D6\u5931\u8D25" });
          }
        );
        return () => {
          alive = false;
        };
      }, [item.id, root]);
      return h(
        ModalShell,
        { title: `\u51B3\u7B56\u8BF7\u6C42\u539F\u6587 \xB7 ${item.id}`, lead: "\u53EA\u8BFB\uFF1A\u8FD9\u91CC\u4E0D\u4F1A\u63D0\u4EA4\u56DE\u7B54\uFF0C\u4E5F\u4E0D\u4F1A\u6062\u590D\u8FD0\u884C\u3002", onClose, feedbackContext: feedbackContextFor(item), width: "780px", footer: h("button", { type: "button", onClick: onClose, style: DETAIL_GHOST }, "\u5173\u95ED") },
        state.loading ? h("p", { style: DETAIL_SMALL }, "\u6B63\u5728\u8BFB\u53D6\u51B3\u7B56\u8BF7\u6C42\u2026") : state.error ? h("p", { style: { margin: 0, fontSize: "12.5px", color: T.err } }, `\u8BFB\u53D6\u5931\u8D25\uFF1A${state.error}`) : [
          state.decision ? h("p", { key: "decision", style: { margin: "0 0 8px", fontSize: "12px", color: T.text3 } }, `\u51B3\u7B56\u8BF7\u6C42\uFF1A${state.decision}`) : null,
          state.text ? h("pre", { key: "text", style: { margin: 0, padding: "10px 12px", border: `1px solid ${T.line}`, borderRadius: "8px", background: T.layer, color: T.text2, fontSize: "12px", lineHeight: 1.7, whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: "52vh", overflow: "auto" } }, state.text) : h("p", { key: "none", style: DETAIL_SMALL }, "\u6CA1\u6709\u627E\u5230\u51B3\u7B56\u8BF7\u6C42\u539F\u6587\u3002")
        ]
      );
    }
    function InlineRequirementEditor({ item, root, onDone, onCancel, onDirty }) {
      const [draft, setDraft] = useState({ title: item.title ?? "", brief: item.briefText ?? "" });
      const [state, setState] = useState({ busy: false, error: null, preview: null });
      const [key] = useState(() => `inline-${item.id}-${Date.now().toString(36)}`);
      const changes = ["title", "brief"].filter((field) => draft[field] !== (field === "title" ? item.title ?? "" : item.briefText ?? "")).map((field) => ({ field, value: draft[field] }));
      useEffect(() => {
        onDirty?.(changes.length > 0);
      }, [draft]);
      const preview = async () => {
        setState({ busy: true, error: null, preview: null });
        try {
          const result = await writeJson("rehearsal", { requirementId: item.id, changes }, root);
          setState({ busy: false, error: null, preview: result });
        } catch (error) {
          setState({ busy: false, error: error.message, preview: null });
        }
      };
      const save = async () => {
        if (!state.preview || state.busy) return;
        setState((current) => ({ ...current, busy: true, error: null }));
        try {
          const result = await writeJson("rehearsal", { requirementId: item.id, changes, apply: true, expectedBaseline: state.preview.baseline, actor: "human:local", idempotencyKey: key }, root);
          if (result.applied === false) throw new Error(result.message ?? "\u5C1A\u672A\u4FDD\u5B58\uFF0C\u8BF7\u68C0\u67E5\u53D8\u66F4");
          onDirty?.(false);
          onDone?.();
        } catch (error) {
          setState({ busy: false, preview: null, error: `\u672A\u4FDD\u5B58\uFF1A${error.message}\u3002\u8349\u7A3F\u5DF2\u4FDD\u7559\uFF0C\u8BF7\u91CD\u65B0\u9884\u89C8\u5F53\u524D\u57FA\u7EBF\u3002` });
        }
      };
      return h(
        "section",
        { "aria-label": "\u7F16\u8F91\u9700\u6C42", style: { margin: "24px 0" } },
        ...[["title", "\u6807\u9898"], ["brief", "\u539F\u59CB\u8BC9\u6C42\u4E0E\u80CC\u666F"]].map(([field, label]) => h(
          "label",
          { key: field, style: { display: "block", marginBottom: "16px" } },
          label,
          h(field === "brief" ? "textarea" : "input", { name: `requirement-${field}`, autoComplete: "off", style: { ...input, display: "block", width: "100%", marginTop: "6px", ...field === "brief" ? { minHeight: "220px", lineHeight: 1.6 } : {} }, value: draft[field], disabled: state.busy, onChange: (event) => {
            setDraft((current) => ({ ...current, [field]: event.target.value }));
            setState({ busy: false, error: null, preview: null });
          } })
        )),
        state.error ? h("p", { role: "alert", tabIndex: -1, ref: (node) => node?.focus?.(), style: { color: T.err } }, state.error) : null,
        state.preview ? h("div", null, h("p", null, "\u4FDD\u5B58\u4F1A\u4F7F\u76F8\u5173\u9A8C\u6536\u8BC1\u636E\u5931\u6548\uFF0C\u9700\u8981\u91CD\u65B0\u9A8C\u8BC1\uFF1B\u4E0D\u4F1A\u81EA\u52A8\u9A8C\u6536\u6216\u53D1\u5E03\u3002"), ...changes.map((change) => h("section", { key: change.field, style: { marginBottom: "16px" } }, h("strong", null, change.field === "title" ? "\u6807\u9898\u53D8\u66F4" : "\u80CC\u666F\u53D8\u66F4"), h("div", { style: { whiteSpace: "pre-wrap", color: T.text3 } }, `\u539F\uFF1A${change.field === "title" ? item.title : item.briefText ?? ""}`), h("div", { style: { whiteSpace: "pre-wrap" } }, `\u65B0\uFF1A${change.value}`)))) : null,
        h("div", { style: { display: "flex", gap: "8px" } }, h("button", { style: primary, disabled: state.busy || !changes.length, onClick: state.preview ? save : preview }, state.busy ? "\u5904\u7406\u4E2D\u2026" : state.preview ? "\u786E\u8BA4\u4FDD\u5B58" : "\u9884\u89C8\u53D8\u66F4"), h("button", { style: button, disabled: state.busy, onClick: onCancel }, "\u53D6\u6D88\u7F16\u8F91"))
      );
    }
    function humanDescriptionBlocks(model) {
      const doc = model?.doc ?? {};
      if (model?.displaySections?.length) return model.displaySections;
      const blocks = [];
      const seen = /* @__PURE__ */ new Set();
      const add = (title, text) => {
        const value = draftText(text).trim();
        const key = value.replace(/\*\*|[\s]+/g, "");
        if (!value || seen.has(key)) return;
        seen.add(key);
        blocks.push({ title, text: value });
      };
      const addLegacy = (text, fallback) => {
        const value = draftText(text).replace(/\r\n?/g, "\n").trim();
        const headings = [...value.matchAll(/^(?:#{1,6}[ \t]+)?(?:\*\*)?(背景|目标|问题与场景)(?:\*\*)?[ \t]*(?:[：:][ \t]*|\n)/gm)];
        if (!headings.length) return add(fallback, value);
        add(fallback, value.slice(0, headings[0].index));
        headings.forEach((heading, index) => add(heading[1] === "\u76EE\u6807" ? "\u9884\u671F\u53D8\u5316" : "\u4EF7\u503C", value.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? value.length)));
      };
      if (model?.status === "legacy") {
        addLegacy(doc.goal, "\u9884\u671F\u53D8\u5316");
        addLegacy(doc.problem, "\u4EF7\u503C");
      } else {
        add("\u9884\u671F\u53D8\u5316", doc.goal);
        add("\u4EF7\u503C", doc.problem);
      }
      return blocks.sort((a, b) => Number(b.title === "\u9884\u671F\u53D8\u5316") - Number(a.title === "\u9884\u671F\u53D8\u5316"));
    }
    function humanMatterCopy(matter) {
      const kind = matter?.kind;
      if (kind === "automatic") {
        const phase = matter.progress?.phase;
        return { label: "AI \u63A8\u8FDB\u4E2D", title: ["test", "verify", "acceptance"].includes(phase) ? "AI \u6B63\u5728\u9A8C\u8BC1\u7ED3\u679C" : phase === "implement" ? "AI \u6B63\u5728\u5F00\u53D1" : "AI \u6B63\u5728\u5904\u7406", description: "\u6B63\u5728\u5B8C\u6210\u672C\u8F6E\u5DE5\u4F5C\u3002\u9700\u8981\u4F60\u505A\u4E1A\u52A1\u51B3\u5B9A\u6216\u9A8C\u6536\u65F6\uFF0C\u4F1A\u5728\u8FD9\u91CC\u63D0\u793A\u3002", next: "\u6682\u65F6\u65E0\u9700\u4F60\u64CD\u4F5C\u3002" };
      }
      if (kind === "awaiting-acceptance") return { label: "\u9700\u8981\u4F60\u9A8C\u6536", title: "\u8BF7\u786E\u8BA4\u8FD9\u6B21\u4EA4\u4ED8\u662F\u5426\u7B26\u5408\u9884\u671F", description: "AI \u5DF2\u63D0\u4EA4\u5F53\u524D\u4EA4\u4ED8\u5019\u9009\uFF0C\u8BF7\u6838\u5BF9\u5B9E\u9645\u6548\u679C\u548C\u9A8C\u6536\u8981\u6C42\u3002" };
      if (kind === "not-started") return { label: "\u4E0B\u4E00\u6B65", title: "\u4EA4\u7ED9 AI \u63A8\u8FDB", description: "AI \u4F1A\u6839\u636E\u8FD9\u6761\u9700\u6C42\u5B8C\u6210\u5F00\u53D1\u548C\u9A8C\u8BC1\uFF0C\u9047\u5230\u4E1A\u52A1\u53D6\u820D\u518D\u8BF7\u4F60\u51B3\u5B9A\u3002" };
      if (kind === "unverified" && matter.progress?.phase === "review-result" && matter.action?.id === "continue-run") return { label: "\u7B49\u5F85\u7EE7\u7EED", title: "AI \u5DF2\u4EA4\u56DE\u672C\u8F6E\u7ED3\u679C", description: "\u4F60\u53EF\u4EE5\u7EE7\u7EED\u63A8\u8FDB\uFF0C\u8BA9 AI \u63A5\u7740\u5904\u7406\u8FD9\u6761\u9700\u6C42\u3002\u5F53\u524D\u4EA4\u4ED8\u662F\u5426\u6EE1\u8DB3\u8981\u6C42\uFF0C\u8BF7\u4EE5\u4EA4\u4ED8\u9A8C\u8BC1\u7ED3\u679C\u4E3A\u51C6\u3002" };
      const labels = { accepted: "\u5DF2\u9A8C\u6536", released: "\u5DF2\u53D1\u5E03", closed: "\u5DF2\u5173\u95ED", "technical-block": "\u63A8\u8FDB\u5DF2\u6682\u505C" };
      const explanation = String(matter?.explanation ?? "").replace(/(?:运行\s*)?RUN-[A-Za-z0-9-]+\s*/g, "").trim();
      return { label: labels[kind] ?? "\u5F53\u524D\u8FDB\u5C55", title: matter?.headline ?? "\u7B49\u5F85\u4E0B\u4E00\u6B65", description: explanation || "\u8BF7\u67E5\u770B\u672C\u8F6E\u7ED3\u679C\u540E\u7EE7\u7EED\u3002" };
    }
    function HumanLongDescription({ text, paragraph, preview }) {
      const [expanded, setExpanded] = useState(false);
      return h(
        "div",
        null,
        h("p", { "data-human-excerpt": "true", hidden: expanded, style: paragraph }, `${preview(text).slice(0, 180)}\u2026`),
        h(
          "details",
          { style: { marginTop: "6px" }, onToggle: (event) => setExpanded(event.currentTarget.open) },
          h("summary", { style: { fontSize: "12px", color: T.text3, cursor: "pointer" } }, expanded ? "\u6536\u8D77\u5B8C\u6574\u5185\u5BB9" : "\u5C55\u5F00\u8FD9\u6BB5\u5B8C\u6574\u5185\u5BB9"),
          h("div", { style: paragraph }, renderRich(text))
        )
      );
    }
    function HumanDescriptionBody({ model, status }) {
      const doc = model?.doc ?? {};
      const features = (Array.isArray(doc.features) ? doc.features : []).filter((feature) => draftText(feature?.title) || draftText(feature?.behavior));
      const pending = (Array.isArray(doc.pending) ? doc.pending : []).filter((entry) => typeof entry === "string" ? entry.trim() : (!entry?.status || entry.status === "open") && draftText(entry?.text));
      const scope = draftList(doc.scope), excluded = draftList(doc.outOfScope), constraints = draftList(doc.constraints);
      const blocks = humanDescriptionBlocks(model);
      const paragraph = { margin: "6px 0 0", fontSize: "15px", color: T.text2, lineHeight: 1.8, overflowWrap: "anywhere" };
      const preview = (value) => String(value ?? "").replace(/^#{1,6}\s+/gm, "").replace(/^>\s?/gm, "").replace(/^\s*(?:[-*]|\d+\.)\s+/gm, "").replace(/`([^`]+)`/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").trim();
      const rows = (label, values) => values.length ? h("div", { style: { marginTop: "16px" } }, h("h3", { style: { margin: 0, fontSize: "13px", color: T.text } }, label), h("ul", { style: { ...paragraph, paddingLeft: "20px" } }, values.map((text, index) => h("li", { key: index }, text)))) : null;
      return h(
        "div",
        { "data-human-description": "true" },
        h("div", { className: "description-cards" }, blocks.map((block, index) => h(
          "div",
          { key: index, "data-human-long": block.text.length > 180 ? "true" : void 0, style: { padding: "12px", border: `1px solid ${T.line}`, borderRadius: "10px", background: T.layer } },
          index === 0 && status === "unconfirmed" ? descriptionStatusBadge(status) : null,
          h("h3", { style: { margin: 0, fontSize: "13px", fontWeight: 600, color: T.text } }, block.title || "\u9884\u671F\u53D8\u5316"),
          block.text.length > 180 ? h(HumanLongDescription, { text: block.text, paragraph, preview }) : h("div", { style: paragraph }, renderRich(block.text))
        ))),
        features.length ? h(
          "div",
          { "data-human-features": "true", style: { marginTop: "20px" } },
          h("h3", { style: { margin: "0 0 8px", fontSize: "13px" } }, "\u5177\u4F53\u8981\u505A\u5230"),
          features.map((feature, index) => h(
            "div",
            { key: feature.id ?? index, "data-detail-fr": feature.id, style: { margin: "12px 0" } },
            feature.title ? h("strong", { style: { fontSize: "14px", fontWeight: 600 } }, feature.title) : null,
            feature.behavior ? h("p", { style: paragraph }, draftText(feature.behavior)) : null,
            feature.preconditions?.length || feature.response || feature.boundaries?.length ? h("details", { style: { marginTop: "4px" } }, h("summary", { style: { color: T.text3, fontSize: "12px", cursor: "pointer" } }, "\u9002\u7528\u6761\u4EF6\u4E0E\u8FB9\u754C"), rows("\u9002\u7528\u6761\u4EF6", draftList(feature.preconditions)), feature.response ? h("p", { style: paragraph }, draftText(feature.response)) : null, rows("\u8FB9\u754C", draftList(feature.boundaries))) : null
          ))
        ) : null,
        rows("\u672C\u6B21\u8303\u56F4", scope),
        rows("\u672C\u6B21\u4E0D\u5305\u542B", excluded),
        rows("\u5FC5\u987B\u9075\u5B88", constraints),
        pending.length ? h("div", { "data-detail-pending": "true", style: { marginTop: "20px", borderLeft: `2px solid ${T.warn}`, paddingLeft: "12px" } }, h("strong", { style: { fontSize: "13px" } }, "\u5F85\u786E\u8BA4\u7684\u4E1A\u52A1\u95EE\u9898"), h("ul", { style: { ...paragraph, paddingLeft: "20px" } }, pending.map((entry, index) => h("li", { key: index }, typeof entry === "string" ? entry : draftText(entry.text))))) : null
      );
    }
    function HumanVerification({ item, detail, matter }) {
      const summary = detail.verificationSummary ?? {};
      const sourceCriteria = detail.content?.acceptanceCriteria?.length ? detail.content.acceptanceCriteria.map((entry) => ({ ...entry, ...(summary.criteria ?? []).find((result) => result.id === entry.id) })) : detail.content?.doc?.acceptance?.length ? detail.content.doc.acceptance.map((entry) => ({ ...entry, ...(summary.criteria ?? []).find((result) => result.id === entry.id) })) : summary.criteria ?? [];
      const criteria = [...sourceCriteria].sort((left, right) => {
        if (Boolean(left?.legacyBaseline) !== Boolean(right?.legacyBaseline)) return left?.legacyBaseline ? -1 : 1;
        if (left?.legacyBaseline && right?.legacyBaseline) return 0;
        const number = (entry) => Number(/^AC-(\d+)$/i.exec(String(entry?.id ?? "").trim())?.[1] ?? Number.MAX_SAFE_INTEGER);
        const byNumber = number(left) - number(right);
        return byNumber || String(left?.id ?? "").localeCompare(String(right?.id ?? ""));
      });
      const statusMeta2 = (status) => {
        if (status === "accepted") return { label: "\u{1F7E2} \u5DF2\u9A8C\u6536", color: T.ok };
        if (status === "verified") return { label: "\u{1F7E2} \u5DF2\u9A8C\u8BC1\uFF08\u5F85\u7B7E\u6536\uFF09", color: T.ok };
        if (status === "passed") return { label: "\u5DF2\u901A\u8FC7", color: T.ok };
        if (status === "failed") return { label: "\u672A\u901A\u8FC7", color: T.err };
        return { label: "\u5F85\u9A8C\u8BC1", color: T.text3 };
      };
      return h(
        "section",
        { "data-human-verification": "true", style: { marginTop: "14px", paddingTop: "12px", borderTop: `1px solid ${T.line}` } },
        h("h2", { style: { fontSize: "16px", margin: 0 } }, "\u9A8C\u6536\u6807\u51C6"),
        criteria.length ? h("div", { "data-human-acceptance": "true", style: { display: "grid", gap: "6px", marginTop: "8px" } }, criteria.map((entry, index) => h(
          "div",
          { key: entry.id ?? index, "data-detail-ac": entry.id ?? `AC-${String(index + 1).padStart(2, "0")}`, style: { border: `1px solid ${T.line}`, borderRadius: "10px", padding: "8px 12px", minWidth: 0 } },
          h("div", { style: { display: "flex", justifyContent: "space-between", gap: "12px", color: T.text2, fontSize: "12px" } }, h("strong", null, entry.id ?? `AC-${String(index + 1).padStart(2, "0")}`), (() => {
            const status = statusMeta2(entry.status);
            return h("span", { style: { color: status.color } }, status.label);
          })()),
          h("div", { style: { marginTop: "5px", whiteSpace: "pre-wrap", overflowWrap: "anywhere" } }, entry.text || entry.title || entry.expected || "\u5F85\u8865\u5145")
        ))) : h("p", { style: { color: T.text2 } }, "\u6682\u65E0\u9A8C\u6536\u6807\u51C6\u3002")
      );
    }
    const HUMAN_CONTROL = { ...button, minHeight: "40px", padding: "8px 14px", fontSize: "14px", fontWeight: 500, lineHeight: 1.5, color: T.text, border: `1px solid ${T.line2}`, background: T.layer };
    const DETAIL_MENU_ITEM = { ...HUMAN_CONTROL, width: "100%", textAlign: "left", border: 0, background: "transparent", minHeight: "36px", padding: "7px 10px" };
    const HUMAN_PRIMARY = { ...primary, minHeight: "44px", padding: "10px 20px", fontSize: "14px", fontWeight: 600 };
    function IterationFeedback({ item, root, onRefresh, onPatch }) {
      const [feedback, setFeedback] = useState("");
      const [localPatch, setLocalPatch] = useState(null);
      const [resolution, setResolution] = useState("");
      const [busy, setBusy] = useState(false);
      const [message, setMessage] = useState("");
      const [messageTone, setMessageTone] = useState("neutral");
      const [phase, setPhase] = useState("");
      const patch = localPatch ?? item.pendingPatch;
      const convergenceCoverage = patch?.diff?.modified ?? [];
      const updates = (kind) => convergenceCoverage.some((change) => change?.kind === kind) || kind === "acceptance" && [patch?.diff?.added, patch?.diff?.removed].some((list) => Array.isArray(list) && list.some((change) => change?.kind === "acceptance"));
      if (item.closed) return null;
      const send = async (body) => {
        const controller = new AbortController();
        const slowNotice = setTimeout(() => setPhase("AI \u6B63\u5728\u751F\u6210\u9700\u6C42\u8C03\u6574\u8349\u6848\uFF0C\u901A\u5E38\u53EA\u9700\u51E0\u79D2\u2026"), 900);
        const timeout = setTimeout(() => controller.abort(), 2e4);
        setBusy(true);
        setMessage("");
        setMessageTone("neutral");
        setPhase(body.action === "feedback" || body.action === "retry" ? "\u63D0\u4EA4\u5904\u7406\u4E2D..." : "\u6B63\u5728\u8BB0\u5F55\u5904\u7406\u7ED3\u679C\u2026");
        try {
          const response = await fetch(`/api/alm/requirements/convergence?root=${encodeURIComponent(item.root ?? root)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
          const result = await response.json();
          if (!response.ok || !result.ok) throw new Error(result.message || "\u64CD\u4F5C\u5931\u8D25\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5");
          if (result.pendingPatch) {
            setLocalPatch(result.pendingPatch);
            setResolution("");
            setFeedback("");
            onPatch?.(result.pendingPatch);
            setMessage("\u5DF2\u751F\u6210\u9700\u6C42\u6F14\u8FDB\u8865\u4E01\uFF0C\u8BF7\u5728\u4E0B\u65B9\u786E\u8BA4\u5408\u5165\u3002");
            setMessageTone("success");
          } else if (body.action === "feedback" || body.action === "retry") {
            setFeedback("");
            setMessage(result.deferred === true ? `\u53CD\u9988\u8349\u6848\u6682\u672A\u751F\u6210\uFF1A${result.message ?? "\u8BF7\u70B9\u51FB\u91CD\u65B0\u751F\u6210\u8C03\u6574\u8349\u6848\u3002"}` : result.message ?? (result.execution?.resumed ? "\u4FEE\u590D\u53CD\u9988\u5DF2\u63D0\u4EA4\uFF0CAI \u6B63\u5728\u7EE7\u7EED\u63A8\u8FDB\u3002" : result.execution?.message ?? "\u53CD\u9988\u5DF2\u4FDD\u5B58\uFF0C\u8BF7\u542F\u52A8\u6216\u91CD\u8BD5\u63A8\u8FDB\u3002"));
            setMessageTone(result.deferred === true ? "error" : "neutral");
            await onRefresh?.();
          } else {
            setLocalPatch(null);
            onPatch?.(null);
            setFeedback("");
            setResolution("");
            const revision = Number(result.applied?.result?.after?.revision);
            setMessage(body.resolution === "confirm_converge" && Number.isFinite(revision) ? `\u2705 \u9700\u6C42\u57FA\u7EBF\u5DF2\u66F4\u65B0\u81F3 v${revision}` : result.execution?.resumed ? "\u5DF2\u63D0\u4EA4\u5E76\u7EE7\u7EED\u63A8\u8FDB\uFF0C\u5B8C\u6210\u540E\u5C06\u91CD\u65B0\u68C0\u67E5\u3002" : `\u5DF2\u8BB0\u5F55\u5904\u7406\u7ED3\u679C\uFF0C\u4F46\u672A\u80FD\u7EE7\u7EED\u63A8\u8FDB\uFF1A${result.execution?.message ?? "\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5"}`);
            setMessageTone(body.resolution === "confirm_converge" ? "success" : "neutral");
            await onRefresh?.();
          }
        } catch (error) {
          setMessage(error?.name === "AbortError" ? "\u7B49\u5F85 AI \u751F\u6210\u8349\u6848\u8D85\u65F6\u3002\u53CD\u9988\u672A\u786E\u8BA4\u4FDD\u5B58\uFF0C\u8BF7\u91CD\u65B0\u63D0\u4EA4\u3002" : error?.message || "\u64CD\u4F5C\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5");
          setMessageTone("error");
        } finally {
          clearTimeout(slowNotice);
          clearTimeout(timeout);
          setPhase("");
          setBusy(false);
        }
      };
      return h(
        "section",
        { "data-iteration-feedback": "true", style: { margin: "14px 0 0", padding: "12px", border: `1px solid ${T.line}`, borderRadius: "10px", background: T.layer } },
        h("h2", { style: { fontSize: "16px", margin: "0 0 12px" } }, patch ? "\u9700\u6C42\u6536\u655B\u786E\u8BA4" : "\u8865\u5145\u53CD\u9988\u6216\u8C03\u6574\u9700\u6C42"),
        !patch ? h(
          "div",
          null,
          h("label", { htmlFor: `iteration-feedback-${item.id}`, style: { position: "absolute", width: "1px", height: "1px", overflow: "hidden", clipPath: "inset(50%)" } }, "\u63CF\u8FF0\u9700\u8981\u8C03\u6574\u7684\u5185\u5BB9"),
          h("textarea", { id: `iteration-feedback-${item.id}`, value: feedback, maxLength: 4e3, rows: 2, placeholder: "\u76F4\u63A5\u63CF\u8FF0\u9700\u8981\u5FAE\u8C03\u7684\u4EA4\u4E92\u3001\u8865\u5145\u7684\u89C4\u5219\u6216\u53D1\u73B0\u7684\u95EE\u9898\uFF0CAI \u5C06\u81EA\u52A8\u5224\u65AD\u662F\u4FEE\u590D\u4EE3\u7801\u8FD8\u662F\u5347\u7EA7\u9700\u6C42\u7248\u672C...", onChange: (event) => setFeedback(event.target.value), style: { display: "block", boxSizing: "border-box", width: "100%", margin: "8px 0", background: T.layer, color: T.text, border: `1px solid ${T.line2}`, padding: "8px" } }),
          h("div", { style: { display: "flex", justifyContent: "flex-end" } }, h("button", { type: "button", style: HUMAN_CONTROL, disabled: busy || !feedback.trim(), onClick: () => send({ action: "feedback", reqId: item.id, feedbackText: feedback }) }, busy ? "\u63D0\u4EA4\u5904\u7406\u4E2D..." : "\u63D0\u4EA4\u53CD\u9988"))
        ) : h(
          "div",
          { "data-pending-patch": "true" },
          h("p", null, patch.evolutionNote),
          h(
            "div",
            { "data-convergence-coverage": "true", style: { display: "flex", gap: "7px", flexWrap: "wrap", margin: "8px 0 12px", fontSize: "12px", color: T.text2 } },
            ...[["goal", "\u9884\u671F\u53D8\u5316"], ["problem", "\u4EF7\u503C"], ["acceptance", "\u9A8C\u6536\u6807\u51C6"]].map(([kind, label]) => h("span", { key: kind, style: { border: `1px solid ${updates(kind) ? T.ok : T.warn}`, borderRadius: "999px", padding: "3px 8px", color: updates(kind) ? T.ok : T.warn } }, `${updates(kind) ? "\u5DF2\u66F4\u65B0" : "\u5F85\u6838\u5BF9"}\uFF1A${label}`))
          ),
          h("details", null, h("summary", null, "\u67E5\u770B\u53D8\u66F4\u524D\u6B63\u6587\u53CA\u9A8C\u6536"), h("pre", { style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } }, String(patch.beforeBrief ?? "").replace(/<!--\s*alm:meta\b[\s\S]*?-->/g, ""))),
          h("details", null, h("summary", null, "\u67E5\u770B\u53D8\u66F4\u540E\u6B63\u6587\u53CA\u9A8C\u6536"), h("pre", { style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } }, String(patch.afterBrief ?? "").replace(/<!--\s*alm:meta\b[\s\S]*?-->/g, ""))),
          h(
            "fieldset",
            { style: { margin: "12px 0", border: 0, padding: 0 } },
            h("legend", null, "\u9009\u62E9\u5904\u7406\u65B9\u5F0F"),
            ...[["confirm_converge", "\u786E\u8BA4\u66F4\u65B0\u9700\u6C42\u57FA\u7EBF\u5E76\u7EE7\u7EED\u63A8\u8FDB"], ["repair_only", "\u4EC5\u4F5C\u4E3A\u4EE3\u7801\u95EE\u9898\u4FEE\u590D\uFF08\u4E0D\u4FEE\u6539\u9700\u6C42\u57FA\u7EBF\uFF09"]].map(([value, label]) => h("label", { key: value, style: { display: "block", margin: "8px 0" } }, h("input", { type: "radio", name: `iteration-resolution-${item.id}`, value, checked: resolution === value, onChange: () => setResolution(value) }), " ", label))
          ),
          h("button", { type: "button", style: HUMAN_PRIMARY, disabled: busy || !resolution, onClick: () => send({ action: "resolve", reqId: item.id, patchId: patch.patchId, patchHash: patch.patchHash, baseRequirementHash: patch.baseRequirementHash, resolution }) }, busy ? "\u786E\u8BA4\u5904\u7406\u4E2D..." : "\u786E\u8BA4\u66F4\u65B0\u9700\u6C42\u57FA\u7EBF")
        ),
        item.iterationRetry ? h(
          "div",
          null,
          h("p", null, item.iterationRetry.execution?.deferred === true ? "\u53CD\u9988\u5DF2\u4FDD\u5B58\uFF0C\u4F46 AI \u751F\u6210\u8C03\u6574\u8349\u6848\u8D85\u65F6\u3002" : "\u8FED\u4EE3\u53CD\u9988\u5DF2\u4FDD\u5B58\uFF0C\u7B49\u5F85\u542F\u52A8\u6216\u7EE7\u7EED\u63A8\u8FDB\u3002"),
          h("button", { type: "button", style: HUMAN_CONTROL, disabled: busy, onClick: () => send({ action: "retry", reqId: item.id }) }, item.iterationRetry.execution?.deferred === true ? "\u91CD\u65B0\u751F\u6210\u8C03\u6574\u8349\u6848" : "\u91CD\u8BD5\u63A8\u8FDB"),
          h("p", { style: { color: T.text2, fontSize: "13px" } }, item.iterationRetry.execution?.deferred === true ? "\u5C06\u4F7F\u7528\u5DF2\u4FDD\u5B58\u7684\u53CD\u9988\u91CD\u65B0\u751F\u6210\u8349\u6848\uFF0C\u4E0D\u4F1A\u91CD\u590D\u63D0\u4EA4\u5185\u5BB9\u3002" : "\u5982\u679C\u5C1A\u672A\u542F\u52A8\u8FD0\u884C\uFF0C\u8BF7\u4F7F\u7528\u672C\u9875\u201C\u4EA4\u7ED9 AI \u63A8\u8FDB\u201D\u3002")
        ) : null,
        busy || message ? h("p", { role: messageTone === "error" ? "alert" : "status", "aria-live": "polite", "data-iteration-feedback-status": messageTone, style: { margin: "8px 0 0", color: busy ? T.text2 : messageTone === "error" ? T.err : messageTone === "success" ? T.ok : void 0, fontWeight: messageTone === "error" || messageTone === "success" ? 600 : 400 } }, busy ? phase : message) : null
      );
    }
    const HUMAN_TABS = [{ id: "requirement", label: "\u9700\u6C42\u6B63\u6587" }, { id: "delivery", label: "AI \u8FDB\u5C55" }, { id: "record", label: "\u5386\u53F2\u8BB0\u5F55" }];
    function HumanCurrentMatter({ item, detail, root, handlers, progressPage, onNavigate, onRefresh, onDirty }) {
      const matter = detail.currentMatter ?? { kind: detail.question ? "decision" : detail.context?.kind, headline: detail.context?.headline, explanation: detail.context?.explanation, action: detail.primaryAction };
      const human = humanMatterCopy(matter);
      const action = matter.action ?? detail.primaryAction;
      const decision = matter.kind === "decision" || Boolean(detail.question);
      const businessDecision = matter.kind === "decision";
      const watch = progressPage && action?.id === "watch-run";
      return h(
        "section",
        { "data-current-matter": matter.kind ?? "unknown", "data-detail-context": detail.context?.kind ?? matter.kind ?? "unknown", style: { marginBottom: "24px", borderLeft: `3px solid ${matter.requiresHuman ? T.warn : T.brand}`, padding: "6px 0 6px 18px" } },
        decision && (!progressPage || businessDecision) ? h(DecisionForm, { key: item.run?.id ?? item.id, item, root, inline: true, primaryActionId: action?.id ?? "answer-run", onDirty, onDone: () => {
          onDirty?.(false);
          onRefresh?.();
        } }) : h(
          "div",
          null,
          human.label !== human.title || businessDecision ? h("p", { style: { margin: "0 0 6px", color: T.text2, fontSize: "13px" } }, businessDecision ? "\u9700\u8981\u4F60\u7684\u4E1A\u52A1\u51B3\u5B9A" : human.label) : null,
          h("h2", { style: { fontSize: "21px", fontWeight: 600, margin: "0 0 8px", lineHeight: 1.5 } }, businessDecision ? "\u6709\u4E00\u4EF6\u4E8B\u9700\u8981\u4F60\u51B3\u5B9A" : human.title),
          h("p", { style: { margin: "0 0 12px", color: T.text2, fontSize: "14px", lineHeight: 1.8 } }, businessDecision ? matter.explanation || "\u8BF7\u6838\u5BF9\u4E1A\u52A1\u9009\u9879\uFF0C\u786E\u8BA4\u540E AI \u624D\u4F1A\u7EE7\u7EED\u3002" : human.description),
          human.next && !decision ? h("p", { style: { margin: "0 0 12px", color: T.text2, fontSize: "13px" } }, human.next) : null,
          h(
            "div",
            { style: { display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" } },
            decision ? h("button", { style: HUMAN_PRIMARY, disabled: action?.enabled === false, "data-primary-action": action?.id ?? "answer-run", onClick: () => onNavigate("requirement") }, businessDecision ? "\u67E5\u770B\u4E1A\u52A1\u9009\u9879\u5E76\u51B3\u5B9A" : "\u67E5\u770B\u95EE\u9898\u4E0E AI \u5904\u7406\u9009\u9879") : !watch && action?.enabled !== false && handlers[action?.id] ? h("button", { style: HUMAN_PRIMARY, "data-primary-action": action.id, onClick: () => handlers[action.id]() }, action.id === "watch-run" ? "\u67E5\u770B AI \u8FDB\u5C55" : action.label) : null,
            !decision ? (detail.secondaryActions ?? []).filter((entry) => entry?.id === "run-acceptance" && entry.enabled !== false && handlers[entry.id]).map((entry) => h("button", { key: entry.id, style: HUMAN_CONTROL, "data-secondary-action": entry.id, onClick: () => handlers[entry.id]() }, entry.label)) : null,
            progressPage && onRefresh ? h("button", { style: HUMAN_CONTROL, "data-progress-refresh": "true", onClick: onRefresh }, "\u5237\u65B0\u72B6\u6001") : null
          ),
          action?.enabled === false && action.reason ? h("p", { role: "status", style: { color: T.text2, fontSize: "13px", margin: "8px 0" } }, action.reason) : null,
          ["start", "start-fix"].includes(action?.id) ? h("details", { style: { marginTop: "12px", fontSize: "13px", color: T.text2 } }, h("summary", { style: { cursor: "pointer" } }, "\u672C\u8F6E\u63A8\u8FDB\u8303\u56F4\u4E0E\u6267\u884C\u9650\u5236"), h("p", null, "\u542F\u52A8\u5373\u6388\u6743\u672C\u8F6E\u6309\u8303\u56F4\u5185\u81EA\u52A8\u63A8\u8FDB\uFF1A\u6700\u591A 3 \u6B21\u7EED\u63A8\u3001\u53E6\u6709\u6700\u591A 2 \u6B21\u5931\u8D25\u4FEE\u590D\uFF1B\u65E0\u8FDB\u5C55\u6216\u9700\u8981\u51B3\u5B9A\u65F6\u505C\u6B62\u3002\u4E0D\u4F1A\u66FF\u4F60\u9A8C\u6536\u6216\u53D1\u5E03\u3002")) : null,
          h(RejectCandidateControl, { item, root: item.root ?? root, onDone: onRefresh })
        )
      );
    }
    function HumanProgress({ item, detail }) {
      const run = detail.summaries?.run ?? {};
      const acceptance = detail.summaries?.acceptance ?? {};
      const candidate = detail.summaries?.candidate ?? {};
      const state = humanAcceptanceState(acceptance);
      const timeline = [...detail.record?.timeline ?? []].filter((entry) => Number.isFinite(Date.parse(entry.at))).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 3);
      const matter = detail.currentMatter ?? {};
      const blocked = matter.kind === "technical-block";
      const last = run.lastActivityAt;
      return h(
        "div",
        { "data-human-progress": "true" },
        h(
          "section",
          { style: { margin: "0 0 24px" } },
          h("h2", { style: { fontSize: "16px", margin: "0 0 10px" } }, "\u6700\u8FD1\u8FDB\u5C55"),
          last ? h("p", { style: { color: T.text2, fontSize: "14px", lineHeight: 1.8, margin: "0 0 12px" } }, `\u6700\u8FD1\u6D3B\u52A8 ${formatLocalStamp(last)}`, run.idleHandback ? " \xB7 \u672C\u8F6E\u5DF2\u4EA4\u56DE\u7ED3\u679C\uFF0C\u7B49\u5F85\u7EE7\u7EED" : run.awaitingAnswer ? " \xB7 \u7B49\u5F85\u4E1A\u52A1\u51B3\u5B9A" : run.stale ? " \xB7 \u63A8\u8FDB\u5DF2\u4E2D\u65AD" : run.status === "running" ? " \xB7 \u6267\u884C\u4E2D" : run.status === "queued" ? " \xB7 \u7B49\u5F85\u5F00\u59CB\u6267\u884C" : "") : h("p", { style: { color: T.text2, fontSize: "14px" } }, "\u8FD8\u6CA1\u6709\u53EF\u8BFB\u53D6\u7684\u8FD0\u884C\u6D3B\u52A8\u3002"),
          timeline.length ? h("ul", { style: { listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "10px" } }, timeline.map((entry, index) => h("li", { key: `${entry.at}-${index}`, style: { display: "flex", flexWrap: "wrap", gap: "4px 16px", fontSize: "14px", lineHeight: 1.7 } }, h("time", { dateTime: entry.at, style: { color: T.text2, fontSize: "12px", minWidth: "145px" } }, formatLocalStamp(entry.at)), h("span", null, entry.kind === "acceptance" ? `\u6267\u884C\u6280\u672F\u68C0\u67E5 \xB7 ${state.label}` : entry.title || "\u8BB0\u5F55\u4E86\u4E00\u6B21\u6D3B\u52A8")))) : null,
          h("p", { style: { color: T.text3, fontSize: "12px", margin: "12px 0 0", lineHeight: 1.7 } }, "\u4EC5\u663E\u793A\u5DF2\u8BB0\u5F55\u7684\u6D3B\u52A8\uFF1B\u70B9\u51FB\u5237\u65B0\u72B6\u6001\u83B7\u53D6\u6700\u65B0\u7ED3\u679C\u3002")
        ),
        blocked || run.failure?.message ? h("section", { "data-progress-blocker": "true", style: { borderLeft: `3px solid ${T.warn}`, padding: "4px 0 4px 14px", marginBottom: "24px" } }, h("h2", { style: { fontSize: "16px", margin: "0 0 8px" } }, "\u5F53\u524D\u963B\u788D"), h("p", { style: { fontSize: "14px", lineHeight: 1.8, color: T.text2, margin: 0 } }, run.failure?.message || humanMatterCopy(matter).description)) : null,
        h(
          "section",
          { "data-progress-verification": "true", style: { borderTop: `1px solid ${T.line}`, paddingTop: "20px", marginBottom: "24px" } },
          h("h2", { style: { fontSize: "16px", margin: "0 0 10px" } }, "\u5F53\u524D\u9A8C\u8BC1"),
          h("p", { "data-progress-acceptance": "true", style: { color: state.color, fontSize: "14px", margin: "0 0 6px", fontWeight: 600 } }, state.label),
          h("p", { style: { fontSize: "14px", color: T.text2, lineHeight: 1.8, margin: 0 } }, detail.verificationSummary?.explanation || "\u6280\u672F\u68C0\u67E5\u4E0E\u4E1A\u52A1\u9A8C\u6536\u5206\u522B\u8BB0\u5F55\uFF0C\u5F53\u524D\u6CA1\u6709\u5B8C\u6574\u7684\u4E1A\u52A1\u9A8C\u6536\u7ED3\u8BBA\u3002"),
          candidate.exists && candidate.current === false ? h("p", { style: { color: T.warn, fontSize: "14px" } }, "\u4EA4\u4ED8\u5185\u5BB9\u5DF2\u53D8\u5316\uFF0C\u65E7\u5019\u9009\u4E0D\u80FD\u7528\u4E8E\u672C\u6B21\u9A8C\u6536\u3002") : null
        )
      );
    }
    function RunEventText({ entry, field, root, requirementId, runId, segment, display = (value) => value }) {
      const isReasoning = field === "reasoning";
      const [value, setValue] = useState(entry[field] ?? "");
      const [more, setMore] = useState(isReasoning ? entry.reasoningTruncated : entry.truncated);
      const [error, setError] = useState(null);
      const [busy, setBusy] = useState(false);
      const mounted = useRef(true);
      const request = useRef(null);
      useEffect(() => {
        mounted.current = true;
        return () => {
          mounted.current = false;
          request.current?.abort();
        };
      }, []);
      const load = async () => {
        if (busy) return;
        setBusy(true);
        setError(null);
        const controller = new AbortController();
        request.current = controller;
        let timeout;
        try {
          if (typeof entry.eventHash !== "string" || !/^[a-f0-9]{64}$/.test(entry.eventHash)) throw new Error("\u8BB0\u5F55\u6821\u9A8C\u503C\u4E0D\u53EF\u7528\uFF0C\u8BF7\u5237\u65B0\u8BB0\u5F55\u540E\u91CD\u8BD5");
          const params = new URLSearchParams({ root: root ?? "", requirementId, runId, segment: String(segment), eventSeq: String(entry.seq), offset: String(value.length) });
          params.set("eventHash", entry.eventHash);
          const { response, data } = await Promise.race([
            fetch(`/api/alm/requirements/run-observation?${params}`, { headers: { accept: "application/json" }, signal: controller.signal }).then(async (response2) => ({ response: response2, data: await response2.json() })),
            new Promise((_, reject) => {
              timeout = setTimeout(() => {
                controller.abort();
                reject(Object.assign(new Error("timeout"), { name: "AbortError" }));
              }, 1e4);
            })
          ]);
          if (!response.ok || data.ok === false || !data.detail) throw new Error(data.error?.message ?? "\u8BFB\u53D6\u5B8C\u6574\u5185\u5BB9\u5931\u8D25");
          const continuation = data.detail[field];
          const truncated = isReasoning ? data.detail.reasoningTruncated : data.detail.truncated;
          if (data.offset !== value.length || data.detail.seq !== entry.seq || data.detail.sessionId !== entry.sessionId || data.detail.eventHash !== entry.eventHash || typeof continuation !== "string" || !continuation || typeof truncated !== "boolean") {
            throw new Error("\u7EED\u8BFB\u5185\u5BB9\u4E0D\u5B8C\u6574\u6216\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u8BB0\u5F55\u540E\u91CD\u8BD5");
          }
          if (!mounted.current) return;
          setValue((previous) => previous + continuation);
          setMore(truncated);
        } catch (caught) {
          if (mounted.current) setError(caught?.name === "AbortError" ? "\u8BFB\u53D6\u5B8C\u6574\u5185\u5BB9\u8D85\u65F6" : caught?.message ?? "\u8BFB\u53D6\u5B8C\u6574\u5185\u5BB9\u5931\u8D25");
        } finally {
          clearTimeout(timeout);
          if (request.current === controller) request.current = null;
          if (mounted.current) setBusy(false);
        }
      };
      const visible = display(value);
      return h(
        "div",
        null,
        h("p", { style: { margin: "8px 0 0", whiteSpace: "pre-wrap", overflowWrap: "anywhere", lineHeight: 1.7, fontSize: "13px", color: isReasoning ? T.text2 : T.text } }, visible),
        visible ? h("div", { style: { marginTop: "8px" } }, h(CopyTextButton, { value: visible, label: more ? "\u590D\u5236\u5DF2\u52A0\u8F7D\u5185\u5BB9" : "\u590D\u5236\u5185\u5BB9" })) : null,
        more ? h("p", { style: { color: T.text2, fontSize: "12px", margin: "8px 0 0" } }, "\u5185\u5BB9\u5DF2\u622A\u65AD\uFF1B\u590D\u5236\u4EC5\u5305\u542B\u5DF2\u52A0\u8F7D\u7684\u5185\u5BB9\u3002") : null,
        more ? h("button", { type: "button", style: { ...HUMAN_CONTROL, marginTop: "8px", minHeight: "36px" }, disabled: busy, onClick: load }, busy ? "\u8BFB\u53D6\u4E2D\u2026" : "\u52A0\u8F7D\u540E\u7EED\u5185\u5BB9") : null,
        error ? h("p", { role: "alert", style: { color: T.err, fontSize: "12px" } }, error, error.includes("\u5237\u65B0\u8BB0\u5F55") ? "\u3002" : "\uFF1B\u8BF7\u91CD\u8BD5\u3002") : null
      );
    }
    const RUN_SYSTEM_EVENT_TYPES = /* @__PURE__ */ new Set(["sandbox/mode", "approval/policy", "agent/inbox/spliced", "turn/start", "step/start", "step/end", "system/message", "request/header", "request/context", "session/title"]);
    const RUN_SYSTEM_INJECTION = /<system-reminder>|Instructions from:\s*AGENTS\.md|Current runtime context\.|Current DSH file policy:|Current DeepSeek Harness implementation checkout:|Time sampled while preparing turn|Browser time zone|\[MNEMON\]|MNEMON RUNTIME MEMORY SNAPSHOT|<runtime-memory-file\b/i;
    const RUN_DISPATCH_PROMPT = /(?:^|\n)\s*(?:#\s*需求交付任务：REQ-ALM-|你是需求交付执行器|You are (?:a )?requirement delivery executor)/i;
    const RUN_INTERNAL_AUDIT = /(?:^|\n)\s*Team message from\b|\breq\d+-audit\b|\b[A-Za-z][\w-]*\.(?:mjs|js|ts|tsx):\d+(?:-\d+)?|\.slice\(0,\s*\d+\)/i;
    function runToolArguments(entry) {
      try {
        const parsed = JSON.parse(entry?.text ?? "");
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
      } catch {
        return {};
      }
    }
    function runToolValue(argumentsValue, keys) {
      for (const key of keys) if (typeof argumentsValue[key] === "string" && argumentsValue[key].trim()) return argumentsValue[key].trim();
      return null;
    }
    function runToolOutput(value) {
      return String(value ?? "").replace(/<skill_content\b[^>]*>/gi, "").replace(/<\/skill_content>/gi, "").trim();
    }
    function cleanOutcomeMarkdown(value) {
      return String(value ?? "").replace(/<!--\s*alm:meta[\s\S]*?-->/gi, "").replace(/!?(?:\[([^\]]+)\]\([^)]*\))/g, "$1").replace(/^\s{0,3}#{1,6}\s+/u, "").replace(/^\s*(?:[-*+]\s+|\d+[.)、]\s+)/u, "").replace(/\*\*([^*]+)\*\*/g, "**$1**").trim();
    }
    function outcomeInline(value) {
      const text = cleanOutcomeMarkdown(value);
      if (!text) return null;
      return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, index) => {
        if (/^\*\*[^*]+\*\*$/u.test(part)) return h("strong", { key: index }, part.slice(2, -2));
        if (/^`[^`]+`$/u.test(part)) return h("code", { key: index, style: { padding: "1px 5px", borderRadius: "4px", background: T.layer2, color: T.text2, fontSize: "0.92em" } }, part.slice(1, -1));
        return part;
      });
    }
    function uniqueOutcomeLines(lines) {
      return [...new Set(lines.map(cleanOutcomeMarkdown).filter(Boolean))].slice(0, 6);
    }
    function summarizeRunOutcome(value, { hasCurrentCandidate = false } = {}) {
      const sections = [];
      let current = { title: "", lines: [] };
      const push = () => {
        if (current.title || current.lines.length) sections.push(current);
      };
      let codeFence = false;
      for (const rawLine of String(value ?? "").replace(/\r/g, "").split("\n")) {
        if (/^\s*```/u.test(rawLine)) {
          codeFence = !codeFence;
          continue;
        }
        if (codeFence) continue;
        const heading = rawLine.match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/u);
        if (heading) {
          push();
          current = { title: cleanOutcomeMarkdown(heading[1]), lines: [] };
          continue;
        }
        const line = cleanOutcomeMarkdown(rawLine);
        if (line) current.lines.push(line);
      }
      push();
      const completed = [];
      const verification = [];
      const fallback = [];
      for (const section of sections) {
        const title = section.title;
        const text = section.lines.join("\n");
        if (hasCurrentCandidate && /spawn\s+EPERM|(?:^|\n)\s*(?:阻塞|blocker?)/iu.test(`${title}
${text}`)) continue;
        if (/(?:已完成|本次完成|完成情况|完成内容|交付内容|实现结果)/u.test(title)) completed.push(...section.lines);
        else if (/(?:验证|测试|检查|验收)/u.test(title)) verification.push(...section.lines.filter((line) => /通过|pass|成功|0\s*failures|\d+\s*\/\s*\d+\s*通过|完成/u.test(line) && !/spawn\s+EPERM|失败|阻塞/u.test(line)));
        else fallback.push(...section.lines.filter((line) => !/spawn\s+EPERM|^阻塞[：:]/iu.test(line)));
      }
      const normalizedCompleted = uniqueOutcomeLines(completed.length ? completed : fallback);
      return { completed: normalizedCompleted, verification: uniqueOutcomeLines(verification) };
    }
    function auditFindings(value) {
      const lines = String(value ?? "").split(/\r?\n/).map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)、])\s*/, "").trim()).filter((line) => line.length >= 6 && line.length <= 160).filter((line) => !RUN_INTERNAL_AUDIT.test(line) && !/^(?:Team message from|From:)/i.test(line)).map((line) => line.replace(/`[^`]+`/g, "\u76F8\u5173\u5B9E\u73B0").replace(/\b[\w/-]+\.(?:mjs|js|ts|tsx)(?::\d+(?:-\d+)?)?/g, "\u76F8\u5173\u5B9E\u73B0"));
      return [...new Set(lines)].slice(0, 4);
    }
    function runToolAction(entry) {
      const name = (entry.name ?? "tool").toLowerCase();
      const args = runToolArguments(entry);
      const file = runToolValue(args, ["path", "file", "filePath", "target"]);
      const command = runToolValue(args, ["command", "cmd", "script"]);
      const skill = runToolValue(args, ["name", "skill"]);
      const mutation = /(?:write|edit|patch|replace|apply|delete|move|rename)/.test(name) || /apply_patch|\b(?:sed|perl)\b.*(?:-i|write)|\b(?:mv|cp)\b/.test(command ?? "");
      const verification = /(?:test|verify|check|lint|build|bash|shell|exec|command)/.test(name) && /(?:--test|\btest\b|\bcheck\b|\blint\b|\bbuild\b|\bnode\b|\bpnpm\b|\bnpm\b)/.test(command ?? entry.text);
      if (/skill/.test(name)) return { type: "skill", icon: "\u{1F9E9}", title: `\u52A0\u8F7D\u5F00\u53D1\u6280\u80FD\uFF1A${skill ?? "\u5F00\u53D1\u6280\u80FD"}` };
      if (mutation) return { type: "mutation", icon: "\u270F\uFE0F", title: file ? `\u4FEE\u6539\u6587\u4EF6\uFF1A${file}` : "\u6267\u884C\u4EE3\u7801\u4FEE\u6539" };
      if (verification) return { type: "verification", icon: "\u{1F9EA}", title: `\u6267\u884C\u547D\u4EE4\uFF1A${(command ?? entry.text).replace(/\s+/g, " ").slice(0, 140)}` };
      if (/(?:read|search|find|grep|rg|list|glob|stat)/.test(name)) return { type: "inspection", icon: "\u{1F50D}", title: `${/(?:search|find|grep|rg|glob)/.test(name) ? "\u68C0\u7D22" : "\u8BFB\u53D6"}\uFF1A${file ?? runToolValue(args, ["query", "pattern", "path"]) ?? "\u4EE3\u7801\u4E0E\u6587\u4EF6"}` };
      return { type: "tool", icon: "\u2699\uFE0F", title: `\u5DE5\u5177\u7ED3\u679C\uFF1A${entry.name ?? "\u5DE5\u5177"}` };
    }
    function projectRunView(events) {
      const conversation = [];
      const actions = [];
      const systemEvents = [];
      const outcomes = [];
      const pending = /* @__PURE__ */ new Map();
      const addSystem = (entry) => systemEvents.push({ seq: entry.seq, at: entry.at, name: entry.name ?? "\u7CFB\u7EDF\u4E8B\u4EF6" });
      for (const entry of events) {
        if (entry.kind === "other" || RUN_SYSTEM_EVENT_TYPES.has(entry.name)) {
          addSystem(entry);
          continue;
        }
        if (["input", "output"].includes(entry.kind)) {
          if (RUN_SYSTEM_INJECTION.test(entry.text ?? "")) {
            addSystem(entry);
            continue;
          }
          if (entry.kind === "input") {
            if (RUN_DISPATCH_PROMPT.test(entry.text ?? "")) conversation.push({ kind: "dispatch", entry });
            continue;
          }
          if (RUN_INTERNAL_AUDIT.test(entry.text ?? "")) {
            conversation.push({ kind: "audit", entry, findings: auditFindings(entry.text) });
            continue;
          }
          if (!(entry.text ?? "").trim()) continue;
          outcomes.push({ kind: "outcome", entry });
          continue;
        }
        if (entry.kind === "tool-call") {
          const action = { ...runToolAction(entry), call: entry, result: null, status: "running" };
          actions.push(action);
          if (entry.callId) pending.set(entry.callId, action);
          continue;
        }
        if (entry.kind === "tool-result") {
          const action = entry.callId ? pending.get(entry.callId) : null;
          if (action) {
            action.result = entry;
            action.status = entry.status === "failed" ? "failed" : "completed";
            pending.delete(entry.callId);
          } else actions.push({ ...runToolAction(entry), call: null, result: entry, status: entry.status === "failed" ? "failed" : "completed" });
        }
      }
      const dispatch = conversation.filter((row2) => row2.kind === "dispatch").at(-1) ?? null;
      const audit = conversation.filter((row2) => row2.kind === "audit").at(-1) ?? null;
      conversation.length = 0;
      if (dispatch) conversation.push(dispatch);
      if (audit) conversation.push(audit);
      if (outcomes.length) conversation.push(outcomes.at(-1));
      const mutations = actions.filter((action) => action.type === "mutation").length;
      const verification = actions.findLast((action) => action.type === "verification" && action.status !== "running");
      return { conversation, actions, systemEvents, summary: { actions: actions.length, mutations, verification } };
    }
    function OutcomeSummaryCard({ entry, root, requirementId, runId, segment, hasCurrentCandidate }) {
      const summary = summarizeRunOutcome(entry.text, { hasCurrentCandidate });
      const list = (title, icon, lines, tone) => lines.length ? h(
        "section",
        { style: { marginTop: "10px" } },
        h("strong", { style: { display: "block", fontSize: "12px", color: tone } }, `${icon} ${title}`),
        h("ul", { style: { margin: "5px 0 0", paddingLeft: "18px", color: T.text2, fontSize: "13px", lineHeight: 1.7 } }, lines.map((line, index) => h("li", { key: `${index}:${line}` }, outcomeInline(line))))
      ) : null;
      return h(
        "article",
        { "data-run-outcome": "true", "data-run-outcome-summary": "true", style: { borderTop: `1px solid ${T.line}`, padding: "12px 0", minWidth: 0 } },
        h("div", { style: { display: "flex", gap: "10px", alignItems: "baseline", flexWrap: "wrap", fontSize: "12px", color: T.text2 } }, h("strong", { style: { color: T.text } }, "AI \u9636\u6BB5\u7ED3\u8BBA"), entry.at ? h("time", { dateTime: entry.at }, formatLocalStamp(entry.at)) : null),
        list("\u672C\u8F6E\u5B8C\u6210\u8981\u70B9", "\u2705", summary.completed, T.ok),
        list("\u9A8C\u8BC1\u7ED3\u8BBA\u6458\u8981", "\u{1F9EA}", summary.verification, T.brand),
        !summary.completed.length && !summary.verification.length ? h("p", { style: { margin: "8px 0 0", color: T.text2, fontSize: "13px" } }, "\u672C\u8F6E\u6C47\u62A5\u672A\u5305\u542B\u53EF\u63D0\u70BC\u7684\u5B8C\u6210\u6216\u9A8C\u8BC1\u7ED3\u8BBA\u3002") : null,
        h(
          "details",
          { style: { marginTop: "10px", fontSize: "12px", color: T.text2 } },
          h("summary", { style: { cursor: "pointer" } }, "\u67E5\u770B\u5B8C\u6574\u539F\u59CB\u6C47\u62A5"),
          h(RunEventText, { entry, field: "text", root, requirementId, runId, segment })
        )
      );
    }
    function ReviewUsage({ review, root, requirementId }) {
      const [storedHistory, setHistory] = useState(null);
      const history = storedHistory?.root === root && storedHistory?.requirementId === requirementId ? storedHistory : { loading: true, records: [], error: false };
      useEffect(() => {
        const controller = new AbortController();
        let mounted = true;
        const saveHistory = (value) => setHistory({ root, requirementId, ...value });
        const timeout = setTimeout(() => {
          controller.abort();
          if (mounted) saveHistory({ loading: false, records: [], error: true });
        }, 1e4);
        saveHistory({ loading: true, records: [], error: false });
        const params = new URLSearchParams({ root: root ?? "", requirementId, mode: "review-usage" });
        fetch(`/api/alm/requirements/run-observation?${params}`, { headers: { accept: "application/json" }, signal: controller.signal }).then((response) => {
          if (!response.ok) throw new Error("usage unavailable");
          return response.json();
        }).then((data) => {
          if (!Array.isArray(data?.records)) throw new Error("invalid usage history");
          if (mounted && !controller.signal.aborted) saveHistory({ loading: false, records: data.records, error: false });
        }).catch(() => {
          if (mounted) saveHistory({ loading: false, records: [], error: true });
        }).finally(() => clearTimeout(timeout));
        return () => {
          mounted = false;
          clearTimeout(timeout);
          controller.abort();
        };
      }, [root, requirementId]);
      if (!review?.stored && !history.loading && !history.error && !history.records.length) return null;
      const usage = review?.usage;
      const count = (value) => Number.isSafeInteger(value) && value >= 0 ? new Intl.NumberFormat().format(value) : "\u672A\u77E5";
      return h(
        "section",
        { "aria-label": "\u6700\u8FD1 AI \u8BC4\u5BA1\u7528\u91CF", style: { borderTop: `1px solid ${T.line}`, paddingTop: "16px", marginBottom: "24px", fontSize: "13px", color: T.text2 } },
        h("h2", { style: { fontSize: "15px", color: T.text, margin: "0 0 8px" } }, "\u6700\u8FD1 AI \u8BC4\u5BA1\u7528\u91CF"),
        review?.stored ? h("p", { style: { margin: "0 0 6px", overflowWrap: "anywhere" } }, `${review.provider ?? "\u672A\u77E5\u63D0\u4F9B\u65B9"} / ${review.model ?? "\u672A\u77E5\u6A21\u578B"}${review.generatedAt ? ` \xB7 ${formatLocalStamp(review.generatedAt)}` : ""}`) : null,
        review?.stored ? usage ? h("p", { style: { margin: "0", lineHeight: 1.7 } }, `\u672A\u7F13\u5B58\u8F93\u5165 ${count(usage.inputTokens)} \xB7 \u7F13\u5B58\u8BFB\u53D6 ${count(usage.cacheReadTokens)} \xB7 \u7F13\u5B58\u5199\u5165 ${count(usage.cacheWriteTokens)} \xB7 \u8F93\u51FA ${count(usage.outputTokens)} token`) : h("p", { style: { margin: 0 } }, "\u672C\u6B21\u8BC4\u5BA1\u672A\u8BB0\u5F55\u7528\u91CF\u3002") : null,
        review?.usageReceiptStored === false ? h("p", { style: { color: T.warn } }, "\u6700\u8FD1\u4E00\u6B21\u8BC4\u5BA1\u7684\u7528\u91CF\u8BB0\u5F55\u672A\u80FD\u4FDD\u5B58\u3002") : null,
        history.loading ? h("p", { role: "status" }, "\u6B63\u5728\u8BFB\u53D6\u8BC4\u5BA1\u8C03\u7528\u8BB0\u5F55\u2026") : null,
        history.error ? h("p", { role: "alert", style: { color: T.err } }, "\u8BC4\u5BA1\u8C03\u7528\u8BB0\u5F55\u6682\u4E0D\u53EF\u7528\uFF0C\u8BF7\u5237\u65B0\u9700\u6C42\u8BE6\u60C5\u91CD\u8BD5\u3002") : null,
        history.records.length ? h("details", { style: { marginTop: "8px" } }, h("summary", null, "\u6700\u8FD1\u8BC4\u5BA1\u8C03\u7528\u8BB0\u5F55"), h("ul", { style: { paddingLeft: "18px", lineHeight: 1.7 } }, history.records.map((row2) => h("li", { key: row2.id }, `${row2.status === "completed" ? "\u5B8C\u6210" : "\u5931\u8D25"} \xB7 ${formatLocalStamp(row2.finishedAt)} \xB7 ${row2.provider ?? "\u672A\u77E5\u63D0\u4F9B\u65B9"} / ${row2.model ?? "\u672A\u77E5\u6A21\u578B"} \xB7 \u672A\u7F13\u5B58\u8F93\u5165 ${count(row2.usage?.inputTokens)} \xB7 \u7F13\u5B58\u8BFB\u53D6 ${count(row2.usage?.cacheReadTokens)} \xB7 \u7F13\u5B58\u5199\u5165 ${count(row2.usage?.cacheWriteTokens)} \xB7 \u8F93\u51FA ${count(row2.usage?.outputTokens)} token`)))) : null,
        h("p", { style: { fontSize: "12px", margin: "6px 0 0" } }, "\u6BCF\u6B21\u8C03\u7528\u4EC5\u8BB0\u5F55\u6700\u540E\u7528\u91CF\u6837\u672C\uFF0C\u53EF\u80FD\u4E0D\u542B\u5185\u90E8\u91CD\u8BD5\uFF1B\u6700\u591A\u663E\u793A\u6700\u8FD1 20 \u6761\uFF0C\u4E0D\u8BA1\u5165\u5F00\u53D1\u4F1A\u8BDD\u5408\u8BA1\uFF0C\u8D39\u7528\u672A\u77E5\u3002")
      );
    }
    function RunObservationPanel({ item, detail, root, onOpenSession, initialRunId = null }) {
      const latestRunId = detail.summaries?.run?.id ?? item.run?.id ?? null;
      const latestRunStatus = detail.summaries?.run?.status ?? item.run?.status ?? null;
      const blueprint = item.run?.blueprint ?? null;
      const requirementClosed = item.closed === true || detail.summaries?.delivery?.key === "closed" || detail.currentMatter?.kind === "closed";
      const [runSelection, setRunSelection] = useState(null);
      const runId = runSelection?.root === root && runSelection?.requirementId === item.id ? runSelection.value : initialRunId ?? latestRunId;
      const setRunId = (value) => setRunSelection((previous) => ({ root, requirementId: item.id, value: typeof value === "function" ? value(previous?.root === root && previous?.requirementId === item.id ? previous.value : initialRunId ?? latestRunId) : value }));
      const [storedRunOptions, setRunOptions] = useState(null);
      const runOptions = storedRunOptions?.root === root && storedRunOptions?.requirementId === item.id ? storedRunOptions : { runs: [], next: null, loading: true, error: false };
      const [view, setView] = useState("conversation");
      const [segmentSelection, setSegmentSelection] = useState(null);
      const segment = segmentSelection?.runId === runId && segmentSelection?.root === root && segmentSelection?.requirementId === item.id ? segmentSelection.index : 0;
      const [storedState, setState] = useState({ loading: true, events: [], sessions: [], source: null, error: null, complete: false, hasMore: false });
      const sameRun = (value) => value?.runId === runId && value?.root === root && value?.requirementId === item.id;
      const sessionOptions = sameRun(storedState) ? storedState.sessions : [];
      const state = sameRun(storedState) && storedState.segment === segment ? storedState : { loading: true, events: [], sessions: [], source: null, error: null, complete: false, hasMore: false };
      const observedStatus = state.runId === runId && state.root === root && state.requirementId === item.id ? state.runStatus : null;
      const currentStatus = observedStatus ?? (runId === latestRunId ? latestRunStatus : null);
      const canPoll = !requirementClosed && ["queued", "running", "waiting-input", "paused"].includes(currentStatus);
      const [refresh, setRefresh] = useState(0);
      const [storedUsage, setUsage] = useState(null);
      const [storedLive, setLive] = useState(null);
      const sameScope = (value) => value?.root === root && value?.requirementId === item.id && value?.runId === runId && value?.segment === segment;
      const usage = sameScope(storedUsage) && storedUsage.refresh === refresh ? storedUsage.value : { status: "loading" };
      const liveScope = sameScope(storedLive) && view === "conversation" && !requirementClosed && runId === latestRunId && ["queued", "running"].includes(currentStatus);
      const live = liveScope ? storedLive.value : null;
      const liveError = liveScope && storedLive.error;
      const loadMore = useRef(null);
      const loadMoreRuns = useRef(null);
      const latestRef = useRef(null);
      useEffect(() => {
        const controller = new AbortController();
        let cursor = null, busy = false;
        setRunId(initialRunId ?? latestRunId);
        setRunOptions({ root, requirementId: item.id, runs: [], next: null, loading: true, error: false });
        const load = async () => {
          if (busy || controller.signal.aborted) return;
          busy = true;
          setRunOptions((previous) => ({ ...previous, loading: true, error: false }));
          const requestController = new AbortController();
          const cancelRequest = () => requestController.abort();
          controller.signal.addEventListener("abort", cancelRequest, { once: true });
          let timeout;
          try {
            const params = new URLSearchParams({ root: root ?? "", requirementId: item.id, mode: "history" });
            if (cursor) params.set("before", cursor);
            const { response, data } = await Promise.race([
              fetch(`/api/alm/requirements/run-observation?${params}`, { headers: { accept: "application/json" }, signal: requestController.signal }).then(async (response2) => ({ response: response2, data: await response2.json() })),
              new Promise((_, reject) => {
                timeout = setTimeout(() => {
                  cancelRequest();
                  reject(new Error("history timeout"));
                }, 1e4);
              })
            ]);
            if (!response.ok) throw new Error("unavailable");
            if (!Array.isArray(data.runs) || data.runs.some((run) => !run || typeof run.id !== "string" || !run.id.trim()) || data.next !== null && (typeof data.next !== "string" || !data.next || data.next === cursor)) throw new Error("invalid");
            if (controller.signal.aborted) return;
            cursor = data.next;
            setRunOptions((previous) => {
              const runs2 = new Map(previous.runs.map((run) => [run.id, run]));
              for (const run of data.runs) if (!runs2.has(run.id)) runs2.set(run.id, run);
              return { root, requirementId: item.id, runs: [...runs2.values()], next: data.next, loading: false, error: false };
            });
            if (!initialRunId && !latestRunId && data.runs.length) setRunId((current) => current ?? data.runs[0].id);
          } catch {
            if (!controller.signal.aborted) setRunOptions((previous) => ({ ...previous, loading: false, error: true }));
          } finally {
            clearTimeout(timeout);
            controller.signal.removeEventListener("abort", cancelRequest);
            busy = false;
          }
        };
        loadMoreRuns.current = load;
        void load();
        return () => {
          controller.abort();
          loadMoreRuns.current = null;
        };
      }, [root, item.id, latestRunId, initialRunId, segment, refresh]);
      useEffect(() => {
        if (requirementClosed || !runId || runId !== latestRunId || !["queued", "running"].includes(currentStatus) || view !== "conversation") return;
        let alive = true, timer;
        const controller = new AbortController();
        const loadLive = async () => {
          const requestController = new AbortController();
          const cancelRequest = () => requestController.abort();
          controller.signal.addEventListener("abort", cancelRequest, { once: true });
          let timeout;
          try {
            const params = new URLSearchParams({ root: root ?? "", requirementId: item.id, runId, segment: String(segment), mode: "live" });
            const { response, data } = await Promise.race([
              fetch(`/api/alm/requirements/run-observation?${params}`, { headers: { accept: "application/json" }, signal: requestController.signal }).then(async (response2) => ({ response: response2, data: await response2.json() })),
              new Promise((_, reject) => {
                timeout = setTimeout(() => {
                  cancelRequest();
                  reject(new Error("live timeout"));
                }, 1e4);
              })
            ]);
            if (!response.ok) throw new Error("live unavailable");
            const value = data?.live;
            if (!data || data.ok === false || data.runId !== runId || data.segment !== segment || !Object.hasOwn(data, "live") || value !== null && (!value || typeof value !== "object" || Array.isArray(value) || typeof value.text !== "string" || typeof value.reasoning !== "string" || typeof value.truncated !== "boolean")) throw new Error("invalid live response");
            if (alive) setLive({ root, requirementId: item.id, runId, segment, value: data.live ?? null, error: false });
          } catch {
            if (alive) setLive((previous) => ({ root, requirementId: item.id, runId, segment, value: previous?.root === root && previous?.requirementId === item.id && previous?.runId === runId && previous?.segment === segment ? previous.value : null, error: true }));
          } finally {
            clearTimeout(timeout);
            controller.signal.removeEventListener("abort", cancelRequest);
          }
          if (alive) timer = setTimeout(loadLive, 2e3);
        };
        void loadLive();
        return () => {
          alive = false;
          controller.abort();
          clearTimeout(timer);
        };
      }, [root, item.id, runId, segment, view, latestRunId, currentStatus, requirementClosed]);
      useEffect(() => {
        if (!runId || view !== "usage") return;
        const controller = new AbortController();
        let cancelled = false;
        const saveUsage = (value) => setUsage({ root, requirementId: item.id, runId, segment, refresh, value });
        saveUsage({ status: "loading" });
        const timeout = setTimeout(() => {
          controller.abort();
          if (!cancelled) saveUsage({ status: "unknown" });
        }, 1e4);
        const params = new URLSearchParams({ root: root ?? "", requirementId: item.id, runId, segment: String(segment), mode: "usage" });
        fetch(`/api/alm/requirements/run-observation?${params}`, { headers: { accept: "application/json" }, signal: controller.signal }).then((response) => response.ok ? response.json() : null).then((data) => {
          if (controller.signal.aborted) return;
          const value = data?.usage;
          const valid = data?.ok === true && data.requirementId === item.id && data.runId === runId && data.segment === segment && value && typeof value === "object" && !Array.isArray(value) && (value.status === "unknown" || value.status === "available" && ["dsh-session", "billion-context"].includes(value.source) && value.scope === "session");
          saveUsage(valid ? value : { status: "unknown" });
        }).catch(() => {
          if (!cancelled) saveUsage({ status: "unknown" });
        }).finally(() => clearTimeout(timeout));
        return () => {
          cancelled = true;
          clearTimeout(timeout);
          controller.abort();
        };
      }, [root, item.id, runId, segment, view, refresh]);
      useEffect(() => {
        if (!runId) return;
        let alive = true, busy = false, cursor = -1, prefixHash = null, replayUntil = null, replayBuffer = [], timer = null;
        const controller = new AbortController();
        let status = runId === latestRunId ? latestRunStatus : null;
        const shouldPoll = () => !requirementClosed && runId === latestRunId && ["queued", "running", "waiting-input", "paused"].includes(status);
        const pollDelay = () => ["waiting-input", "paused"].includes(status) ? 15e3 : 4e3;
        setState((previous) => ({ runId, root, requirementId: item.id, segment, runStatus: null, loading: true, events: [], sessions: sameRun(previous) ? previous.sessions : [], source: null, error: null, complete: false, hasMore: false }));
        const load = async () => {
          if (busy || !alive) return;
          clearTimeout(timer);
          timer = null;
          busy = true;
          const requestController = new AbortController();
          const cancelRequest = () => requestController.abort();
          controller.signal.addEventListener("abort", cancelRequest, { once: true });
          let timeout;
          const timedOut = new Promise((_, reject) => {
            timeout = setTimeout(() => {
              cancelRequest();
              reject(Object.assign(new Error("\u8BFB\u53D6\u8FD0\u884C\u8BB0\u5F55\u8D85\u65F6"), { name: "AbortError" }));
            }, 1e4);
          });
          try {
            const params = new URLSearchParams({ root: root ?? "", requirementId: item.id, runId, segment: String(segment), limit: "50" });
            if (cursor >= 0) params.set("after", String(cursor));
            if (prefixHash) params.set("prefixHash", prefixHash);
            const { response, data } = await Promise.race([timedOut, (async () => {
              const response2 = await fetch(`/api/alm/requirements/run-observation?${params}`, { headers: { accept: "application/json" }, signal: requestController.signal });
              return { response: response2, data: await response2.json() };
            })()]);
            if (!response.ok || data.ok === false) throw new Error(data.error?.message ?? "\u8BFB\u53D6\u8FD0\u884C\u8BB0\u5F55\u5931\u8D25");
            if (!alive) return;
            if (data.ok !== true || data.runId !== runId || data.segment !== segment) throw new Error("\u8FD0\u884C\u8BB0\u5F55\u54CD\u5E94\u65E0\u6548\uFF0C\u8BF7\u91CD\u8BD5");
            if (data.historyChanged) {
              replayUntil = Math.max(replayUntil ?? -1, cursor);
              cursor = -1;
              prefixHash = null;
              replayBuffer = [];
              setState((previous) => ({ ...previous, loading: false, replaying: true, error: null, hasMore: true }));
              timer = setTimeout(load, 0);
              return;
            }
            if (!Array.isArray(data.events) || !["session-observation", "session-query", "persisted", "no-session", "unavailable", "corrupt"].includes(data.source)) throw new Error("\u8FD0\u884C\u8BB0\u5F55\u54CD\u5E94\u65E0\u6548\uFF0C\u8BF7\u91CD\u8BD5");
            if (!Array.isArray(data.sessions) || data.sessions.some((session) => !session || typeof session.sessionId !== "string" || !session.sessionId.trim())) throw new Error("\u8FD0\u884C\u8BB0\u5F55\u54CD\u5E94\u65E0\u6548\uFF0C\u8BF7\u91CD\u8BD5");
            const unavailable = ["no-session", "unavailable", "corrupt"].includes(data.source);
            if (unavailable && data.events.length) throw new Error("\u8FD0\u884C\u8BB0\u5F55\u54CD\u5E94\u65E0\u6548\uFF0C\u8BF7\u91CD\u8BD5");
            if (!unavailable) {
              const sessionId = Array.isArray(data.sessions) ? data.sessions[segment]?.sessionId : null;
              if (data.events.length && (typeof sessionId !== "string" || !sessionId)) throw new Error("\u8FD0\u884C\u8BB0\u5F55\u54CD\u5E94\u65E0\u6548\uFF0C\u8BF7\u91CD\u8BD5");
              let last = cursor;
              for (const event of data.events) {
                if (!event || event.sessionId !== sessionId || !Number.isSafeInteger(event.seq) || event.seq <= last || !["input", "output", "tool-call", "tool-result", "other"].includes(event.kind) || typeof event.text !== "string" || event.reasoning != null && typeof event.reasoning !== "string" || event.name != null && typeof event.name !== "string") throw new Error("\u8FD0\u884C\u8BB0\u5F55\u54CD\u5E94\u65E0\u6548\uFF0C\u8BF7\u91CD\u8BD5");
                last = event.seq;
              }
              if (data.lastSeq !== last || last >= 0 && (typeof data.prefixHash !== "string" || !/^[a-f0-9]{64}$/.test(data.prefixHash)) || data.next !== null && (!data.next || data.next.segment !== segment || data.next.after !== last || last === cursor)) throw new Error("\u8FD0\u884C\u8BB0\u5F55\u54CD\u5E94\u65E0\u6548\uFF0C\u8BF7\u91CD\u8BD5");
            }
            if (typeof data.status === "string") status = data.status;
            if (!unavailable) {
              cursor = data.lastSeq;
              prefixHash = data.prefixHash ?? null;
            }
            const replaying = replayUntil !== null;
            if (!unavailable && replaying) replayBuffer.push(...data.events);
            const replayFinished = !unavailable && replaying && (!data.next || cursor >= replayUntil);
            const replayedEvents = replayFinished ? replayBuffer.slice() : null;
            setState((previous) => {
              const seen = new Set(previous.events.map((entry) => `${entry.sessionId}:${entry.seq}`));
              const added = (data.events ?? []).filter((entry) => {
                const key = `${entry.sessionId}:${entry.seq}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
              });
              const events = unavailable || replaying && !replayFinished ? previous.events : replayFinished ? replayedEvents : [...previous.events, ...added];
              return { runId, root, requirementId: item.id, segment, runStatus: status, loading: false, replaying: replaying && !replayFinished, events, sessions: data.sessions ?? [], source: data.source, error: null, complete: data.sessionHistoryComplete === true, interruptedOutputPossible: data.interruptedOutputPossible === true, hasMore: unavailable ? previous.hasMore : Boolean(data.next), updatedAt: unavailable || replaying && !replayFinished ? previous.updatedAt : Date.now() };
            });
            if (unavailable) {
              if (data.source !== "corrupt" && shouldPoll()) timer = setTimeout(load, pollDelay());
            } else if (data.next) timer = setTimeout(load, 0);
            else {
              replayUntil = null;
              replayBuffer = [];
              if (!data.next && data.source !== "corrupt" && shouldPoll()) timer = setTimeout(load, pollDelay());
            }
          } catch (error) {
            if (alive && !controller.signal.aborted) {
              setState((previous) => ({ ...previous, loading: false, error: error?.name === "AbortError" ? "\u8BFB\u53D6\u8FD0\u884C\u8BB0\u5F55\u8D85\u65F6" : error?.message ?? "\u8BFB\u53D6\u8FD0\u884C\u8BB0\u5F55\u5931\u8D25" }));
              if (shouldPoll()) timer = setTimeout(load, pollDelay());
            }
          } finally {
            clearTimeout(timeout);
            controller.signal.removeEventListener("abort", cancelRequest);
            busy = false;
          }
        };
        loadMore.current = load;
        void load();
        return () => {
          alive = false;
          loadMore.current = null;
          controller.abort();
          clearTimeout(timer);
        };
      }, [root, item.id, runId, segment, refresh, latestRunId, latestRunStatus, requirementClosed]);
      if (!runId) return h("section", { style: { borderTop: `1px solid ${T.line}`, paddingTop: "18px" } }, h("h2", { style: { fontSize: "16px" } }, "\u8FD0\u884C\u8BB0\u5F55"), runOptions.error ? h("div", { role: "alert" }, "\u8FD0\u884C\u5217\u8868\u6682\u4E0D\u53EF\u7528\u3002 ", h("button", { type: "button", style: HUMAN_CONTROL, onClick: () => loadMoreRuns.current?.() }, "\u91CD\u8BD5")) : h("p", { role: runOptions.loading ? "status" : void 0, style: { color: T.text2, fontSize: "13px" } }, runOptions.loading ? "\u6B63\u5728\u8BFB\u53D6\u8FD0\u884C\u5217\u8868\u2026" : "\u5C1A\u65E0 AI \u8FD0\u884C\u8BB0\u5F55\u3002"));
      const projected = projectRunView(state.events);
      const conversation = projected.conversation.slice(-8);
      const actions = projected.actions;
      const requirementVersion = Number.isSafeInteger(state.sessions[segment]?.requirementRevision) ? `v${state.sessions[segment].requirementRevision}` : "\u5F53\u524D\u9700\u6C42\u7248\u672C";
      const runs = runOptions.runs.some((run) => run.id === runId) ? runOptions.runs : [{ id: runId }, ...runOptions.runs];
      const hasCurrentCandidate = detail.summaries?.candidate?.current === true;
      const count = (value) => typeof value === "number" ? new Intl.NumberFormat().format(value) : "\u672A\u77E5";
      const usd = (value) => {
        if (typeof value !== "number" || !Number.isFinite(value)) return "\u672A\u77E5";
        if (value > 0 && value < 1e-4) return "\u5927\u4E8E 0 \u4E14\u5C0F\u4E8E US$0.0001";
        if (value < 0 && value > -1e-4) return "\u5927\u4E8E -US$0.0001 \u4E14\u5C0F\u4E8E 0";
        return new Intl.NumberFormat(void 0, { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(value);
      };
      return h(
        "section",
        { "data-run-observation": "true", "data-detail-anchor": "delivery-run-observation", tabIndex: -1, style: { borderTop: `1px solid ${T.line}`, paddingTop: "18px", marginBottom: "24px", minWidth: 0 } },
        h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" } },
          h("h2", { style: { fontSize: "16px", margin: "0 auto 0 0" } }, "\u8FD0\u884C\u8BB0\u5F55"),
          runs.length > 1 ? h("label", { style: { fontSize: "13px", color: T.text2, minWidth: 0, maxWidth: "100%" } }, "\u8FD0\u884C ", h("select", { name: "run-selection", "aria-label": "\u9009\u62E9\u8FD0\u884C", value: runId, onChange: (event) => {
            setSegmentSelection(null);
            setRunId(event.target.value);
          }, style: { ...input, width: "auto", minWidth: 0, maxWidth: "100%" } }, runs.map((run) => h("option", { key: run.id, value: run.id }, `${run.id}${run.createdAt ? ` \xB7 ${formatLocalStamp(run.createdAt)}` : ""}`)))) : null,
          runOptions.next && !runOptions.error ? h("button", { type: "button", style: HUMAN_CONTROL, disabled: runOptions.loading, onClick: () => loadMoreRuns.current?.() }, "\u52A0\u8F7D\u66F4\u591A\u8FD0\u884C\u9009\u9879") : null,
          sessionOptions.length > 1 ? h("label", { style: { fontSize: "13px", color: T.text2, minWidth: 0, maxWidth: "100%" } }, "\u4F1A\u8BDD ", h("select", { name: "session-selection", "aria-label": "\u9009\u62E9\u4F1A\u8BDD", value: segment, onChange: (event) => setSegmentSelection({ runId, root, requirementId: item.id, index: Number(event.target.value) }), style: { ...input, width: "auto", minWidth: 0, maxWidth: "100%" } }, sessionOptions.map((entry, index) => h("option", { key: entry.sessionId, value: index }, `\u7B2C ${index + 1} \u6BB5${entry.reason === "resume" ? "\uFF08\u6062\u590D\uFF09" : ""}`)))) : null,
          view !== "usage" && !state.hasMore && !state.error && state.source && !["no-session", "unavailable", "corrupt"].includes(state.source) && (state.events.length > 0 || live) ? h("button", { type: "button", style: HUMAN_CONTROL, onClick: () => {
            latestRef.current?.scrollIntoView({ block: "end" });
            latestRef.current?.focus({ preventScroll: true });
          } }, "\u56DE\u5230\u6700\u65B0") : null,
          h("button", { type: "button", style: HUMAN_CONTROL, onClick: () => setRefresh((value) => value + 1) }, "\u5237\u65B0\u8BB0\u5F55")
        ),
        runOptions.error ? h("div", { role: "alert", style: { color: T.err, fontSize: "12px", marginTop: "8px" } }, "\u8FD0\u884C\u5217\u8868\u6682\u4E0D\u53EF\u7528\u3002 ", h("button", { type: "button", style: HUMAN_CONTROL, onClick: () => loadMoreRuns.current?.() }, "\u91CD\u8BD5")) : null,
        !state.complete && state.sessions.length ? h("p", { style: { color: T.text2, fontSize: "12px" } }, "\u65E9\u671F\u4F1A\u8BDD\u8BB0\u5F55\u53EF\u80FD\u4E0D\u5B8C\u6574\u3002") : null,
        state.interruptedOutputPossible ? h("p", { role: "status", style: { color: T.text2, fontSize: "12px" } }, "\u6267\u884C\u671F\u95F4\u5BBF\u4E3B\u4E2D\u65AD\uFF0C\u5C1A\u672A\u4FDD\u5B58\u7684\u5B9E\u65F6\u8F93\u51FA\u53EF\u80FD\u7F3A\u5931\u3002") : null,
        !state.loading && state.sessions[segment] ? (() => {
          const selected = state.sessions[segment];
          const stamp = (value) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? formatLocalStamp(value) : "\u672A\u77E5";
          const revision = Number.isSafeInteger(selected.requirementRevision) && selected.requirementRevision >= 0 ? `v${selected.requirementRevision}` : "\u672A\u77E5";
          const reason = { start: "\u521D\u59CB\u4F1A\u8BDD", resume: "\u6062\u590D\u4F1A\u8BDD", legacy: "\u5386\u53F2\u4F1A\u8BDD" }[selected.reason] ?? "\u6765\u6E90\u672A\u77E5";
          const source = selected.source === "dsh-session" ? "DSH \u4F1A\u8BDD" : "\u672A\u77E5";
          return h("p", { style: { color: T.text2, fontSize: "12px", margin: "8px 0" } }, `\u7B2C ${segment + 1} \u6BB5 \xB7 ${reason} \xB7 \u6765\u6E90 ${source} \xB7 \u5F00\u59CB ${stamp(selected.startedAt)} \xB7 \u7ED3\u675F ${stamp(selected.endedAt)} \xB7 \u9700\u6C42\u7248\u672C ${revision}`);
        })() : null,
        observedStatus ? h("p", { style: { color: T.text2, fontSize: "12px", margin: "8px 0" } }, `${requirementClosed ? "\u5173\u8054\u8FD0\u884C\u72B6\u6001" : "\u8FD0\u884C\u72B6\u6001"}\uFF1A${{ queued: "\u6392\u961F", running: "\u8FD0\u884C\u4E2D", "waiting-input": "\u7B49\u5F85\u8F93\u5165", paused: "\u6682\u505C", failed: "\u5931\u8D25", done: "\u7ED3\u675F", cancelled: "\u5DF2\u53D6\u6D88" }[observedStatus] ?? "\u672A\u77E5"}${requirementClosed ? "\uFF08\u9700\u6C42\u5DF2\u5173\u95ED\uFF0C\u5386\u53F2\u53EA\u8BFB\uFF09" : ""}`) : null,
        state.updatedAt && !["no-session", "unavailable", "corrupt"].includes(state.source) ? h("p", { style: { color: T.text2, fontSize: "12px", margin: "8px 0" } }, `\u5DF2\u8BB0\u5F55\u5185\u5BB9 \xB7 \u66F4\u65B0\u4E8E ${new Intl.DateTimeFormat(void 0, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(state.updatedAt)}${runId === latestRunId && canPoll ? " \xB7 \u81EA\u52A8\u66F4\u65B0" : ""}`) : null,
        h(
          "details",
          { "data-developer-debug": "true", style: { margin: "12px 0", color: T.text2, fontSize: "13px" } },
          h("summary", { style: { cursor: "pointer" } }, `\u5F00\u53D1\u8005\u8C03\u8BD5\u8BE6\u60C5\uFF08\u5DE5\u5177\u8F68\u8FF9 ${actions.length} \u6B65${projected.summary.mutations ? ` \xB7 \u4FEE\u6539 ${projected.summary.mutations} \u4E2A\u6587\u4EF6` : ""}${usage.status === "available" ? " \xB7 Token \u7528\u91CF\u53EF\u67E5\u770B" : ""}\uFF09`),
          h(
            "div",
            { role: "group", "aria-label": "\u8FD0\u884C\u8BB0\u5F55\u89C6\u56FE", style: { display: "flex", gap: "4px", margin: "10px 0 4px", flexWrap: "wrap" } },
            [["conversation", "\u5BF9\u8BDD"], ["trace", "\u8F68\u8FF9"], ["usage", "\u7528\u91CF"]].map(([id, label]) => h("button", { key: id, type: "button", "aria-pressed": view === id, onClick: () => setView(id), style: { ...HUMAN_CONTROL, background: view === id ? T.layer2 : "transparent", minHeight: "36px", padding: "6px 12px" } }, label))
          )
        ),
        state.loading ? h("p", { role: "status", style: { color: T.text2 } }, "\u6B63\u5728\u8BFB\u53D6\u8FD0\u884C\u8BB0\u5F55\u2026") : null,
        state.replaying ? h("p", { role: "status", style: { color: T.text2 } }, "\u8BB0\u5F55\u5DF2\u53D8\u5316\uFF0C\u91CD\u65B0\u6838\u5BF9\u5C1A\u672A\u5B8C\u6210\uFF1B\u4E0B\u65B9\u662F\u4E4B\u524D\u8BFB\u53D6\u7684\u5185\u5BB9\u3002") : null,
        state.error ? h("p", { role: "alert", style: { color: T.err } }, state.error, runId === latestRunId && canPoll ? "\uFF1B\u5C06\u81EA\u52A8\u91CD\u8BD5\uFF0C\u4E5F\u53EF\u5237\u65B0\u8BB0\u5F55\u3002" : "\uFF1B\u8BF7\u5237\u65B0\u8BB0\u5F55\u91CD\u8BD5\u3002") : null,
        h(
          "p",
          { role: "status", style: { color: T.text2, margin: !state.loading && !state.error && ["unavailable", "no-session"].includes(state.source) ? void 0 : 0 } },
          !state.loading && !state.error && state.source === "unavailable" ? "\u5BBF\u4E3B\u6682\u65F6\u65E0\u6CD5\u8BFB\u53D6\u6B64\u4F1A\u8BDD\u8BB0\u5F55\u3002" : !state.loading && !state.error && state.source === "no-session" ? "\u6B64\u8FD0\u884C\u5C1A\u672A\u5173\u8054 DSH \u4F1A\u8BDD\uFF0C\u6682\u65E0\u4F1A\u8BDD\u8BB0\u5F55\u3002" : ""
        ),
        !state.loading && !state.error && state.source === "corrupt" ? h("p", { role: "alert", style: { color: T.err } }, "\u6B64\u4F1A\u8BDD\u8BB0\u5F55\u65E0\u6CD5\u56DE\u653E\uFF0C\u5BBF\u4E3B\u62A5\u544A\u8BB0\u5F55\u635F\u574F\uFF1B\u539F\u59CB\u8BB0\u5F55\u4ECD\u88AB\u4FDD\u7559\u3002") : null,
        state.events.length > 0 && (state.error || ["no-session", "unavailable", "corrupt"].includes(state.source)) ? h("p", { style: { color: T.warn, fontSize: "12px" } }, "\u4EE5\u4E0B\u662F\u4E0A\u6B21\u6210\u529F\u8BFB\u53D6\u7684\u8BB0\u5F55\uFF0C\u53EF\u80FD\u4E0D\u5B8C\u6574\u6216\u5DF2\u8FC7\u671F\u3002") : null,
        view === "conversation" && liveError ? h("p", { role: "status", style: { color: T.warn, fontSize: "12px" } }, live ? "\u5B9E\u65F6\u8FDE\u63A5\u6682\u4E0D\u53EF\u7528\uFF0C\u6B63\u5728\u81EA\u52A8\u91CD\u8BD5\uFF1B\u4FDD\u7559\u7684\u5B9E\u65F6\u7247\u6BB5\u53EF\u80FD\u5DF2\u8FC7\u671F\u6216\u4E0E\u5DF2\u4FDD\u5B58\u8BB0\u5F55\u91CD\u590D\u3002" : "\u5B9E\u65F6\u5185\u5BB9\u6682\u4E0D\u53EF\u7528\uFF0C\u6B63\u5728\u81EA\u52A8\u91CD\u8BD5\uFF1B\u5DF2\u8BB0\u5F55\u5185\u5BB9\u4ECD\u53EF\u67E5\u770B\u3002") : null,
        view === "usage" ? usage.status === "loading" ? h("p", { role: "status", style: { color: T.text2 } }, "\u6B63\u5728\u8BFB\u53D6\u7528\u91CF\u2026") : usage.status !== "available" ? h("p", { style: { color: T.text2, fontSize: "13px" } }, "\u5F53\u524D\u4F1A\u8BDD\u7684\u7528\u91CF\u6570\u636E\u6682\u4E0D\u53EF\u7528\u3002") : h(
          "div",
          { "data-run-usage-summary": "true", style: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "8px", fontVariantNumeric: "tabular-nums" } },
          [["\u6A21\u578B", usage.model ?? "\u672A\u77E5"], ["\u8F93\u5165 / \u8F93\u51FA", `${count(usage.inputTokens)} / ${count(usage.outputTokens)}`], ["\u7F13\u5B58\u547D\u4E2D\u7387", usage.cacheHitPct == null ? "\u672A\u77E5" : `${count(usage.cacheHitPct)}%`], ["\u4F30\u7B97\u8D39\u7528", usd(usage.estimatedCostUsd)]].map(([label, value]) => h("div", { key: label, style: { minWidth: 0, padding: "8px", border: `1px solid ${T.line}`, borderRadius: "6px" } }, h("div", { style: { fontSize: "11px", color: T.text3 } }, label), h("div", { style: { marginTop: "2px", fontSize: "13px", overflowWrap: "anywhere" } }, value)))
        ) : h(
          "div",
          null,
          view === "conversation" && projected.summary.actions ? h(
            "div",
            { "data-run-work-summary": "true", style: { margin: "0 0 12px", padding: "10px 12px", background: T.layer2, borderLeft: `3px solid ${T.brand}`, fontSize: "13px", color: T.text2 } },
            h("strong", { style: { color: T.text } }, "\u672C\u8F6E\u5DE5\u4F5C\u6458\u8981"),
            ` \xB7 \u5DF2\u8BB0\u5F55 ${projected.summary.actions} \u4E2A\u5DE5\u7A0B\u52A8\u4F5C${projected.summary.mutations ? `\uFF0C\u4FEE\u6539 ${projected.summary.mutations} \u4E2A\u6587\u4EF6` : ""}${projected.summary.verification ? `\uFF0C\u6700\u8FD1\u9A8C\u8BC1${projected.summary.verification.status === "completed" ? "\u901A\u8FC7" : "\u5931\u8D25"}` : ""}`
          ) : null,
          !state.loading && !state.error && !["no-session", "unavailable", "corrupt"].includes(state.source) && !(view === "conversation" ? conversation.length : actions.length) && !(view === "conversation" && (liveError || live && (live.text || live.reasoning))) ? h("p", { style: { color: T.text2, fontSize: "13px" } }, view === "trace" ? "\u6B63\u5728\u7B49\u5F85\u7B2C\u4E00\u9879\u5DE5\u7A0B\u52A8\u4F5C\u3002" : "\u6B64\u4F1A\u8BDD\u6682\u65E0\u53EF\u663E\u793A\u7684\u8BB0\u5F55\u3002") : null,
          view === "conversation" ? conversation.map((row2) => {
            const entry = row2.entry;
            if (row2.kind === "dispatch") return h(
              "article",
              { key: `${entry.sessionId}:${entry.seq}:${entry.eventHash ?? ""}`, "data-run-dispatch": "true", style: { borderTop: `1px solid ${T.line}`, padding: "12px 0", minWidth: 0 } },
              h("strong", { style: { fontSize: "13px" } }, "\u{1F680} \u63A8\u8FDB\u4EFB\u52A1\u5DF2\u6D3E\u53D1"),
              h("p", { style: { margin: "5px 0 0", color: T.text2, fontSize: "13px" } }, `\u5DF2\u5411 AI \u4E0B\u53D1\u63A8\u8FDB\u6307\u4EE4 \xB7 \u951A\u5B9A\u9700\u6C42\u7248\u672C ${requirementVersion} \xB7 ${state.sessions[segment]?.reason === "resume" ? "\u65AD\u70B9\u7EED\u8DD1" : "\u521D\u59CB\u63A8\u8FDB"}`),
              h("details", { style: { marginTop: "8px", fontSize: "13px", color: T.text2 } }, h("summary", { style: { cursor: "pointer" } }, "\u67E5\u770B\u539F\u59CB\u6307\u4EE4"), h("p", { style: { margin: "8px 0 0", whiteSpace: "pre-wrap", overflowWrap: "anywhere", lineHeight: 1.65 } }, entry.text))
            );
            if (row2.kind === "audit") return h(
              "article",
              { key: `${entry.sessionId}:${entry.seq}:${entry.eventHash ?? ""}`, "data-internal-audit": "true", style: { borderTop: `1px solid ${T.line}`, padding: "12px 0", minWidth: 0, background: T.layer2 } },
              h("strong", { style: { fontSize: "13px" } }, "\u{1F50D} AI \u5185\u90E8\u8D28\u91CF\u81EA\u68C0\u62A5\u544A"),
              row2.findings.length ? h("ul", { style: { margin: "7px 0 0", paddingLeft: "18px", fontSize: "13px", lineHeight: 1.7, color: T.text2 } }, row2.findings.map((finding) => h("li", { key: finding }, finding))) : h("p", { style: { margin: "6px 0 0", fontSize: "13px", color: T.text2 } }, "AI \u5DF2\u5B8C\u6210\u5185\u90E8\u5BA1\u67E5\uFF0C\u672A\u53D1\u73B0\u53EF\u76F4\u63A5\u5C55\u793A\u7684\u4E1A\u52A1\u5F85\u8865\u9F50\u9879\u3002"),
              h("details", { style: { marginTop: "8px", fontSize: "12px", color: T.text2 } }, h("summary", { style: { cursor: "pointer" } }, "\u67E5\u770B\u539F\u59CB\u81EA\u68C0\u65E5\u5FD7"), h(RunEventText, { entry, field: "text", root, requirementId: item.id, runId, segment }))
            );
            return h(OutcomeSummaryCard, { key: `${entry.sessionId}:${entry.seq}:${entry.eventHash ?? ""}`, entry, root, requirementId: item.id, runId, segment, hasCurrentCandidate });
          }) : actions.map((action, index) => {
            const output = action.result;
            const call = action.call;
            const status = action.status === "failed" ? "\u{1F534} \u5931\u8D25" : action.status === "completed" ? "\u{1F7E2} \u5B8C\u6210" : "\u8FDB\u884C\u4E2D";
            return h(
              "article",
              { key: `${call?.sessionId ?? output?.sessionId}:${call?.seq ?? output?.seq}:${index}`, "data-engineering-action": action.type, style: { borderTop: `1px solid ${T.line}`, padding: "12px 0", minWidth: 0, contentVisibility: "auto", containIntrinsicSize: "auto 100px" } },
              h("div", { style: { display: "flex", gap: "10px", alignItems: "baseline", flexWrap: "wrap", fontSize: "13px" } }, h("strong", null, `${action.icon} ${action.title}`), h("span", { style: { color: action.status === "failed" ? T.err : action.status === "completed" ? T.ok : T.text2, fontSize: "12px" } }, status)),
              call?.text ? h("details", { style: { marginTop: "8px", fontSize: "12px", color: T.text2 } }, h("summary", { style: { cursor: "pointer" } }, "\u67E5\u770B\u8C03\u7528\u53C2\u6570"), h(RunEventText, { entry: call, field: "text", root, requirementId: item.id, runId, segment })) : null,
              output?.text ? h("details", { style: { marginTop: "8px", fontSize: "13px", color: T.text2 } }, h("summary", { style: { cursor: "pointer" } }, "\u67E5\u770B\u8F93\u51FA"), h(RunEventText, { entry: output, field: "text", root, requirementId: item.id, runId, segment, display: action.type === "skill" ? runToolOutput : void 0 })) : null,
              output?.nonTextBlocks ? h("p", { style: { color: T.text2, fontSize: "12px" } }, `\u5305\u542B ${output.nonTextBlocks} \u9879\u975E\u6587\u672C\u5185\u5BB9\uFF0C\u5F53\u524D\u672A\u5C55\u793A\u3002`) : null
            );
          }),
          view === "trace" && projected.systemEvents.length ? h("details", { "data-run-system-events": "true", style: { marginTop: "12px", fontSize: "12px", color: T.text2 } }, h("summary", { style: { cursor: "pointer" } }, `\u5E95\u5C42\u7CFB\u7EDF\u4E8B\u4EF6 (${projected.systemEvents.length} \u6761)`), h("ul", { style: { margin: "8px 0 0", paddingLeft: "18px", overflowWrap: "anywhere" } }, projected.systemEvents.map((event) => h("li", { key: `${event.seq}:${event.name}` }, event.name)))) : null,
          view === "conversation" && live && (live.text || live.reasoning) ? h(
            "article",
            { "data-live-attempt": "true", style: { borderTop: `1px solid ${T.line}`, padding: "12px 0", minWidth: 0 } },
            h("strong", { style: { fontSize: "12px" } }, "AI \u6B63\u5728\u56DE\u590D"),
            live.truncated ? h("p", { style: { color: T.text2, fontSize: "12px" } }, "\u5B9E\u65F6\u5185\u5BB9\u8FC7\u957F\uFF0C\u5F53\u524D\u663E\u793A\u5F00\u5934\uFF1B\u5B8C\u6210\u540E\u53EF\u67E5\u770B\u5B8C\u6574\u8BB0\u5F55\u3002") : null,
            live.text ? h("p", { style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: "13px", lineHeight: 1.7 } }, live.text) : null,
            live.reasoning ? h("details", null, h("summary", { style: { color: T.text2, fontSize: "13px" } }, "\u6A21\u578B\u63D0\u4F9B\u7684\u5B9E\u65F6\u63A8\u7406\u5185\u5BB9"), h("p", { style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: "13px" } }, live.reasoning)) : null
          ) : null,
          h("div", { ref: latestRef, tabIndex: -1, "aria-label": "\u8FD0\u884C\u8BB0\u5F55\u672B\u5C3E" })
        )
      );
    }
    function ArchitectureLedgerPanel({ architecture, release, githubLinks = null }) {
      if (!architecture?.path) return null;
      const sourceControl = release?.sourceControl ?? null;
      const short = (value) => String(value ?? "").slice(0, 7);
      const file = String(architecture.path).split("/").at(-1);
      const list = (title, rows, render = (value) => value) => rows?.length ? h(
        "section",
        { style: { marginTop: "10px" } },
        h("h3", { style: { margin: 0, fontSize: "12px", color: T.text } }, title),
        h("ul", { style: { margin: "5px 0 0", paddingLeft: "18px", fontSize: "12px", color: T.text2, lineHeight: 1.65 } }, rows.map((row2, index) => h("li", { key: index }, render(row2))))
      ) : null;
      return h(
        "details",
        { "data-architecture-ledger": "true", style: { marginTop: "12px", borderTop: `1px solid ${T.line}`, paddingTop: "10px" } },
        h("summary", { style: { cursor: "pointer", fontSize: "13px", color: T.text } }, `\u67E5\u770B\u67B6\u6784\u4E0E\u6570\u636E\u6A21\u578B\u4EA4\u4ED8\u6863\u6848 (${file})`),
        h(
          "div",
          { style: { marginTop: "10px", padding: "10px 12px", border: `1px solid ${T.line}`, borderRadius: "7px", background: T.layer, overflowWrap: "anywhere" } },
          architecture.title ? h("strong", { style: { fontSize: "13px" } }, architecture.title) : null,
          list("\u9700\u6C42\u4E0E\u7248\u672C\u57FA\u7EBF", architecture.baseline),
          list("\u67B6\u6784\u4E0E\u6A21\u5757\u53D8\u66F4", architecture.modules, (module) => module.role ? `${module.path}\uFF1A${module.role}` : module.path),
          githubLinks?.architectureUrl ? h("p", { "data-architecture-synced": "true", style: { margin: "10px 0 0", fontSize: "12px", color: T.ok } }, `\u{1F33F} \u67B6\u6784\u4E0E\u6A21\u5757\u53D8\u66F4\u5DF2\u6807\u8BB0\u5E76\u540C\u6B65\u81F3 GitHub \xB7 ${architecture.modules?.length ?? 0} \u4E2A\u6A21\u5757`) : h("p", { "data-architecture-local": "true", style: { margin: "10px 0 0", fontSize: "12px", color: T.warn } }, "\u26A0 \u67B6\u6784\u6863\u6848\u4EC5\u672C\u5730\u5F52\u6863\uFF0C\u5C1A\u672A\u540C\u6B65\u81F3 GitHub\uFF0C\u94FE\u63A5\u6682\u4E0D\u53EF\u7528"),
          list("\u6570\u636E\u6A21\u578B\u4E0E\u63A5\u53E3\u5951\u7EA6", architecture.contracts),
          list("\u9A8C\u8BC1\u4E0E\u8BC1\u636E\u6458\u8981", architecture.verification),
          githubLinks?.architectureUrl ? h("p", { style: { margin: "12px 0 0", fontSize: "12px" } }, h(GitHubLinkButton, { href: githubLinks.architectureUrl, compact: true }, "\u2197 \u5728 GitHub \u67E5\u770B\u67B6\u6784\u6863\u6848")) : null,
          sourceControl?.pushedToRemoteDev ? h("p", { "data-dev-commit-badge": "true", style: { margin: "12px 0 0", color: T.ok, fontSize: "12px" } }, `\u{1F33F} GitHub \u8FDC\u7AEF\u5DF2\u540C\u6B65 \xB7 \u5F00\u53D1\u5206\u652F\u63D0\u4EA4 (develop: ${short(sourceControl.devCommitSha)})`) : null,
          sourceControl?.pushedToMain ? h("p", { "data-main-commit-badge": "true", style: { margin: "5px 0 0", color: T.ok, fontSize: "12px" } }, `\u2705 \u4E3B\u5E72\u5408\u5E76\u63D0\u4EA4 (main: ${short(sourceControl.mainMergeCommitSha)})`) : null
        )
      );
    }
    function ExecutionProgress({ item, detail, root, handlers, onAcceptance, onRefresh, onOpenSession }) {
      const run = detail.summaries?.run ?? {};
      const acceptance = detail.summaries?.acceptance ?? {};
      const candidate = detail.summaries?.candidate ?? {};
      const release = detail.summaries?.release ?? null;
      const githubLinks = detail.githubLinks ?? null;
      const matter = detail.currentMatter ?? {};
      const blueprint = item.run?.blueprint ?? null;
      const diagnostic = detail.executionDiagnostic ?? null;
      const released = release?.released === true;
      const candidateReady = candidate.current === true && !released;
      const settled = ["waiting-input", "paused", "failed", "done", "cancelled"].includes(run.status);
      const title = released ? "\u{1F4E6} \u53D1\u5E03\u5F52\u6863\u62A5\u544A" : candidateReady ? "\u{1F389} AI \u5DF2\u5B8C\u6210\u5F00\u53D1\u5E76\u901A\u8FC7\u9A8C\u8BC1\uFF0C\u5F85\u4EBA\u5DE5\u7B7E\u6536" : settled ? "\u7B49\u5F85\u6062\u590D\u63A8\u8FDB\u6216\u91CD\u65B0\u9A8C\u8BC1" : run.status === "running" || run.status === "queued" ? "AI \u6B63\u5728\u7F16\u7801" : matter.headline ?? "\u7B49\u5F85\u63A8\u8FDB";
      const verification = humanAcceptanceState(acceptance);
      const action = matter.action ?? detail.primaryAction;
      const invoke = (id) => handlers?.[id]?.();
      return h(
        "div",
        { "data-progress-compact": "true", style: { display: "grid", gap: "16px" } },
        h(
          "section",
          { "data-progress-status-card": "true", style: { padding: "14px", border: `1px solid ${T.line2}`, borderLeft: `3px solid ${candidateReady ? T.ok : settled ? T.warn : T.brand}`, borderRadius: "8px", background: T.layer } },
          h("h2", { style: { margin: 0, fontSize: "16px" } }, title),
          matter.explanation ? h("p", { style: { margin: "5px 0 0", fontSize: "13px", color: T.text2, lineHeight: 1.6 } }, matter.explanation) : null,
          candidateReady && candidate.development?.pushedToRemoteDev ? h("p", { "data-dev-branch-synced": "true", style: { margin: "8px 0 0", color: T.ok, fontSize: "13px", lineHeight: 1.6 } }, `\u{1F33F} \u5F00\u53D1\u5206\u652F\u5DF2\u540C\u6B65\uFF1A\u5DF2\u63D0\u4EA4\u5E76\u63A8\u9001\u81F3 origin/${candidate.development.devBranch ?? "develop"}\uFF08Commit: ${(candidate.development.devCommitSha ?? "").slice(0, 7)}\uFF09\xB7 \u67B6\u6784\u4E0E\u6570\u636E\u6863\u6848\u5DF2\u5F52\u6863`) : null,
          candidateReady && candidate.development?.reason ? h("p", { style: { margin: "8px 0 0", color: T.warn, fontSize: "12px", lineHeight: 1.6 } }, `\u5F00\u53D1\u5206\u652F\u5C1A\u672A\u81EA\u52A8\u540C\u6B65\uFF1A${candidate.development.reason}`) : null,
          released ? h(
            "div",
            { "data-release-summary": "true", style: { marginTop: "12px", padding: "10px 12px", borderLeft: `3px solid ${T.ok}`, background: T.layer2, fontSize: "13px", color: T.text2, lineHeight: 1.6 } },
            h("strong", { style: { color: T.text } }, "\u53D1\u5E03\u5F52\u6863\u5DF2\u5B8C\u6210"),
            h("div", { style: { marginTop: "4px" } }, `\u53D1\u5E03\u8BB0\u5F55 ${release.id ?? "\u2014"} \xB7 \u4EA4\u4ED8\u5019\u9009 ${release.candidateId ?? candidate.id ?? "\u2014"}${release.releasedAt ? ` \xB7 ${formatLocalStamp(release.releasedAt)}` : ""}`),
            release.sourceControl?.pushedToRemoteDev ? h("div", { "data-release-dev-commit": "true", style: { marginTop: "5px", color: T.ok } }, `\u{1F33F} \u5F00\u53D1\u5206\u652F\u63D0\u4EA4 (develop: ${(release.sourceControl.devCommitSha ?? "").slice(0, 7)}) \xB7 GitHub \u8FDC\u7AEF\u5DF2\u540C\u6B65`) : null,
            release.mainMerged ? h("div", { "data-main-merged": "true", style: { marginTop: "5px", color: T.ok } }, `\u2705 \u4EE3\u7801\u4E0E\u67B6\u6784\u6863\u6848\u5DF2\u5408\u5165 GitHub main \u5206\u652F\uFF08Commit: ${(release.sourceControl?.mainMergeCommitSha ?? "").slice(0, 7)} \xB7 \u5206\u652F: ${release.sourceControl?.devBranch ?? "develop"} \u2192 ${release.sourceControl?.mainBranch ?? "main"}\uFF09`) : null,
            h(GitHubDeliveryLinks, { links: githubLinks, showCompare: true })
          ) : null,
          diagnostic ? h(
            "div",
            { "data-execution-diagnostic": "true", style: { marginTop: "12px", padding: "10px 12px", borderLeft: `3px solid ${T.warn}`, background: T.layer2 } },
            h("strong", { style: { fontSize: "13px" } }, diagnostic.title),
            h("p", { style: { margin: "5px 0 0", fontSize: "13px", color: T.text2, lineHeight: 1.6 } }, diagnostic.summary),
            diagnostic.log ? h("details", { style: { marginTop: "8px", fontSize: "12px", color: T.text2 } }, h("summary", { style: { cursor: "pointer" } }, "\u67E5\u770B\u5177\u4F53\u62A5\u9519\u65E5\u5FD7\u4E0E\u8BCA\u65AD\u8BE6\u60C5"), h("pre", { style: { margin: "8px 0 0", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontFamily: "inherit" } }, diagnostic.log)) : null
          ) : null,
          blueprint?.exists ? h("div", { "data-blueprint-badge": "true", style: { marginTop: "10px", fontSize: "12px", color: T.ok } }, `\u2713 \u5DF2\u751F\u6210\u6267\u884C\u84DD\u56FE\uFF08\u9501\u5B9A\u4FEE\u6539\u8303\u56F4 ${blueprint.allowedPathCount ?? 0} \u4E2A\u6A21\u5757\uFF09`) : null,
          h(
            "div",
            { style: { display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "12px" } },
            action?.id && handlers?.[action.id] ? h("button", { type: "button", style: HUMAN_PRIMARY, disabled: action.enabled === false, onClick: () => invoke(action.id) }, diagnostic?.actionLabel ?? action.label) : null,
            onAcceptance && !item.closed ? h("button", { type: "button", style: HUMAN_CONTROL, onClick: () => onAcceptance(item) }, "\u91CD\u65B0\u8FD0\u884C\u9A8C\u8BC1") : null,
            onOpenSession && run.sessionId ? h("button", { type: "button", style: HUMAN_CONTROL, onClick: () => onOpenSession(run.sessionId) }, "\u5728 DSH \u4E2D\u6253\u5F00\u4F1A\u8BDD") : null,
            h("button", { type: "button", style: HUMAN_CONTROL, onClick: () => onRefresh?.() }, "\u5237\u65B0\u72B6\u6001")
          )
        ),
        h(
          "section",
          { "data-verification-candidate-card": "true", style: { padding: "14px", border: `1px solid ${candidate.current === true ? T.ok : T.line}`, borderRadius: "8px", background: candidate.current === true ? "rgba(53,196,122,.08)" : void 0 } },
          h("h2", { style: { margin: "0 0 8px", fontSize: "15px" } }, "\u9A8C\u8BC1\u4E0E\u4EA4\u4ED8\u72B6\u6001"),
          h("p", { style: { margin: 0, fontSize: "13px", color: candidateReady || released ? T.ok : verification.color } }, released ? `\u6700\u8FD1\u9A8C\u8BC1\uFF1A\u{1F7E2} \u9A8C\u8BC1\u901A\u8FC7\uFF08\u53D1\u5E03\u5F52\u6863 ${release.id ?? "\u5DF2\u5B8C\u6210"}\uFF09` : candidateReady ? `\u6700\u8FD1\u9A8C\u8BC1\uFF1A\u{1F7E2} \u9A8C\u8BC1\u901A\u8FC7\uFF08\u4EA4\u4ED8\u5019\u9009 ${candidate.id ?? "\u5DF2\u5C31\u7EEA"} \u5DF2\u5C31\u7EEA\uFF09` : `\u6700\u8FD1\u9A8C\u8BC1\uFF1A${verification.label}${diagnostic?.summary ? ` \xB7 ${diagnostic.summary}` : ""}`),
          acceptance.finishedAt ? h("p", { style: { margin: "5px 0 0", fontSize: "12px", color: T.text2 } }, `\u6700\u8FD1\u6267\u884C\uFF1A${formatLocalStamp(acceptance.finishedAt)}`) : null,
          diagnostic?.log ? h("details", { style: { marginTop: "8px", fontSize: "12px", color: T.text2 } }, h("summary", { style: { cursor: "pointer" } }, "\u67E5\u770B\u5177\u4F53\u62A5\u9519\u65E5\u5FD7\u4E0E\u8BCA\u65AD\u8BE6\u60C5"), h("pre", { style: { margin: "8px 0 0", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontFamily: "inherit" } }, diagnostic.log)) : null,
          h("p", { style: { margin: "8px 0 0", fontSize: "13px", color: candidateReady || released ? T.ok : T.text2 } }, released ? `\u4EA4\u4ED8\u5019\u9009 ${release.candidateId ?? candidate.id ?? "\u5DF2\u751F\u6210"} \u5DF2\u5B8C\u6210\u7B7E\u6536\u4E0E\u53D1\u5E03\u5F52\u6863\u3002` : candidate.exists ? candidateReady ? `\u4EA4\u4ED8\u5019\u9009 ${candidate.id ?? "\u5DF2\u751F\u6210"} \u5DF2\u7ED1\u5B9A\u5F53\u524D\u9700\u6C42\u4E0E\u9A8C\u8BC1\u8BC1\u636E\uFF0C\u7B49\u5F85\u4EBA\u5DE5\u7B7E\u6536\u3002` : `\u4EA4\u4ED8\u5019\u9009\uFF1A${candidate.id ?? "\u5DF2\u751F\u6210"}\uFF0C\u9700\u8981\u91CD\u65B0\u6838\u9A8C` : "\u5C1A\u672A\u751F\u6210\u4EA4\u4ED8\u5019\u9009"),
          h(GitHubDeliveryLinks, { links: githubLinks }),
          h(ArchitectureLedgerPanel, { architecture: detail.record?.architecture, release, githubLinks })
        )
      );
    }
    function V4DetailPage(props) {
      const { item, detail, root, handlers, tab, onNavigate, onClose, onRefresh, scrollRef } = props;
      const [editing, setEditing] = useState(false);
      const [dirty, setDirty] = useState(false);
      const [more, setMore] = useState(false);
      const [runSelection, setRunSelection] = useState(null);
      const [refreshStatus, setRefreshStatus] = useState(null);
      const [localPendingPatch, setLocalPendingPatch] = useState(null);
      const selectedRunId = runSelection?.requirementId === item.id && runSelection?.root === (item.root ?? root) ? runSelection.runId : null;
      const mainScroll = useRef(0);
      const titleRef = useRef(null);
      const moreRef = useRef(null);
      const navigationTimerRef = useRef(null);
      const tabFocusTimerRef = useRef(null);
      useEffect(() => () => {
        clearTimeout(navigationTimerRef.current);
        clearTimeout(tabFocusTimerRef.current);
      }, []);
      useEffect(() => {
        titleRef.current?.focus?.({ preventScroll: true });
      }, [item.id]);
      useEffect(() => {
        setRefreshStatus(null);
      }, [item.id]);
      useEffect(() => {
        setLocalPendingPatch(null);
      }, [item.id, item.revision, item.pendingPatch?.patchHash]);
      useEffect(() => {
        if (!localPendingPatch) return;
        const handle = requestAnimationFrame(() => {
          const card2 = scrollRef.current?.querySelector?.("[data-pending-patch]");
          card2?.scrollIntoView?.({ block: "start", behavior: REDUCE_MOTION ? "auto" : "smooth" });
        });
        return () => cancelAnimationFrame(handle);
      }, [localPendingPatch?.patchHash]);
      const matter = detail.currentMatter ?? { kind: detail.question ? "decision" : detail.context?.kind, headline: detail.context?.headline, explanation: detail.context?.explanation, action: detail.primaryAction };
      const displayItem = localPendingPatch ? { ...item, pendingPatch: localPendingPatch } : item;
      const refreshDetail = async () => {
        if (refreshStatus?.busy) return;
        setRefreshStatus({ busy: true, text: "\u6B63\u5728\u5237\u65B0\u72B6\u6001\u2026" });
        const result = await onRefresh?.();
        if (result?.ok === false) setRefreshStatus({ busy: false, error: true, text: `\u5237\u65B0\u5931\u8D25\uFF1A${result.error ?? "\u8BF7\u7A0D\u540E\u91CD\u8BD5"}` });
        else {
          const latest = result?.data?.requirements?.find((entry) => entry.id === item.id);
          const changed = latest && (latest.revision !== item.revision || Boolean(latest.pendingPatch) !== Boolean(item.pendingPatch));
          setRefreshStatus({ busy: false, text: changed ? "\u72B6\u6001\u5DF2\u5237\u65B0\uFF0C\u9875\u9762\u5DF2\u66F4\u65B0\u4E3A\u6700\u65B0\u7ED3\u679C\u3002" : "\u72B6\u6001\u5DF2\u5237\u65B0\uFF1B\u5F53\u524D\u6CA1\u6709\u65B0\u7684\u53D8\u5316\u3002" });
        }
      };
      const leave = (callback) => {
        if (dirty && !window.confirm("\u8FD8\u6709\u672A\u63D0\u4EA4\u7684\u5185\u5BB9\u3002\u653E\u5F03\u8FD9\u4E9B\u8349\u7A3F\u5E76\u79BB\u5F00\uFF1F")) return false;
        setDirty(false);
        callback();
        return true;
      };
      useEffect(() => {
        if (!more) return;
        const dismiss = (event) => {
          if (!moreRef.current?.contains(event.target)) setMore(false);
        };
        const key = (event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setMore(false);
            moreRef.current?.querySelector("button")?.focus();
          }
        };
        document.addEventListener("pointerdown", dismiss);
        moreRef.current?.addEventListener("keydown", key);
        const menu = moreRef.current;
        return () => {
          document.removeEventListener("pointerdown", dismiss);
          menu?.removeEventListener("keydown", key);
        };
      }, [more]);
      useEffect(() => {
        const guard = (event) => {
          if (dirty) {
            event.preventDefault();
            event.returnValue = "";
          }
        };
        window.addEventListener("beforeunload", guard);
        return () => window.removeEventListener("beforeunload", guard);
      }, [dirty]);
      const onTabKeyDown = (event) => {
        if (!event.target?.closest?.("[data-detail-tab]")) return;
        const order = HUMAN_TABS.map((entry) => entry.id);
        const index = order.indexOf(tab);
        let next = null;
        if (event.key === "ArrowRight") next = order[Math.min(order.length - 1, index + 1)];
        else if (event.key === "ArrowLeft") next = order[Math.max(0, index - 1)];
        else if (event.key === "Home") next = "requirement";
        else if (event.key === "End") next = "record";
        if (!next) return;
        event.preventDefault();
        if (next === tab) return;
        if (navigate(next, null, false)) {
          clearTimeout(tabFocusTimerRef.current);
          const previousFocus = document.activeElement;
          tabFocusTimerRef.current = setTimeout(() => {
            if (document.activeElement !== previousFocus && document.activeElement !== document.body) return;
            document.querySelector(`[data-detail-tab="${next}"]`)?.focus?.();
          }, 0);
        }
      };
      const navigate = (next, anchor = null, focusHeading = true) => leave(() => {
        if (tab === "requirement") mainScroll.current = scrollRef.current?.scrollTop ?? 0;
        setMore(false);
        onNavigate(next, anchor);
        clearTimeout(navigationTimerRef.current);
        clearTimeout(tabFocusTimerRef.current);
        const previousFocus = document.activeElement;
        navigationTimerRef.current = setTimeout(() => {
          const container = scrollRef.current;
          if (document.activeElement !== previousFocus && document.activeElement !== document.body) return;
          if (anchor && container) {
            const node = Array.from(container.querySelectorAll("[data-detail-anchor]")).find((entry) => entry.dataset.detailAnchor === anchor);
            if (node) {
              for (let parent = node; parent && parent !== container; parent = parent.parentElement) {
                if (parent.tagName === "DETAILS") parent.open = true;
              }
              node.scrollIntoView?.({ block: "start" });
              node.focus?.({ preventScroll: true });
            }
            return;
          }
          if (next === "requirement" && container) container.scrollTop = mainScroll.current;
          if (focusHeading) {
            const heading = next === "requirement" ? titleRef.current : titleRef.current;
            heading?.focus?.({ preventScroll: true });
          }
        }, 60);
      });
      const viewRevision = detail.identity?.revision ?? item.revision ?? 1;
      const githubLinks = detail.githubLinks ?? null;
      const sidebarRows = [
        ...[["\u8D1F\u8D23\u4EBA", item.owner || "\u672A\u5206\u914D"], ["\u4F18\u5148\u7EA7", item.priority || "\u672A\u8BBE\u7F6E"], ["\u6765\u6E90", item.sourceSession ? "\u5BF9\u8BDD\u751F\u6210" : item.sources?.map((source) => ({ chat: "\u5BF9\u8BDD\u751F\u6210", manual: "\u624B\u52A8\u521B\u5EFA" })[String(source).toLowerCase()] ?? source).join("\u3001") || "\u672A\u767B\u8BB0"], ["\u5F53\u524D\u4FEE\u8BA2", `v${viewRevision}`], ["\u6700\u8FD1\u66F4\u65B0", detail.identity?.updatedAt ? formatLocalStamp(detail.identity.updatedAt) : "\u6682\u65E0\u8BB0\u5F55"]].map(([label, value]) => h("div", { key: label, style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", padding: "6px 0", fontSize: "13px", color: T.text2 } }, h("div", null, label), h("div", { style: { color: T.text, overflowWrap: "anywhere", textAlign: "right", minWidth: 0 } }, value))),
        h(GitHubDeliveryProperties, { key: "github-delivery", links: githubLinks })
      ];
      const cancelPendingFocus = () => {
        clearTimeout(navigationTimerRef.current);
        clearTimeout(tabFocusTimerRef.current);
      };
      return h(
        "section",
        { "data-detail-shell": "true", "data-detail-page": "v4", onPointerDownCapture: cancelPendingFocus, onKeyDownCapture: cancelPendingFocus, onKeyDown: onTabKeyDown, style: { height: "100%", minHeight: 0, display: "flex", flexDirection: "column", background: T.base, minWidth: 0 } },
        h("style", null, `[data-detail-page] .v4-reading{box-sizing:border-box;width:100%;max-width:864px;margin:0 auto;padding:24px 32px 48px;font-size:16px;line-height:1.6;overflow-wrap:anywhere;}@container (max-width:959px){[data-detail-page] .v4-reading{padding-left:24px;padding-right:24px}}@container (max-width:639px){[data-detail-page] .v4-reading{padding-left:16px;padding-right:16px}}[data-detail-page] button:focus-visible,[data-detail-page] input:focus-visible,[data-detail-page] textarea:focus-visible,[data-detail-page] summary:focus-visible,[data-detail-page] h1:focus-visible,[data-detail-page] h2:focus-visible,[data-detail-page] [data-detail-anchor]:focus-visible{outline:2px solid ${T.brand};outline-offset:3px}[data-detail-page] button:disabled{opacity:.5;cursor:not-allowed}[data-detail-page] [data-detail-section] h4{font-size:15px!important;color:${T.text}!important}[data-detail-page] [data-detail-section]{font-size:16px!important;line-height:1.6!important}[data-detail-page] [data-detail-section]>summary{min-height:44px;align-items:center!important;font-size:14px}[data-detail-page] [data-detail-section]>summary h3{font-size:14px!important}[data-detail-page] [data-detail-section] button{min-height:40px;font-size:13px!important;padding:8px 12px!important;color:${T.text}!important;border:1px solid ${T.line2}!important;border-radius:7px}[data-detail-page] [data-detail-section] button:disabled{color:${T.text3}!important}[data-detail-page] [data-detail-section] summary{cursor:pointer}[data-detail-page] [data-detail-section] summary::marker{color:${T.text2}}`),
        h("style", null, `[data-detail-page] select:focus-visible{outline:2px solid ${T.brand};outline-offset:3px}[data-detail-page] [data-human-long]:has(> details[open]) > [data-human-excerpt]{display:none}[data-detail-page] .v4-reading{max-width:1280px!important;margin-left:0!important;margin-right:0!important;padding-left:24px!important;padding-right:24px!important}[data-detail-page] .detail-columns{display:grid;grid-template-columns:minmax(0,1fr) 250px;gap:32px;align-items:start}[data-detail-page] .requirement-body{display:flex;flex-direction:column}[data-detail-page] .requirement-body>[data-detail-description]{display:contents}[data-detail-page] .requirement-body [data-description-source]{order:3}[data-detail-page] .requirement-body>[data-human-verification]{order:1}[data-detail-page] .requirement-body>[data-iteration-feedback]{order:2}[data-detail-page] .description-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}[data-detail-page] #v4-more-actions button:hover{background:${T.layer}}[data-detail-page] .detail-sidebar{border:1px solid ${T.line};border-radius:10px;background:${T.layer};padding:12px 14px;position:sticky;top:0}@container (max-width:800px){[data-detail-page] .detail-columns{grid-template-columns:minmax(0,1fr)}[data-detail-page] .detail-sidebar{position:static}[data-detail-page] .description-cards{grid-template-columns:minmax(0,1fr)}}`),
        h(
          "nav",
          { "aria-label": "\u9700\u6C42\u5BFC\u822A", style: { flexShrink: 0, display: "flex", alignItems: "center", gap: "8px", padding: "12px 16px", borderBottom: `1px solid ${T.line}` } },
          h("button", { style: HUMAN_CONTROL, onClick: () => leave(onClose), "data-drawer-close": "true" }, "\u2190 \u8FD4\u56DE\u9700\u6C42\u5217\u8868"),
          h("span", { style: { flex: 1 } }),
          matter.action?.enabled !== false && handlers[matter.action?.id] ? h("button", { type: "button", style: HUMAN_PRIMARY, onClick: () => handlers[matter.action.id]() }, matter.action.label) : null,
          h(
            "div",
            { ref: moreRef, style: { position: "relative" } },
            h("button", { style: HUMAN_CONTROL, "aria-expanded": more, "aria-controls": "v4-more-actions", onClick: () => setMore((value) => !value) }, "\u66F4\u591A \u25BE"),
            more ? h(
              "div",
              { id: "v4-more-actions", role: "group", "aria-label": "\u66F4\u591A\u64CD\u4F5C", style: { position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 20, width: "210px", padding: "6px", display: "grid", gap: "4px", border: `1px solid ${T.line2}`, borderRadius: "10px", background: T.base, boxShadow: "0 8px 32px rgba(0,0,0,.24)" } },
              h("button", { style: DETAIL_MENU_ITEM, disabled: isExecutingRequirement(item), onClick: () => leave(() => {
                setEditing(true);
                setMore(false);
                onNavigate("requirement");
              }) }, "\u7F16\u8F91\u9700\u6C42"),
              h("button", { style: DETAIL_MENU_ITEM, disabled: refreshStatus?.busy, onClick: () => {
                setMore(false);
                void refreshDetail();
              } }, refreshStatus?.busy ? "\u6B63\u5728\u5237\u65B0\u2026" : "\u5237\u65B0\u72B6\u6001"),
              props.onCancelRun && canCancelRequirementRun(detail.summaries?.run ?? item.run) ? h("button", { style: { ...DETAIL_MENU_ITEM, color: T.err, marginTop: "6px" }, "data-detail-cancel-run": "true", onClick: () => {
                setMore(false);
                props.onCancelRun(item);
              } }, "\u53D6\u6D88\u672C\u8F6E\u63A8\u8FDB\u2026") : null,
              props.onArchive ? h("button", { style: DETAIL_MENU_ITEM, onClick: () => leave(() => {
                setMore(false);
                props.onArchive(item);
              }) }, "\u5F52\u6863\u9700\u6C42\u2026") : null,
              props.onRemove ? h("button", { style: { ...DETAIL_MENU_ITEM, color: T.err }, onClick: () => leave(() => {
                setMore(false);
                props.onRemove(item);
              }) }, "\u5220\u9664\u9700\u6C42\u2026") : null
            ) : null
          )
        ),
        h("div", { role: "tablist", "aria-label": "\u9700\u6C42\u9875\u7B7E", style: { flexShrink: 0, display: "flex", padding: "0 16px", gap: "8px", overflowX: "auto", borderBottom: `1px solid ${T.line}`, background: T.base } }, HUMAN_TABS.map((entry) => h("button", { key: entry.id, id: `v4-tab-${entry.id}`, role: "tab", tabIndex: tab === entry.id ? 0 : -1, "data-detail-tab": entry.id, "aria-selected": tab === entry.id, "aria-controls": "v4-detail-body", onClick: () => navigate(entry.id), style: { flexShrink: 0, minHeight: "44px", border: 0, borderBottom: `2px solid ${tab === entry.id ? T.brand : "transparent"}`, background: "transparent", color: tab === entry.id ? T.text : T.text2, padding: "8px 12px", fontSize: "14px", fontWeight: tab === entry.id ? 600 : 400, cursor: "pointer" } }, entry.label))),
        h(
          "div",
          { id: "v4-detail-body", role: "tabpanel", "aria-labelledby": `v4-tab-${tab}`, ref: scrollRef, style: { flex: 1, minHeight: 0, overflowY: "auto", containerType: "inline-size" } },
          h(
            "article",
            { className: "v4-reading", "data-progress-reading": tab === "delivery" ? "true" : void 0 },
            h("div", { "data-detail-id": item.id, style: { fontSize: "12px", color: T.text3, marginBottom: "8px", display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" } }, h("span", null, item.id, " \xB7 ", h("span", { "data-detail-revision": String(viewRevision) }, `v${viewRevision}`)), h("span", { style: { border: `1px solid ${T.line2}`, borderRadius: "999px", padding: "2px 8px", color: T.text2 } }, item.delivery?.label ?? detail.summaries?.delivery?.label ?? "\u5F85\u63A8\u8FDB")),
            h("h1", { ref: titleRef, tabIndex: -1, id: detailTitleId(item), style: { fontFamily: "inherit", fontSize: "20px", fontWeight: 600, lineHeight: 1.45, letterSpacing: 0, margin: "0 0 18px" } }, item.title),
            refreshStatus ? h("p", { role: refreshStatus.error ? "alert" : "status", "data-detail-refresh-status": "true", style: { margin: "-8px 0 14px", fontSize: "13px", color: refreshStatus.error ? T.err : T.text2 } }, refreshStatus.text) : null,
            displayItem.pendingPatch && (tab === "requirement" || tab === "delivery") ? h(IterationFeedback, { key: item.id, item: displayItem, root, onRefresh: refreshDetail, onPatch: setLocalPendingPatch }) : null,
            h("div", { className: "detail-columns" }, h("div", { style: { minWidth: 0 } }, tab !== "requirement" ? h(
              "div",
              null,
              tab === "record" ? h(RequirementRecord, { ...props, onNavigate: (next, anchor) => {
                if (anchor === "delivery-run-observation") setRunSelection(null);
                navigate(next, anchor);
              }, onOpenRun: (runId) => {
                setRunSelection({ requirementId: item.id, root: item.root ?? root, runId });
                navigate("delivery", "delivery-run-observation");
              } }) : h(
                "div",
                null,
                !(detail.summaries?.run?.exists || item.run?.id || selectedRunId || detail.summaries?.candidate?.exists || item.candidate?.exists || detail.question || matter.kind === "decision") ? h(
                  "section",
                  { "data-progress-not-started": "true", style: { padding: "24px", border: `1px solid ${T.line}`, borderRadius: "10px", background: T.layer } },
                  h("h2", { style: { margin: "0 0 8px", fontSize: "18px" } }, "\u5F85\u542F\u52A8 AI \u63A8\u8FDB"),
                  h("p", { style: { color: T.text2, lineHeight: 1.7 } }, "\u542F\u52A8\u540E AI \u5C06\u5728\u6388\u6743\u8303\u56F4\u5185\u81EA\u52A8\u5B8C\u6210\u4EE3\u7801\u5B9E\u73B0\u4E0E\u9A8C\u8BC1\uFF0C\u9047\u5230\u4E1A\u52A1\u53D6\u820D\u6216\u9700\u6C42\u53D8\u66F4\u65F6\u4F1A\u5411\u4F60\u53D1\u8D77\u786E\u8BA4\u3002"),
                  handlers[matter.action?.id] ? h("button", { type: "button", style: HUMAN_PRIMARY, disabled: matter.action?.enabled === false, onClick: () => handlers[matter.action.id]() }, "\u4EA4\u7ED9 AI \u63A8\u8FDB") : null
                ) : h(
                  "div",
                  null,
                  h(ExecutionProgress, { item, detail, root: item.root ?? root, handlers, onAcceptance: props.onAcceptance, onRefresh: refreshDetail, onOpenSession: props.onOpenSession }),
                  h(RunObservationPanel, { item, detail, root: item.root ?? root, initialRunId: selectedRunId, onOpenSession: props.onOpenSession })
                )
              )
            ) : editing ? h(InlineRequirementEditor, { item, root, onDirty: setDirty, onCancel: () => leave(() => setEditing(false)), onDone: () => {
              setDirty(false);
              setEditing(false);
              void refreshDetail();
            } }) : h(
              "div",
              { className: "requirement-body" },
              h(DetailDescription, { item, detail, root, onRefresh: refreshDetail }),
              h(HumanVerification, { item, detail, matter }),
              !displayItem.pendingPatch ? h(IterationFeedback, { key: item.id, item: displayItem, root, onRefresh: refreshDetail, onPatch: setLocalPendingPatch }) : null
            )), h(
              "aside",
              { className: "detail-sidebar", "aria-label": "\u9700\u6C42\u5C5E\u6027" },
              h("h2", { style: { fontSize: "15px", margin: "0 0 8px" } }, "\u9700\u6C42\u5C5E\u6027"),
              ...sidebarRows
            ))
          )
        )
      );
    }
    const DESCRIPTION_STATUS_LABELS = {
      canonical: { label: "\u5DF2\u786E\u8BA4\u9700\u6C42\u63CF\u8FF0", tone: "ok" },
      legacy: { label: "\u6839\u636E\u73B0\u6709\u6B63\u6587\u5C55\u793A", tone: "neutral" },
      unconfirmed: { label: "AI \u6574\u7406 \xB7 \u672A\u786E\u8BA4", tone: "warn" }
    };
    function descriptionStatusBadge(status) {
      const key = Object.prototype.hasOwnProperty.call(DESCRIPTION_STATUS_LABELS, status) ? status : "unconfirmed";
      const entry = DESCRIPTION_STATUS_LABELS[key];
      const color = entry.tone === "warn" ? T.warn : entry.tone === "ok" ? T.ok : T.text2;
      return h(
        "span",
        {
          "data-description-status-badge": key,
          style: {
            fontSize: "11px",
            lineHeight: 1.6,
            color,
            border: `1px solid ${T.line2}`,
            borderRadius: "999px",
            padding: "0 8px",
            whiteSpace: "nowrap"
          }
        },
        entry.label
      );
    }
    function descriptionHasBody(doc) {
      if (!doc || typeof doc !== "object") return false;
      if (draftText(doc.goal).trim() || draftText(doc.problem).trim()) return true;
      for (const key of ["features", "acceptance", "scope", "outOfScope", "constraints", "pending"]) {
        if (Array.isArray(doc[key]) && doc[key].length) return true;
      }
      return false;
    }
    function detailDescriptionModel(item, detail) {
      const content = detail?.content ?? {};
      const fromDetail = content.doc ?? null;
      if (fromDetail && descriptionHasBody(fromDetail)) {
        const status = ["canonical", "legacy", "unconfirmed"].includes(fromDetail.status) ? fromDetail.status : item?.docMeta?.source === "legacy" ? "legacy" : "canonical";
        return { doc: fromDetail, status, unparsed: Array.isArray(fromDetail.unparsed) ? fromDetail.unparsed : [], derived: false };
      }
      const docView = item?.docView ?? null;
      const parsed = docView?.doc ?? (descriptionHasBody(docView) ? docView : null);
      if (parsed && descriptionHasBody(parsed)) {
        const status = docView?.legacy === true || item?.docMeta?.source === "legacy" ? "legacy" : "canonical";
        return { doc: { ...parsed, status }, status, unparsed: Array.isArray(docView?.unparsed) ? docView.unparsed : [], derived: false };
      }
      const sections = Array.isArray(content.sections) ? content.sections : [];
      const displaySections = sections.filter((section) => !section?.sameAs && draftText(section?.text).trim()).map((section) => ({ title: draftText(section.title).trim() || "\u9700\u6C42\u5185\u5BB9", text: draftText(section.text).trim() }));
      const claim = sections.find((section) => section?.kind === "claim");
      const background = sections.find((section) => section?.kind === "background");
      const fallbackText = draftText(claim?.text) || draftText(background?.text) || draftText(item?.briefText) || sections.map((section) => draftText(section?.text)).filter(Boolean).join("\n\n") || (fromDetail?.unparsed ?? []).map((entry) => draftText(entry?.text ?? entry)).filter(Boolean).join("\n\n");
      if (!fallbackText.trim()) return null;
      return {
        doc: {
          goal: fallbackText,
          problem: draftText(background?.text),
          features: [],
          acceptance: [],
          scope: [],
          outOfScope: [],
          constraints: [],
          pending: [],
          provenance: "unconfirmed",
          status: "legacy"
        },
        status: "legacy",
        unparsed: [],
        derived: true,
        displaySections,
        fallbackText: draftText(background?.text)
      };
    }
    function DetailDescription({ item, detail, root, onRefresh }) {
      const model = detailDescriptionModel(item, detail);
      const [organize, setOrganize] = useState({ open: false, busy: false, error: null, draft: null, baseline: null, diff: null, revision: null });
      if (!model) return null;
      const { doc, status } = model;
      const content = detail?.content ?? {};
      const features = Array.isArray(doc.features) ? doc.features : [];
      const acceptance = Array.isArray(doc.acceptance) ? doc.acceptance : [];
      const sections = Array.isArray(content.sections) ? content.sections : [];
      const sourceRows = [];
      for (const feature of features) {
        for (const source of draftList(feature?.sources)) sourceRows.push(`${draftText(feature?.id)} \u6765\u6E90\uFF1A${source}`);
      }
      for (const entry of acceptance) {
        for (const source of draftList(entry?.sources)) sourceRows.push(`${draftText(entry?.id)} \u6765\u6E90\uFF1A${source}`);
      }
      for (const section of sections) {
        if (section?.kind !== "background" && section?.kind !== "ai-suggestion") continue;
        const text = draftText(section?.text);
        if (text) sourceRows.push(`${draftText(section?.title) || "\u539F\u59CB\u610F\u56FE"}\uFF1A${text}`);
      }
      if (model.fallbackText) sourceRows.push(`\u539F\u59CB\u80CC\u666F\uFF1A${model.fallbackText}`);
      const unparsed = Array.isArray(model.unparsed) ? model.unparsed : [];
      const originalText = [item.sourceSession ? `\u6765\u6E90\u4F1A\u8BDD\uFF1A${item.sourceSession}` : "", ...sections.filter((section) => section?.kind === "background").map((section) => draftText(section?.text)), ...unparsed.map((entry) => draftText(entry?.text ?? entry))].filter(Boolean).join("\n\n").replace(/<!--\s*alm:meta\b[\s\S]*?-->/g, "");
      const meta = item?.docMeta ?? {};
      const paragraph = { fontSize: "14px", lineHeight: 1.65, color: T.text2, whiteSpace: "pre-wrap", wordBreak: "break-word", overflowWrap: "anywhere" };
      const list = (rows, empty) => rows.length ? h(
        "ul",
        { style: { margin: "2px 0 0", paddingLeft: "18px", fontSize: "13.5px", lineHeight: 1.7, color: T.text2 } },
        rows.map((row2, index) => h("li", { key: `${index}-${row2.slice(0, 24)}` }, row2))
      ) : h("div", { style: { fontSize: "12.5px", color: T.text3, marginTop: "2px" } }, empty);
      const runOrganize = () => {
        if (organize.busy) return;
        setOrganize((current) => ({ ...current, open: true, busy: true, error: null, revision: null }));
        writeJson("description", { action: "organize", requirementId: item.id }, root).then((payload) => {
          setOrganize({
            open: true,
            busy: false,
            error: null,
            draft: payload?.draft ?? null,
            baseline: payload?.baseline ?? null,
            diff: payload?.diff ?? null,
            revision: null
          });
        }).catch((error) => setOrganize((current) => ({ ...current, busy: false, error: error?.message ?? String(error) })));
      };
      const saveOrganize = () => {
        if (organize.busy || !organize.draft?.markdown) return;
        setOrganize((current) => ({ ...current, busy: true, error: null, revision: null }));
        writeJson(
          "description",
          {
            action: "save",
            requirementId: item.id,
            markdown: organize.draft.markdown,
            doc: organize.draft.doc ?? null,
            expectedBaseline: organize.baseline ?? null,
            apply: true
          },
          root
        ).then((payload) => {
          setOrganize((current) => ({
            ...current,
            busy: false,
            error: null,
            revision: payload?.revision ?? null,
            draft: payload?.docHash ? { ...current.draft, docHash: payload.docHash } : current.draft
          }));
          if (typeof onRefresh === "function") onRefresh();
        }).catch((error) => {
          const conflict = error?.code === "stale-baseline";
          setOrganize((current) => ({
            ...current,
            busy: false,
            error: conflict ? "\u6B63\u6587\u5DF2\u53D8\u5316\uFF08stale-baseline\uFF09\uFF0C\u8BF7\u91CD\u65B0\u6574\u7406\u540E\u518D\u4FDD\u5B58\u3002" : error?.message ?? String(error)
          }));
        });
      };
      const organizeRow = (label, body) => h(
        "div",
        { style: { display: "flex", gap: "10px", alignItems: "baseline", padding: "3px 0", minWidth: 0 } },
        h("div", { style: { flex: "0 0 74px", fontSize: "12px", color: T.text3 } }, label),
        h("div", { style: { flex: "1 1 auto", minWidth: 0, ...paragraph, fontSize: "13.5px" } }, body)
      );
      return h(
        "section",
        {
          "data-detail-description": "true",
          "data-description-status": status,
          "aria-label": "\u9700\u6C42\u63CF\u8FF0",
          style: { margin: "0", paddingTop: "22px", borderTop: `1px solid ${T.line}`, minWidth: 0 }
        },
        h(HumanDescriptionBody, { model, status }),
        h(
          "details",
          { "data-description-source": "true", style: { marginTop: "18px", fontSize: "12px", color: T.text3 } },
          h("summary", { style: { cursor: "pointer" } }, "\u539F\u59CB\u8BB0\u5F55\u4E0E\u8C03\u67E5\u8BC1\u636E"),
          h("div", { style: { marginTop: "12px", lineHeight: 1.8, overflowWrap: "anywhere" } }, originalText ? renderRich(originalText) : null),
          features.some((feature) => feature?.sources?.length) || acceptance.some((entry) => entry?.sources?.length) ? h("div", { style: { marginTop: "12px" } }, list(sourceRows, "")) : null,
          h(
            "div",
            { style: { marginTop: "12px", fontSize: "11px", overflowWrap: "anywhere" } },
            status === "legacy" ? "\u6309\u73B0\u6709\u6B63\u6587\u5C55\u793A\uFF0C\u5C1A\u672A\u786E\u8BA4\u7ED3\u6784\u5316\u63CF\u8FF0\u3002" : "\u6765\u6E90\uFF1A\u9700\u6C42\u63CF\u8FF0",
            meta.docHash ? h("p", null, "\u5185\u5BB9\u6307\u7EB9\uFF1A", String(meta.docHash).replace(/^sha256:/, "").slice(0, 8)) : null,
            meta.revision || item.revision ? h("p", null, `\u4FEE\u8BA2 v${meta.revision ?? item.revision}`) : null
          )
        ),
        status === "legacy" ? h(
          "details",
          { "data-description-tools": "true", open: organize.open || void 0, style: { marginTop: "12px", fontSize: "12px", color: T.text3 } },
          h("summary", { style: { cursor: "pointer" } }, "\u9700\u6C42\u6574\u7406\u5DE5\u5177"),
          h("p", { style: { lineHeight: 1.8 } }, "\u5C06\u73B0\u6709\u6B63\u6587\u6574\u7406\u6210\u7ED3\u6784\u5316\u63CF\u8FF0\uFF0C\u5148\u9884\u89C8\uFF0C\u518D\u51B3\u5B9A\u662F\u5426\u4FDD\u5B58\u3002"),
          h("button", { type: "button", "data-organize-description": "true", style: button, disabled: organize.busy || isExecutingRequirement(item), onClick: runOrganize }, organize.busy ? "\u6574\u7406\u4E2D\u2026" : "\u6574\u7406\u9700\u6C42\u63CF\u8FF0"),
          isExecutingRequirement(item) ? h("p", null, "AI \u6B63\u5728\u63A8\u8FDB\uFF0C\u7ED3\u675F\u540E\u53EF\u6574\u7406\u6B63\u6587\u3002") : null
        ) : null,
        organize.open || organize.error ? h(
          "div",
          { "data-organize-panel": "true", style: { marginTop: "10px", borderTop: `1px solid ${T.line}`, paddingTop: "8px" } },
          organize.error ? h("div", { style: { fontSize: "12px", color: T.err, marginBottom: "4px" } }, organize.error) : null,
          organize.draft ? h(
            "div",
            { minWidth: 0 },
            h(DraftDiffSummary, { diff: organize.diff }),
            h("div", { style: { fontSize: "12px", color: T.text3, marginTop: "6px" } }, "\u6574\u7406\u9884\u89C8\uFF08\u4FDD\u5B58\u524D\u4E0D\u4F1A\u5199\u5165\uFF09"),
            h(
              "pre",
              {
                "data-organize-preview": "true",
                style: {
                  margin: "4px 0 0",
                  maxHeight: "240px",
                  overflow: "auto",
                  background: T.layer2,
                  border: `1px solid ${T.line}`,
                  borderRadius: "8px",
                  padding: "8px 10px",
                  fontSize: "11.5px",
                  lineHeight: 1.6,
                  color: T.text2,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word"
                }
              },
              draftText(organize.draft.markdown) || draftText(organize.draft.doc?.goal)
            ),
            h(
              "div",
              { style: { display: "flex", alignItems: "center", gap: "8px", marginTop: "8px", flexWrap: "wrap" } },
              h("button", { type: "button", "data-organize-save": "true", style: { ...primary, padding: "3px 12px" }, disabled: organize.busy, onClick: saveOrganize }, organize.busy ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58\u4E3A\u89C4\u8303\u63CF\u8FF0"),
              organize.revision ? h("span", { "data-organize-notice": String(organize.revision), style: { fontSize: "12px", color: T.ok } }, `\u5DF2\u4FDD\u5B58\u4E3A v${organize.revision}`) : null,
              h("button", { type: "button", style: { ...button, padding: "3px 10px" }, disabled: organize.busy, onClick: () => setOrganize((current) => ({ ...current, open: false, draft: null, diff: null, error: null })) }, "\u6536\u8D77")
            )
          ) : h("div", { style: { fontSize: "12px", color: T.text3 } }, organize.busy ? "\u6B63\u5728\u6574\u7406\u73B0\u6709\u6B63\u6587\u2026" : "\u6574\u7406\u7ED3\u679C\u4E3A\u7A7A\u3002")
        ) : null
      );
    }
    function RequirementDetailShell({
      item,
      detail,
      allItems,
      root,
      narrow,
      tab,
      onTabChange,
      onNavigate,
      onOpenDecision,
      scrollRef,
      handlers,
      startIsolate,
      onToggleIsolate,
      notice,
      setNotice,
      onClose,
      onSnapshot,
      onDiff,
      onTrace,
      onAcceptance,
      onSignoff,
      onRelease,
      onAiReview,
      onRehearsal,
      onArchive,
      onRemove,
      onCancelRun,
      onRefresh,
      onDefect
    }) {
      return h(
        "div",
        { style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0, minWidth: 0 } },
        h("style", null, DETAIL_SHELL_CSS),
        h(DetailHeader, { item, detail, tab, root, narrow, notice, setNotice, onClose, onArchive, onRemove, onCancelRun, onRefresh }),
        h(
          "div",
          { ref: scrollRef, style: { flex: "1 1 auto", overflowY: "auto", overflowX: "hidden", minHeight: 0 } },
          h(
            "div",
            { "data-detail-body": "true", style: { width: "100%", maxWidth: "720px", margin: "0 auto", padding: narrow ? "12px 16px 24px" : "14px 28px 28px", minWidth: 0 } },
            h(CurrentTaskSummary, { detail, onQuestion: onOpenDecision, onJump: (ref) => onNavigate(ref?.tab ?? "delivery", ref?.anchor) }),
            h(DetailDescription, { item, detail, root, onRefresh }),
            h(DetailTabs, { tab, onChange: onTabChange, badges: { delivery: detail.tabs?.delivery?.badge ?? 0 } }),
            h(
              "div",
              { role: "tabpanel", id: "detail-panel", "aria-labelledby": `detail-tab-${tab}`, style: { paddingTop: "6px", minWidth: 0 } },
              tab === "delivery" ? h(DeliveryWorkspace, { item, detail, root, onNavigate, onOpenDecision, onAcceptance, onSignoff, onRelease, onAiReview, onRehearsal, onCancelRun, onRefresh, onDefect, onTrace, onSnapshot, onDiff }) : tab === "record" ? h(RequirementRecord, { item, detail, allItems, root, onNavigate, onSnapshot, onDiff, onTrace, onRefresh }) : h(RequirementContent, { item, detail, onNavigate })
            )
          )
        ),
        h(ContextActionFooter, { detail, onNavigate, handlers, startIsolate, onToggleIsolate, narrow })
      );
    }
    function DrawerContent(props) {
      const { item, allItems, root, narrow } = props;
      const detail = item && item.detailView ? item.detailView : fallbackDetailView(item, allItems);
      const executing = isExecutingRequirement(item);
      const [tab, setTab] = useState(
        () => ["requirement", "delivery", "record"].includes(props.initialTab) ? props.initialTab : "requirement"
      );
      const [startIsolate, setStartIsolate] = useState(false);
      const [decisionOpen, setDecisionOpen] = useState(false);
      const [notice, setNotice] = useState(null);
      const scrollRef = useRef(null);
      const timerRef = useRef(null);
      useEffect(() => () => {
        if (timerRef.current) clearTimeout(timerRef.current);
      }, []);
      useEffect(() => {
        if (!notice) return void 0;
        const timer = setTimeout(() => setNotice(null), 4200);
        return () => clearTimeout(timer);
      }, [notice]);
      const navigate = (nextTab, anchor) => {
        if (nextTab && nextTab !== tab) setTab(nextTab);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          const container = scrollRef.current;
          if (!container) return;
          const node = anchor ? container.querySelector(`[data-detail-anchor="${anchor}"]`) : null;
          if (node) {
            for (let parent = node; parent && parent !== container; parent = parent.parentElement) {
              if (parent.tagName === "DETAILS") parent.open = true;
            }
            if (node.scrollIntoView) node.scrollIntoView({ block: "start" });
            if (typeof node.focus === "function") {
              try {
                node.focus({ preventScroll: true });
              } catch {
              }
            }
          } else {
            container.scrollTop = 0;
          }
        }, 40);
      };
      const handlers = {
        "answer-run": () => props.onAnswer && props.onAnswer(item),
        "resume-run": () => props.onResumeRun && props.onResumeRun(item),
        "run-acceptance": () => props.onAcceptance && props.onAcceptance(item),
        "narrow-verification": () => writeJson("narrow-verification", { requirementId: item.id, apply: true }, root).then((result) => {
          props.onRefresh && props.onRefresh();
          if (result?.verification?.result !== "pass") window.alert("\u9A8C\u6536\u547D\u4EE4\u5DF2\u6536\u7A84\uFF0C\u4F46\u672C\u6B21\u9A8C\u8BC1\u4ECD\u672A\u901A\u8FC7\uFF1B\u8BF7\u67E5\u770B\u9A8C\u8BC1\u8BE6\u60C5\u3002");
        }).catch((error) => window.alert("\u6536\u7A84\u9A8C\u6536\u547D\u4EE4\u5931\u8D25\uFF1A" + error.message)),
        "continue-run": () => props.onContinueRun && props.onContinueRun(item),
        start: () => props.onStart && props.onStart(item, { isolate: startIsolate }),
        "start-fix": () => props.onStart && props.onStart(item, { isolate: startIsolate }),
        "watch-run": () => navigate("delivery"),
        "fix-review": () => navigate("delivery", "delivery-ai-suggestions"),
        "run-review": () => props.onAiReview && props.onAiReview(item),
        review: () => props.onAiReview && props.onAiReview(item),
        signoff: () => props.onSignoff && props.onSignoff(item),
        release: () => props.onRelease && props.onRelease(item),
        "execute-release": () => props.onRelease && props.onRelease(item),
        "create-candidate": () => writeJson("candidate", { requirementId: item.id }, root).then(() => props.onRefresh && props.onRefresh()).catch((error) => window.alert("\u751F\u6210\u4EA4\u4ED8\u5019\u9009\u5931\u8D25\uFF1A" + error.message)),
        refresh: () => props.onRefresh && props.onRefresh(),
        "open-record": () => setTab("record")
      };
      return h(
        "div",
        { style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0, minWidth: 0 } },
        h(V4DetailPage, {
          item,
          detail,
          allItems,
          root,
          narrow,
          onFeedback: props.onFeedback,
          tab,
          onTabChange: setTab,
          onNavigate: navigate,
          onOpenDecision: () => props.onAnswer && props.onAnswer(item),
          scrollRef,
          handlers,
          startIsolate,
          onToggleIsolate: setStartIsolate,
          notice,
          setNotice,
          onClose: props.onClose,
          onSnapshot: props.onSnapshot,
          onDiff: props.onDiff,
          onTrace: props.onTrace,
          onAcceptance: executing ? null : props.onAcceptance,
          onSignoff: executing ? null : props.onSignoff,
          onRelease: executing ? null : props.onRelease,
          onAiReview: executing ? null : props.onAiReview,
          onRehearsal: executing ? null : props.onRehearsal,
          onArchive: executing ? null : props.onArchive,
          onRemove: executing ? null : props.onRemove,
          onCancelRun: props.onCancelRun,
          onRefresh: props.onRefresh,
          onOpenSession: props.onOpenSession,
          onDefect: executing ? null : props.onDefect
        }),
        decisionOpen ? h(DecisionTextModal, { item, root, onClose: () => setDecisionOpen(false) }) : null
      );
    }
    function Drawer(props) {
      return h(DrawerContent, props);
    }
    function useDialogFocus(dialogRef, onClose, { closeOnEscape = true } = {}) {
      const closeRef = useRef(onClose);
      closeRef.current = onClose;
      useEffect(() => {
        const previous = document.activeElement;
        const onKey = (event) => {
          if (feedbackLayerOpen()) return;
          const dialogs = [...document.querySelectorAll('[role="dialog"]')];
          if (dialogs.at(-1) !== dialogRef.current) return;
          if (event.key === "Escape") {
            event.preventDefault();
            if (!closeOnEscape) {
              event.stopPropagation();
              return;
            }
            closeRef.current();
            return;
          }
          if (event.key !== "Tab") return;
          const nodes = [...dialogRef.current.querySelectorAll("button, input, textarea, select, summary, a[href], [tabindex]")].filter((node) => node.tabIndex >= 0 && !node.matches(":disabled") && !node.closest("[inert]") && node.getClientRects().length && getComputedStyle(node).visibility !== "hidden");
          const first = nodes[0], last = nodes.at(-1);
          if (!first) {
            event.preventDefault();
            dialogRef.current.focus();
            return;
          }
          if (!nodes.includes(document.activeElement) || event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            (event.shiftKey ? last : first).focus();
          }
        };
        dialogRef.current?.focus?.();
        document.addEventListener("keydown", onKey);
        return () => {
          document.removeEventListener("keydown", onKey);
          if (previous && previous !== document.body && typeof previous.focus === "function") {
            try {
              previous.focus();
            } catch {
            }
          }
        };
      }, []);
    }
    function SnapshotModal({ snapshot, onClose }) {
      const dialogRef = useRef(null);
      const { item, version, loading, content, error } = snapshot;
      useDialogFocus(dialogRef, onClose);
      return h(
        "div",
        { style: { position: "fixed", inset: 0, zIndex: 60, background: "rgba(4,6,9,.62)", backdropFilter: "blur(6px)", display: "grid", placeItems: "center", padding: "24px" }, onClick: onClose },
        h(
          "div",
          {
            role: "dialog",
            ref: dialogRef,
            tabIndex: -1,
            "aria-modal": "true",
            "aria-label": `\u7248\u672C\u5FEB\u7167 ${version.short}`,
            onClick: (event) => event.stopPropagation(),
            style: {
              width: "860px",
              maxWidth: "96vw",
              maxHeight: "88vh",
              display: "flex",
              flexDirection: "column",
              background: T.base,
              border: `1px solid ${T.line2}`,
              borderRadius: "16px",
              padding: "24px 28px",
              boxShadow: "0 24px 80px rgba(0,0,0,.5)"
            }
          },
          h(
            "div",
            { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" } },
            h("h3", { style: { margin: 0, fontSize: "18px" } }, `\u7248\u672C\u5FEB\u7167 \xB7 ${version.short}`),
            h(
              "div",
              { style: { display: "flex", alignItems: "center", gap: "6px" } },
              layerFeedbackButton({ label: `\u7248\u672C\u5FEB\u7167 \xB7 ${version.short}`, context: { requirementId: item.id, requirementRevision: version.revision ?? null } }),
              h("button", { style: { ...button, borderColor: "transparent", background: "transparent", color: T.text2, fontSize: "18px" }, onClick: onClose, "aria-label": "\u5173\u95ED" }, "\xD7")
            )
          ),
          h("p", { style: { margin: "6px 0 12px", ...muted } }, `${item.id} \xB7 ${version.date?.slice(0, 10) ?? ""} \xB7 ${version.subject}`),
          loading ? h("p", { style: muted }, "\u6B63\u5728\u8BFB\u53D6\u5FEB\u7167\u2026") : error ? h("p", { style: { color: T.err, fontSize: "13px" } }, error) : h(
            "pre",
            {
              style: {
                margin: 0,
                padding: "14px",
                overflow: "auto",
                overscrollBehavior: "contain",
                maxHeight: "56vh",
                background: T.layer,
                border: `1px solid ${T.line}`,
                borderRadius: "10px",
                fontSize: "12px",
                lineHeight: 1.7,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word"
              }
            },
            content
          ),
          h("p", { style: { margin: "10px 0 0", ...muted } }, "\u53EA\u8BFB\u5FEB\u7167\uFF1A\u8BFB\u53D6\u8BE5\u63D0\u4EA4\u65F6\u7684\u9700\u6C42\u6587\u4EF6\u5185\u5BB9\uFF0C\u4E0D\u4F1A\u6539\u52A8\u5DE5\u4F5C\u533A\u3002"),
          h(
            "div",
            { style: { display: "flex", justifyContent: "flex-end", marginTop: "14px" } },
            h("button", { style: button, onClick: onClose }, "\u5173\u95ED")
          )
        )
      );
    }
    const TRACE_DIM = {
      req: [172, 54],
      test: [162, 40],
      adr: [172, 42],
      module: [162, 42],
      interface: [172, 42],
      data: [162, 42],
      risk: [162, 42],
      missing: [162, 40],
      other: [162, 40]
    };
    const TRACE_COLOR = {
      req: T.brand,
      test: T.ok,
      adr: T.warn,
      module: T.text2,
      interface: "#7fa7ff",
      data: "#c9b8ff",
      risk: T.err,
      missing: T.err,
      other: T.text2
    };
    const TRACE_LABEL = {
      req: "\u9700\u6C42",
      test: "\u9A8C\u6536",
      adr: "\u51B3\u7B56",
      module: "\u6A21\u5757",
      interface: "\u63A5\u53E3",
      data: "\u6570\u636E",
      risk: "\u98CE\u9669",
      missing: "\u7F3A\u5931\u8D44\u4EA7",
      other: "\u8D44\u4EA7"
    };
    function TraceModal({ item, allItems, onClose, onOpenRequirement }) {
      const dialogRef = useRef(null);
      const trace = item.trace;
      const [selectedNode, setSelectedNode] = useState(null);
      useDialogFocus(dialogRef, onClose);
      const current = trace?.nodes.find((node) => node.current) ?? null;
      const related = (trace?.nodes ?? []).filter((node) => !node.current);
      const isTarget = (id) => (trace?.edges ?? []).some((edge) => edge.from === current?.id && edge.to === id);
      const targets = related.filter((node) => isTarget(node.id));
      const sources = related.filter((node) => !isTarget(node.id));
      const place = (list, x) => list.map((node, index) => {
        const [width, height] = TRACE_DIM[node.type] ?? TRACE_DIM.other;
        return { ...node, x, y: 56 + index * 74, w: width, h: height };
      });
      const laid = [
        ...place(sources, 36),
        current ? { ...current, x: 344, y: 190, w: TRACE_DIM.req[0], h: TRACE_DIM.req[1] } : null,
        ...place(targets, 652)
      ].filter(Boolean);
      const boxes = new Map(laid.map((node) => [node.id, node]));
      const graphHeight = Math.max(420, 56 + Math.max(sources.length, targets.length) * 74 + 40);
      const edges = (trace?.edges ?? []).map((edge, index) => {
        const from = boxes.get(edge.from);
        const to = boxes.get(edge.to);
        if (!from || !to) return null;
        const x1 = from.x + from.w;
        const y1 = from.y + from.h / 2;
        const x2 = to.x;
        const y2 = to.y + to.h / 2;
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        const t = 0.68;
        const labelX = (1 - t) ** 3 * x1 + 3 * (1 - t) ** 2 * t * mx + 3 * (1 - t) * t ** 2 * mx + t ** 3 * x2;
        const labelY = (1 - t) ** 3 * y1 + 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t ** 2 * y2 + t ** 3 * y2;
        return {
          key: `${edge.from}-${edge.to}-${index}`,
          path: `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`,
          label: edge.type,
          mx: labelX,
          my: labelY
        };
      }).filter(Boolean);
      const stats = trace?.stats ?? { parent: 0, children: 0, tests: 0, dependencies: 0, constraints: 0, impacted: 0 };
      const types = [...new Set((trace?.nodes ?? []).map((node) => node.type))];
      return h(
        "div",
        {
          style: {
            position: "fixed",
            inset: 0,
            zIndex: 55,
            background: "rgba(4,6,9,.62)",
            backdropFilter: "blur(6px)",
            display: "grid",
            placeItems: "center",
            padding: "24px"
          },
          onClick: onClose
        },
        h(
          "div",
          {
            role: "dialog",
            ref: dialogRef,
            tabIndex: -1,
            "aria-modal": "true",
            "aria-label": `\u8FFD\u6EAF\u89C6\u56FE ${item.id}`,
            onClick: (event) => event.stopPropagation(),
            style: {
              width: "980px",
              maxWidth: "96vw",
              maxHeight: "90vh",
              overflowY: "auto",
              overscrollBehavior: "contain",
              background: T.base,
              border: `1px solid ${T.line2}`,
              borderRadius: "16px",
              padding: "24px 28px",
              boxShadow: "0 24px 80px rgba(0,0,0,.5)"
            }
          },
          h(
            "div",
            { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" } },
            h("h3", { style: { margin: 0, fontSize: "18px" } }, `\u8FFD\u6EAF\u89C6\u56FE \xB7 ${item.id}`),
            h(
              "div",
              { style: { display: "flex", alignItems: "center", gap: "6px" } },
              layerFeedbackButton({ label: `\u8FFD\u6EAF\u89C6\u56FE \xB7 ${item.id}`, context: { requirementId: item.id, requirementRevision: item.revision ?? null, requirementFile: item.file ?? null } }),
              h("button", { style: { ...button, borderColor: "transparent", background: "transparent", color: T.text2, fontSize: "18px" }, onClick: onClose, "aria-label": "\u5173\u95ED" }, "\xD7")
            )
          ),
          h(
            "div",
            { style: { display: "flex", gap: "12px", flexWrap: "wrap", margin: "8px 0 12px", fontSize: "11.5px", color: T.text2 } },
            types.map(
              (type) => h(
                "span",
                { key: type, style: { display: "inline-flex", alignItems: "center", gap: "5px" } },
                h("span", { style: { width: "9px", height: "9px", borderRadius: "2px", background: TRACE_COLOR[type] ?? T.text2 } }),
                TRACE_LABEL[type] ?? type
              )
            ),
            h("span", { style: { marginLeft: "auto", color: T.text3 } }, "\u70B9\u51FB\u9700\u6C42\u8282\u70B9\u5207\u6362\u5F53\u524D\u9700\u6C42")
          ),
          h(
            "svg",
            { viewBox: `0 0 900 ${graphHeight}`, role: "img", "aria-label": "\u9700\u6C42\u8FFD\u6EAF\u56FE", style: { width: "100%", height: "auto", background: T.layer, border: `1px solid ${T.line}`, borderRadius: "12px" } },
            h(
              "defs",
              null,
              h(
                "marker",
                { id: "alm-trace-arrow", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" },
                h("path", { d: "M0 0 L10 5 L0 10 z", fill: "#4a5563" })
              )
            ),
            edges.map(
              (edge) => h(
                "g",
                { key: edge.key },
                h("path", { d: edge.path, fill: "none", stroke: "#3a4450", strokeWidth: 1.2, markerEnd: "url(#alm-trace-arrow)" }),
                h("text", { x: edge.mx, y: edge.my - 6, fill: "#8b95a3", fontSize: 10.5, fontFamily: "inherit", textAnchor: "middle" }, edge.label)
              )
            ),
            laid.map(
              (node) => h(
                "g",
                {
                  key: node.id,
                  role: "button",
                  tabIndex: 0,
                  "aria-label": `${node.id} ${node.title ?? ""}`,
                  onClick: () => {
                    if (!node.current && node.type === "req" && allItems.some((entry) => entry.id === node.id)) {
                      onOpenRequirement(node.id);
                    } else {
                      setSelectedNode(node);
                    }
                  },
                  onKeyDown: (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      if (!node.current && node.type === "req" && allItems.some((entry) => entry.id === node.id)) {
                        onOpenRequirement(node.id);
                      } else {
                        setSelectedNode(node);
                      }
                    }
                  },
                  style: { cursor: "pointer" }
                },
                h("rect", {
                  x: node.x,
                  y: node.y,
                  width: node.w,
                  height: node.h,
                  rx: 10,
                  fill: node.current ? "rgba(77,107,254,.12)" : T.layer2,
                  stroke: node.current ? TRACE_COLOR.req : T.line2,
                  strokeWidth: selectedNode?.id === node.id ? 2 : 1
                }),
                h("text", { x: node.x + 12, y: node.y + (node.h > 48 ? 21 : 16), fill: T.text, fontSize: 11, fontWeight: 600, fontFamily: "inherit" }, node.id),
                h(
                  "text",
                  { x: node.x + 12, y: node.y + (node.h > 48 ? 38 : 31), fill: T.text2, fontSize: 10.5, fontFamily: "inherit" },
                  (() => {
                    const title = node.title ?? (node.type === "missing" ? "\u76EE\u6807\u8D44\u4EA7\u4E0D\u5B58\u5728" : "");
                    return title.length > 20 ? `${title.slice(0, 19)}\u2026` : title;
                  })()
                )
              )
            )
          ),
          h(
            "p",
            { style: { margin: "10px 0 0", fontSize: "12px", color: T.text2 } },
            `\u5F71\u54CD\u9762\uFF1A\u4E0A\u7EA7 ${stats.parent} \xB7 \u5B50\u9700\u6C42 ${stats.children} \xB7 \u9A8C\u6536 ${stats.tests} \xB7 \u4F9D\u8D56 ${stats.dependencies} \xB7 \u7EA6\u675F ${stats.constraints} \xB7 \u53D7\u5F71\u54CD\u8D44\u4EA7 ${stats.impacted}`
          ),
          trace?.cycles?.length ? h("p", { style: { margin: "6px 0 0", fontSize: "12px", color: T.err } }, `\u68C0\u6D4B\u5230\u5173\u7CFB\u73AF\uFF1A${trace.cycles.map((cycle) => cycle.join(" \u2192 ")).join("\uFF1B")}`) : null,
          selectedNode ? h(
            "div",
            { style: { marginTop: "10px", border: `1px solid ${T.line}`, borderRadius: "10px", padding: "10px 12px", fontSize: "12px", color: T.text2, lineHeight: 1.7 } },
            h("b", { style: { color: T.text } }, selectedNode.id),
            ` \xB7 ${TRACE_LABEL[selectedNode.type] ?? selectedNode.type}${selectedNode.status ? ` \xB7 ${selectedNode.status}` : ""}`,
            selectedNode.title ? h("div", null, selectedNode.title) : h("div", { style: { color: T.warn } }, "\u76EE\u6807\u8D44\u4EA7\u4E0D\u5B58\u5728\uFF1BREL-001 \u4F1A\u628A\u5B83\u62A5\u4E3A\u60AC\u7A7A\u5173\u7CFB\u3002")
          ) : null,
          h(
            "div",
            { style: { display: "flex", justifyContent: "flex-end", marginTop: "14px" } },
            h("button", { style: button, onClick: onClose }, "\u5173\u95ED")
          )
        )
      );
    }
    function postJson(path, body, root, options = {}) {
      return fetch(`/api/alm/${path}?root=${encodeURIComponent(root)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: options.signal
      }).then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || payload?.ok === false) {
          const fallback = response.status === 404 ? "\u63A5\u53E3\u4E0D\u5B58\u5728\uFF08HTTP 404\uFF09\uFF1A\u9700\u6C42\u63D2\u4EF6\u53EF\u80FD\u5C1A\u672A\u91CD\u8F7D\uFF0C\u8BF7\u5237\u65B0\u9875\u9762\u6216\u91CD\u542F\u5BBF\u4E3B\u540E\u518D\u8BD5\u3002" : `\u8BF7\u6C42\u5931\u8D25\uFF08HTTP ${response.status}\uFF09`;
          const error = new Error(payload?.error?.message ?? fallback);
          error.code = payload?.error?.code ?? null;
          if (Array.isArray(payload?.error?.candidates)) error.candidates = payload.error.candidates;
          error.status = response.status;
          error.payload = payload;
          error.reasons = payload?.error?.reasons ?? null;
          error.appliedArtifacts = payload?.error?.appliedArtifacts ?? null;
          error.manualFallback = payload?.manualFallback === true;
          throw error;
        }
        return payload;
      });
    }
    function writeJson(path, body, root, options) {
      return postJson(`requirements/${path}`, body, root, options);
    }
    let modalSequence = 0;
    function ModalShell({ title, lead, onClose, children, footer, width = "720px", feedbackContext = null, testId = null, dataSessionId = null, dataScreen = null }) {
      const dialogRef = useRef(null);
      const modalId = useRef(null);
      if (!modalId.current) modalId.current = `requirements-modal-${++modalSequence}`;
      const titleId = testId ? `${testId}-title` : `${modalId.current}-title`;
      const leadId = `${modalId.current}-lead`;
      useDialogFocus(dialogRef, onClose);
      useEffect(() => {
        if (feedbackLayerOpen()) return;
        const initial = dialogRef.current?.querySelector('[data-modal-initial-focus="true"]');
        if (initial && typeof initial.focus === "function") initial.focus();
      }, []);
      return h(
        "div",
        {
          style: {
            position: "fixed",
            inset: 0,
            zIndex: 60,
            background: "rgba(4,6,9,.62)",
            backdropFilter: "blur(6px)",
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr)",
            placeItems: "center",
            padding: "24px"
          },
          onClick: onClose
        },
        h(
          "div",
          {
            role: "dialog",
            ref: dialogRef,
            tabIndex: -1,
            "aria-modal": true,
            "aria-labelledby": titleId,
            "aria-describedby": lead ? leadId : void 0,
            "aria-busy": dataScreen === "analyzing" ? "true" : void 0,
            ...testId ? { "data-testid": testId } : {},
            ...dataSessionId ? { "data-session-id": dataSessionId } : {},
            ...dataScreen ? { "data-screen": dataScreen } : {},
            onClick: (event) => event.stopPropagation(),
            style: {
              width,
              maxWidth: "100%",
              boxSizing: "border-box",
              maxHeight: testId === "intent-modal" ? "86vh" : "88vh",
              display: testId === "intent-modal" ? "flex" : void 0,
              flexDirection: testId === "intent-modal" ? "column" : void 0,
              overflowY: testId === "intent-modal" ? "hidden" : "auto",
              overscrollBehavior: "contain",
              background: T.base,
              border: `1px solid ${T.line2}`,
              borderRadius: "8px",
              padding: "20px 16px",
              boxShadow: "0 24px 80px rgba(0,0,0,.5)"
            }
          },
          h(
            "div",
            { style: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" } },
            h("h3", { id: titleId, style: { margin: 0, fontSize: "18px" } }, title),
            h(
              "button",
              {
                type: "button",
                "data-modal-feedback": "true",
                "aria-label": "\u53CD\u9988\u8FD9\u4E2A\u95EE\u9898",
                title: "\u53CD\u9988\uFF1A\u4E0D\u7528\u5173\u95ED\u5F39\u5C42\uFF0C\u4F1A\u51BB\u7ED3\u5F53\u524D\u754C\u9762\u4E0A\u4E0B\u6587",
                onClick: (event) => {
                  event.stopPropagation();
                  launchFeedbackFromLayer({ kind: "modal", label: title, ...feedbackContext ?? {} });
                },
                style: {
                  flex: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "5px",
                  border: `1px solid ${T.line}`,
                  background: "transparent",
                  color: T.text2,
                  borderRadius: "7px",
                  height: "28px",
                  padding: "0 10px",
                  cursor: "pointer",
                  fontSize: "12px"
                }
              },
              "\u53CD\u9988"
            ),
            h("button", { type: "button", "aria-label": "\u5173\u95ED\u5F39\u7A97", onClick: onClose, style: { ...button, padding: "4px 9px", marginLeft: "auto" } }, h(ActionIcon, { name: "close", size: 16 }))
          ),
          lead ? h("p", { id: leadId, style: { margin: "8px 0 0", ...muted, lineHeight: 1.7 } }, lead) : null,
          testId === "intent-modal" ? h("div", { style: { overflowY: "auto", minHeight: 0, overscrollBehavior: "contain" } }, children) : children,
          footer ? h("div", { style: { display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "10px", marginTop: "18px", minWidth: 0, flexShrink: 0 } }, footer) : null
        )
      );
    }
    function feedbackContextFor(item, extra = {}) {
      return {
        requirementId: item?.id ?? null,
        requirementRevision: item?.revision ?? null,
        requirementFile: item?.file ?? null,
        runId: item?.run?.id ?? null,
        candidateId: item?.candidate?.id ?? null,
        ...extra
      };
    }
    function layerFeedbackButton({ label, context = null }) {
      return h(
        "button",
        {
          type: "button",
          "data-layer-feedback": "true",
          "aria-label": "\u53CD\u9988\u8FD9\u4E2A\u754C\u9762",
          title: "\u53CD\u9988\uFF1A\u4E0D\u5173\u95ED\u5F53\u524D\u5F39\u5C42\uFF0C\u63D0\u4EA4\u65F6\u4F1A\u4FDD\u7559\u8FD9\u91CC\u7684\u73B0\u573A",
          onClick: (event) => {
            event.stopPropagation();
            launchFeedbackFromLayer({ kind: "modal", label, ...context ?? {} });
          },
          style: {
            flex: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            border: `1px solid ${T.line}`,
            background: "transparent",
            color: T.text3,
            borderRadius: "7px",
            height: "26px",
            padding: "0 9px",
            cursor: "pointer",
            fontSize: "11.5px"
          }
        },
        "\u53CD\u9988"
      );
    }
    function PlanRows({ rows }) {
      return h(
        "div",
        { style: { border: `1px solid ${T.line}`, borderRadius: "10px", padding: "4px 12px", marginTop: "14px" } },
        rows.map(
          ([label, value], index) => h(
            "div",
            { key: label, style: { ...row, borderBottom: index === rows.length - 1 ? "none" : `1px solid ${T.line}` } },
            h("span", { style: rowLabel }, label),
            h("span", { style: { color: T.text, minWidth: 0, fontSize: "12.5px" } }, value)
          )
        )
      );
    }
    const PREFLIGHT_STATUS = {
      fixed: { label: "\u5DF2\u81EA\u52A8\u5904\u7406", tone: "#34d399" },
      checked: { label: "\u5DF2\u68C0\u67E5", tone: T.text3 },
      "carry-over": { label: "\u5E26\u5165\u5F00\u53D1", tone: "#fbbf24" },
      "needs-decision": { label: "\u5F85\u4F60\u51B3\u5B9A", tone: "#f59e0b" },
      skipped: { label: "\u8DF3\u8FC7", tone: T.text3 },
      failed: { label: "\u5931\u8D25", tone: "#f87171" }
    };
    function PreflightModal({ item, root, projectMeta, isolate = false, onClose, onStarted }) {
      const [state, setState] = useState({ phase: "running", record: null, start: null, error: null });
      const [github, setGithub] = useState({ loading: false, plan: null, result: null, error: null });
      useEffect(() => {
        let alive = true;
        writeJson("preflight", { requirementId: item.id, apply: true }, root).then((record2) => {
          if (!alive) return null;
          setState((current) => ({ ...current, phase: record2?.question ? "question" : "starting", record: record2 }));
          if (record2?.question) return null;
          return writeJson("start", { requirementId: item.id, apply: true, isolate, autoAdvance: true }, root).then((started) => {
            if (!alive) return;
            setState({ phase: "done", record: record2, start: started, error: null });
            onStarted?.();
          });
        }).catch((error) => {
          if (alive) setState({ phase: "error", record: null, start: null, error: error.message });
        });
        return () => {
          alive = false;
        };
      }, [item.id, root]);
      const proceed = () => {
        setState((current) => ({ ...current, phase: "starting", error: null }));
        writeJson("start", { requirementId: item.id, apply: true, isolate, autoAdvance: true }, root).then((started) => {
          setState((current) => ({ ...current, phase: "done", start: started }));
          onStarted?.();
        }).catch((error) => setState((current) => ({ ...current, phase: "error", error: error.message })));
      };
      const changeRoot = () => state.start?.worktree?.path ?? root;
      const previewGithub = () => {
        const changeId = state.start?.changeId;
        if (!changeId) return;
        setGithub({ loading: true, plan: null, result: null, error: null });
        writeJson("github", { changeId, apply: false }, changeRoot()).then((plan) => setGithub({ loading: false, plan, result: null, error: null })).catch((error) => setGithub({ loading: false, plan: null, result: null, error: error.message }));
      };
      const applyGithub = () => {
        const changeId = state.start?.changeId;
        if (!changeId) return;
        setGithub((current) => ({ ...current, loading: true, error: null }));
        writeJson("github", { changeId, apply: true }, changeRoot()).then((result) => {
          setGithub({ loading: false, plan: null, result, error: null });
          onStarted?.();
        }).catch((error) => setGithub((current) => ({ ...current, loading: false, error: error.message })));
      };
      const record = state.record;
      const start = state.start;
      const question = record?.question;
      const running = state.phase === "running";
      const footer = [
        question ? h("button", { key: "cancel-question", style: button, onClick: onClose }, question.options?.find((option) => option.id === "cancel")?.label ?? "\u5148\u4E0D\u5F00\u59CB") : h("button", { key: "close", style: button, onClick: onClose }, start || state.phase === "error" ? "\u5173\u95ED" : state.phase === "running" ? "\u5173\u95ED\uFF08\u5C1A\u672A\u542F\u52A8\uFF09" : "\u5173\u95ED\uFF08\u542F\u52A8\u8BF7\u6C42\u5DF2\u63D0\u4EA4\uFF09"),
        question && !start && state.phase !== "starting" ? h("button", { key: "proceed", style: primary, onClick: proceed }, "\u786E\u8BA4\u5E76\u542F\u52A8 AI \u63A8\u8FDB") : null
      ];
      return h(
        ModalShell,
        {
          title: `\u4EA4\u7ED9 AI \u63A8\u8FDB \xB7 ${item.id}`,
          lead: "\u5148\u68C0\u67E5\u51C6\u5907\u60C5\u51B5\uFF0C\u518D\u4EA4\u7ED9 AI\u3002\u9047\u5230\u9700\u8981\u4F60\u51B3\u5B9A\u7684\u95EE\u9898\u4F1A\u505C\u4E0B\u6765\uFF1B\u662F\u5426\u5DF2\u542F\u52A8\uFF0C\u4EE5\u8FD9\u91CC\u7684\u7ED3\u679C\u4E3A\u51C6\u3002",
          onClose,
          feedbackContext: feedbackContextFor(item),
          footer
        },
        running ? h("p", { style: muted }, "\u6B63\u5728\u81EA\u52A8\u68C0\u67E5\u5E76\u5904\u7406\u8BC1\u636E\u2026") : null,
        state.phase === "starting" ? h("p", { style: muted }, "\u8BC1\u636E\u5DF2\u5904\u7406\u5B8C\uFF0C\u6B63\u5728\u767B\u8BB0\u53D8\u66F4\u5E76\u4EA4\u7ED9 AI \u63A8\u8FDB\u2026") : null,
        state.error ? h("p", { style: { color: T.err, fontSize: "13px" } }, state.error) : null,
        start?.execution?.runId ? h(
          "section",
          { "data-start-live-progress": "true", "aria-live": "polite", style: { padding: "18px 0", borderBottom: "1px solid " + T.line } },
          h("h3", { style: { margin: "0 0 8px", fontSize: "20px", color: T.text } }, item.detailView?.currentMatter?.headline ?? item.run?.label ?? "AI \u5DF2\u63A5\u624B\uFF0C\u6B63\u5728\u540C\u6B65\u8FDB\u5C55"),
          h("p", { style: { color: T.text2, lineHeight: 1.7, margin: 0 } }, item.detailView?.currentMatter?.explanation ?? "\u5F00\u53D1\u72B6\u6001\u5C06\u81EA\u52A8\u66F4\u65B0\u3002\u5173\u95ED\u6B64\u7A97\u53E3\u4E0D\u4F1A\u505C\u6B62 AI\u3002"),
          h("p", { style: { ...muted, margin: "8px 0 0" } }, item.development ? "\u5B9E\u9645\u5F00\u53D1\u5206\u652F\uFF1A" + (item.development.branch ?? "\u672A\u77E5") + (item.development.dedicated ? " \xB7 \u72EC\u7ACB\u529F\u80FD\u5206\u652F" : " \xB7 \u5F53\u524D\u5DE5\u4F5C\u533A\uFF0C\u5C1A\u672A\u5EFA\u7ACB\u72EC\u7ACB\u529F\u80FD PR") : "\u6B63\u5728\u8BFB\u53D6\u5B9E\u9645\u5F00\u53D1\u5206\u652F\u2026"),
          h("p", { style: { ...muted, margin: "8px 0 0" } }, "\u6BCF 3 \u79D2\u81EA\u52A8\u540C\u6B65\uFF1B\u9700\u8981\u9A8C\u6536\u6216\u4E1A\u52A1\u51B3\u5B9A\u65F6\uFF0C\u8FD9\u91CC\u7684\u63D0\u793A\u4F1A\u66F4\u65B0\u3002")
        ) : null,
        record ? h(
          "div",
          { style: { marginTop: "10px" } },
          h(
            "div",
            { style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "8px" } },
            h("span", { style: { fontSize: "12px", color: T.text3 } }, "\u68C0\u67E5\u7ED3\u8BBA"),
            h("span", { style: { fontSize: "12.5px", color: record.readiness?.ready ? "#34d399" : "#f59e0b" } }, record.readiness?.ready ? `\u53EF\u4EE5\u4EA4\u7ED9 AI \u63A8\u8FDB${(record.carryOver ?? []).length ? `\uFF1B${record.carryOver.length} \u9879\u9A8C\u6536\u95EE\u9898\u5E26\u5165\u5F00\u53D1` : ""}` : `\u9700\u8981\u4F60\u51B3\u5B9A\uFF08${record.readiness?.label ?? record.decision?.label ?? "\u5F85\u5904\u7406"}\uFF09`)
          ),
          h(
            "details",
            { "data-preflight-steps": "true", style: { marginTop: "12px" } },
            h("summary", { style: { cursor: "pointer", color: T.text2, fontSize: "12px" } }, "\u67E5\u770B\u68C0\u67E5\u8FC7\u7A0B"),
            h(
              "ul",
              { style: { margin: "8px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "6px" } },
              (record.steps ?? []).map((step, index) => {
                const meta = PREFLIGHT_STATUS[step.status] ?? { label: step.status, tone: T.text3 };
                return h(
                  "li",
                  { key: `${step.code}-${index}`, style: { display: "flex", alignItems: "flex-start", gap: "10px", border: `1px solid ${T.line}`, borderRadius: "9px", padding: "8px 10px" } },
                  h("span", { style: { flex: "none", fontSize: "10.5px", color: meta.tone, border: `1px solid ${meta.tone}44`, borderRadius: "999px", padding: "2px 8px", marginTop: "1px" } }, meta.label),
                  h(
                    "div",
                    { style: { minWidth: 0 } },
                    h("div", { style: { fontSize: "12.5px", color: T.text } }, step.title ?? step.code),
                    step.detail ? h("div", { style: { fontSize: "11.5px", color: T.text3, marginTop: "2px" } }, step.detail) : null
                  )
                );
              })
            )
          ),
          (record.carryOver ?? []).length ? h(
            "p",
            { style: { margin: "8px 0 0", fontSize: "11.5px", color: "#fbbf24" } },
            `\u5E26\u5165\u5F00\u53D1\u7EE7\u7EED\u5904\u7406\uFF1A${record.carryOver.map((entry) => entry.message ?? entry.code ?? entry).join("\uFF1B")}`
          ) : null,
          question ? h(
            "div",
            { style: { marginTop: "12px", border: "1px solid #f59e0b66", borderRadius: "10px", padding: "10px 12px", background: "#f59e0b0d" } },
            h("div", { style: { fontSize: "12.5px", color: "#f59e0b", marginBottom: "4px" } }, "\u9700\u8981\u4F60\u51B3\u5B9A"),
            h("div", { style: { fontSize: "12.5px", color: T.text2, lineHeight: 1.7 } }, question.message ?? question.code)
          ) : null,
          start ? h(
            "div",
            { style: { marginTop: "12px", borderTop: `1px solid ${T.line}`, paddingTop: "12px" } },
            h("div", { style: { ...sectionTitle, margin: "0 0 8px" } }, "\u53D8\u66F4\u5DF2\u767B\u8BB0"),
            h(
              "details",
              { style: { marginTop: "8px" } },
              h("summary", { style: { cursor: "pointer", color: T.text2, fontSize: "12px" } }, "\u67E5\u770B\u53D8\u66F4\u4E0E\u4EFB\u52A1\u8BB0\u5F55"),
              h(PlanRows, {
                rows: [
                  ["\u53D8\u66F4", start.changeId],
                  ["\u4EFB\u52A1\u5361", `${start.draft?.tasks?.length ?? 0} \u5F20`],
                  ["\u6587\u4EF6", start.draft?.files?.join("\u3001") ?? "\u2014"],
                  ...start.worktree ? [["\u9694\u79BB worktree", start.worktree.path], ["\u5206\u652F", start.worktree.branch]] : []
                ]
              })
            ),
            h("p", { style: { margin: "8px 0 0", ...muted } }, "\u53EF\u4EE5\u5728\u53F3\u4FA7\u9700\u6C42\u8BE6\u60C5\u91CC\u7EE7\u7EED\u67E5\u770B\u53D8\u66F4\u3001\u4EFB\u52A1\u5361\u4E0E GitHub \u5F52\u5C5E\u3002"),
            !start.execution ? h("p", { style: { margin: "8px 0 0", fontSize: "12px", color: "#f59e0b" } }, "\u9884\u89C8\u6A21\u5F0F\uFF1A\u672A\u8C03\u5EA6 AI \u63A8\u8FDB\u3002") : start.execution.scheduled ? h("p", { style: { margin: "8px 0 0", fontSize: "12px", color: "#34d399" } }, `AI \u5DF2\u63A5\u624B\u672C\u8F6E\u4EA4\u4ED8\uFF08\u8FD0\u884C ${start.execution.runId ?? "\u2014"} \xB7 \u4F1A\u8BDD ${start.execution.sessionId ?? "\u2014"}\uFF09\uFF1B\u5173\u95ED\u9762\u677F\u540E\u4ECD\u4F1A\u7EE7\u7EED\u3002`) : h("p", { style: { margin: "8px 0 0", fontSize: "12px", color: "#f59e0b" } }, `\u5DF2\u767B\u8BB0\u53D8\u66F4\uFF0C\u4F46\u672A\u542F\u52A8 AI \u63A8\u8FDB\uFF1A${start.execution.message ?? start.execution.reason ?? "\u8F7D\u4F53\u4E0D\u53EF\u7528"}`)
          ) : null,
          start && projectMeta?.repo ? h(
            "details",
            { style: { marginTop: "12px", borderTop: `1px solid ${T.line}`, paddingTop: "12px" } },
            h("summary", { style: { cursor: "pointer", fontSize: "12px", color: T.text2 } }, "GitHub \u5F52\u5C5E\uFF08\u53EF\u9009\uFF09"),
            github.loading ? h("p", { style: muted }, "\u6B63\u5728\u5904\u7406 GitHub\u2026") : null,
            github.error ? h("p", { style: { margin: "6px 0", color: T.err, fontSize: "12.5px" } }, github.error) : null,
            github.plan ? h("p", { style: { margin: "0 0 4px", fontSize: "12px", color: T.text2 } }, `\u5C06\u521B\u5EFA 1 \u4E2A\u9700\u6C42 Issue + ${github.plan.tasks?.length ?? 0} \u4E2A\u4EFB\u52A1\u5B50\u8BAE\u9898\uFF08${projectMeta.repo}\uFF09`) : null,
            github.result ? h("p", { style: { margin: "0 0 4px", fontSize: "12px", color: T.text2 } }, `\u5DF2\u521B\u5EFA\u9700\u6C42 Issue \u4E0E ${github.result.tasks?.length ?? 0} \u4E2A\u4EFB\u52A1\u5B50\u8BAE\u9898\uFF1B\u6620\u5C04\u5199\u5165 .alm/github.json`) : null,
            h(
              "div",
              { style: { display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "8px" } },
              !github.result ? h("button", { style: button, onClick: previewGithub, disabled: github.loading }, github.plan ? "\u91CD\u65B0\u9884\u89C8\u5EFA\u5355" : "\u9884\u89C8 GitHub \u5EFA\u5355") : null,
              github.plan && !github.result ? h("button", { style: primary, onClick: applyGithub, disabled: github.loading }, "\u521B\u5EFA GitHub Issue") : null
            )
          ) : null,
          record.auditPath ? h("details", { style: { marginTop: "10px", fontSize: "12px", color: T.text3 } }, h("summary", { style: { cursor: "pointer" } }, "\u67E5\u770B\u5BA1\u8BA1\u8BB0\u5F55"), h("p", { style: { overflowWrap: "anywhere" } }, record.auditPath)) : null
        ) : null
      );
    }
    function formatAcceptanceMs(value) {
      const ms = Number(value);
      if (!Number.isFinite(ms) || ms < 0) return "\u2014";
      return ms < 1e3 ? `${Math.round(ms)} ms` : `${(ms / 1e3).toFixed(1)} s`;
    }
    function parseAcceptanceOutput(text) {
      const source = String(text ?? "");
      const pick = (label) => {
        const match = source.match(new RegExp(`^\u2139 ${label} (\\d+(?:\\.\\d+)?)$`, "m"));
        return match ? Number(match[1]) : null;
      };
      const failingSection = source.split("\u2716 failing tests:")[1] ?? "";
      const files = [...failingSection.matchAll(/^test at (.+?):\d+:\d+$/gm)].map((match) => match[1].trim());
      const names = [...source.matchAll(/^✖ (.+?) \(/gm)].map((match) => match[1].trim()).filter(Boolean);
      const errors = [];
      for (const line of source.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (/^(AssertionError|Error|TypeError|ReferenceError|SyntaxError|RangeError)\b[: ]/.test(trimmed) || /\bAssertionError\b/.test(trimmed)) {
          const clean = trimmed.length > 180 ? `${trimmed.slice(0, 180)}\u2026` : trimmed;
          if (!errors.includes(clean)) errors.push(clean);
          if (errors.length >= 3) break;
        }
      }
      return { total: pick("tests"), pass: pick("pass"), fail: pick("fail"), durationMs: pick("duration_ms"), files, names, errors };
    }
    function describeAcceptance(evidence) {
      const commands = evidence?.commands ?? [];
      if (!commands.length) {
        return { tone: "warn", headline: "\u6CA1\u6709\u6267\u884C\u4EFB\u4F55\u547D\u4EE4", failures: [], errors: [], suggestion: "\u68C0\u67E5\u9A8C\u6536\u547D\u4EE4\u662F\u5426\u4E3A\u7A7A\uFF0C\u7136\u540E\u91CD\u8BD5\u3002", logs: [] };
      }
      const failed = commands.filter(
        (command) => command.timedOut === true || command.spawnFailed === true || Boolean(command.error) || (command.exitCode ?? 1) !== 0
      );
      const output = commands.map((command) => `${command.stdout ?? ""}${command.stderr ?? ""}`).join("\n");
      const parsed = parseAcceptanceOutput(output);
      const first = failed[0] ?? commands[0];
      const timedOut = failed.some((command) => command.timedOut === true || command.error?.code === "ETIMEDOUT");
      const notExecuted = failed.find(
        (command) => command.spawnFailed === true || command.error && command.error.code !== "ETIMEDOUT"
      );
      const totalDuration = commands.reduce((sum, command) => sum + (Number(command.durationMs) || 0), 0);
      const logs = commands.map((command) => ({
        id: command.id,
        command: (command.command ?? []).join(" "),
        exit: command.exitCode,
        durationMs: command.durationMs,
        error: command.error?.code ? `${command.error.code}${command.error.message ? `\uFF1A${command.error.message}` : ""}` : null,
        text: `${command.stdout ?? ""}${command.stderr ?? ""}`
      }));
      if (evidence?.result === "pass") {
        return {
          tone: "ok",
          headline: `\u9A8C\u6536\u901A\u8FC7 \xB7 ${commands.length} \u6761\u547D\u4EE4 \xB7 ${formatAcceptanceMs(totalDuration)}`,
          failures: [],
          errors: [],
          suggestion: null,
          logs
        };
      }
      const failureList = (parsed.files.length ? parsed.files : parsed.names).map((entry) => entry.replace(/\\/g, "/"));
      const temporary = failureList.filter((entry) => /(^|[\\/])(tmp|\.alm|changes|node_modules)([\\/]|$)/.test(entry));
      let suggestion;
      if (timedOut) {
        suggestion = `\u547D\u4EE4\u8D85\u8FC7\u8D85\u65F6\u65F6\u95F4\u88AB\u7EC8\u6B62\u3002\u53EF\u4EE5\u7F29\u5C0F\u547D\u4EE4\u8303\u56F4\uFF08\u53EA\u8DD1\u8BE5\u9700\u6C42\u7684\u6D4B\u8BD5\uFF09\uFF0C\u6216\u63D0\u9AD8\u8D85\u65F6\u65F6\u95F4\u540E\u91CD\u8DD1\u3002`;
      } else if (notExecuted) {
        suggestion = `\u547D\u4EE4\u65E0\u6CD5\u542F\u52A8\uFF08${notExecuted.error?.code ?? "\u672A\u77E5"}\uFF09\uFF0C\u6CA1\u6709\u4EA7\u751F\u6D4B\u8BD5\u7ED3\u679C\u3002\u68C0\u67E5\u8FD0\u884C\u73AF\u5883\u662F\u5426\u5141\u8BB8\u542F\u52A8\u5B50\u8FDB\u7A0B\uFF08\u4F8B\u5982\u6C99\u7BB1 EPERM\u3001\u53EF\u6267\u884C\u6587\u4EF6\u4E0D\u5B58\u5728\uFF09\uFF0C\u6216\u6539\u7528\u4E0D\u4F9D\u8D56\u5B50\u8FDB\u7A0B\u7684\u9A8C\u6536\u547D\u4EE4\u3002`;
      } else if (!parsed.total && !failureList.length) {
        suggestion = `\u547D\u4EE4\u9000\u51FA\u7801 ${first?.exitCode ?? "\u672A\u77E5"}\uFF0C\u4F46\u8F93\u51FA\u91CC\u6CA1\u6709\u6D4B\u8BD5\u6C47\u603B\u3002\u68C0\u67E5\u547D\u4EE4\u662F\u5426\u771F\u7684\u6267\u884C\u4E86\u6D4B\u8BD5\uFF0C\u6216\u5C55\u5F00\u5B8C\u6574\u65E5\u5FD7\u67E5\u770B\u539F\u59CB\u8F93\u51FA\u3002`;
      } else if (parsed.total === 0) {
        suggestion = "\u547D\u4EE4\u6CA1\u6709\u5339\u914D\u5230\u4EFB\u4F55\u6D4B\u8BD5\u3002\u68C0\u67E5\u547D\u4EE4\u91CC\u7684\u8DEF\u5F84\u662F\u5426\u6307\u5411\u8BE5\u9700\u6C42\u5BF9\u5E94\u7684\u6D4B\u8BD5\u6587\u4EF6\u3002";
      } else if (temporary.length && temporary.length >= Math.ceil(failureList.length / 2)) {
        suggestion = `\u5931\u8D25\u96C6\u4E2D\u5728\u4E34\u65F6\u6216\u751F\u6210\u76EE\u5F55\uFF08${temporary[0]} \u7B49\uFF09\u3002\u5F53\u524D\u547D\u4EE4\u4ECE\u4ED3\u5E93\u6839\u6267\u884C\u4E86 ${parsed.total} \u4E2A\u6D4B\u8BD5\uFF0C\u628A\u4E34\u65F6\u526F\u672C\u4E5F\u626B\u8FDB\u6765\u4E86\uFF1B\u5EFA\u8BAE\u628A\u547D\u4EE4\u9650\u5B9A\u5230\u8BE5\u9700\u6C42\u5BF9\u5E94\u7684\u6D4B\u8BD5\u6587\u4EF6\uFF0C\u6216\u6E05\u7406\u4E34\u65F6\u76EE\u5F55\u540E\u91CD\u8DD1\u3002`;
      } else if (parsed.total > 500) {
        suggestion = `\u547D\u4EE4\u626B\u63CF\u4E86\u6574\u4ED3 ${parsed.total} \u4E2A\u6D4B\u8BD5\u3002\u5EFA\u8BAE\u628A\u9A8C\u6536\u547D\u4EE4\u9650\u5B9A\u5230\u8BE5\u9700\u6C42\u5BF9\u5E94\u7684\u6D4B\u8BD5\u6587\u4EF6\uFF0C\u8FD0\u884C\u66F4\u5FEB\u3001\u7ED3\u8BBA\u4E5F\u66F4\u9488\u5BF9\u8BE5\u9700\u6C42\u3002`;
      } else {
        suggestion = "\u5148\u4FEE\u590D\u4E0A\u9762\u5217\u51FA\u7684\u5931\u8D25\u7528\u4F8B\uFF0C\u518D\u91CD\u8DD1\u9A8C\u6536\uFF1B\u4E5F\u53EF\u4EE5\u4FEE\u6539\u547D\u4EE4\uFF0C\u53EA\u8FD0\u884C\u8BE5\u9700\u6C42\u76F8\u5173\u7684\u6D4B\u8BD5\u3002";
      }
      const headlineParts = [];
      if (parsed.total != null) headlineParts.push(`${parsed.fail ?? failureList.length ?? "\u82E5\u5E72"} \u4E2A\u6D4B\u8BD5\u5931\u8D25`);
      if (parsed.total != null) headlineParts.push(`\u5171 ${parsed.total} \u4E2A\u6D4B\u8BD5\uFF0C${parsed.pass ?? 0} \u4E2A\u901A\u8FC7`);
      const reason = timedOut ? "\u8D85\u65F6" : notExecuted ? `\u65E0\u6CD5\u6267\u884C\uFF08${notExecuted.error?.code ?? "\u672A\u77E5"}\uFF09` : `\u9000\u51FA\u7801 ${first?.exitCode ?? "\u672A\u77E5"}`;
      const headline = headlineParts.length ? `\u9A8C\u6536\u672A\u901A\u8FC7 \xB7 ${headlineParts.join(" / ")}` : `\u9A8C\u6536\u672A\u901A\u8FC7 \xB7 ${reason} \xB7 ${formatAcceptanceMs(totalDuration)}`;
      return { tone: "err", headline, failures: failureList, errors: parsed.errors, suggestion, logs };
    }
    function AcceptanceModal({ item, root, onClose, onDone }) {
      const [state, setState] = useState({
        loading: true,
        plan: null,
        result: null,
        error: null,
        errorCode: null,
        running: false,
        startedAt: 0,
        elapsedMs: 0,
        cancelled: false,
        editing: false,
        commandText: "",
        saving: false
      });
      const controllerRef = useRef(null);
      const autoRunRef = useRef(false);
      const skipAutoRunRef = useRef(false);
      function beginRun() {
        controllerRef.current?.abort();
        const controller = new AbortController();
        controllerRef.current = controller;
        const startedAt = Date.now();
        setState((current) => ({ ...current, running: true, startedAt, elapsedMs: 0, error: null, errorCode: null, cancelled: false, result: null }));
        writeJson("acceptance", { requirementId: item.id, apply: true }, root, { signal: controller.signal }).then((result2) => {
          if (controller.signal.aborted) return;
          controllerRef.current = null;
          setState((current) => ({ ...current, running: false, plan: null, result: result2, error: null, elapsedMs: Date.now() - startedAt }));
          onDone?.();
        }).catch((error) => {
          if (controller.signal.aborted || error?.name === "AbortError") {
            setState((current) => ({ ...current, running: false, cancelled: true, elapsedMs: Date.now() - startedAt }));
            return;
          }
          controllerRef.current = null;
          setState((current) => ({ ...current, running: false, error: error.message, errorCode: error.code ?? null, elapsedMs: Date.now() - startedAt }));
        });
      }
      const load = useCallback(() => {
        setState((current) => ({ ...current, loading: true, plan: null, result: null, error: null, errorCode: null, running: false, saving: false }));
        writeJson("acceptance", { requirementId: item.id }, root).then((plan2) => {
          setState((current) => ({
            ...current,
            loading: false,
            plan: plan2,
            error: null,
            errorCode: null,
            editing: false,
            commandText: (plan2.commands ?? []).map((entry) => entry.command.join(" ")).join("\n")
          }));
          if (!skipAutoRunRef.current && !autoRunRef.current) {
            autoRunRef.current = true;
            beginRun();
          }
        }).catch(
          (error) => setState((current) => ({
            ...current,
            loading: false,
            plan: null,
            result: null,
            errorCode: error.code ?? null,
            // Not registered yet: open the editor instead of a dead end. The
            // missing-config error is expected here, so do not show it as a failure.
            editing: error.code === "no-config",
            error: error.code === "no-config" ? null : error.message
          }))
        );
      }, [item.id, root]);
      useEffect(() => {
        load();
      }, [load]);
      useEffect(() => () => {
        controllerRef.current?.abort();
      }, []);
      useEffect(() => {
        if (!state.running) return void 0;
        const started = state.startedAt || Date.now();
        const timer = setInterval(() => {
          setState((current) => current.running ? { ...current, elapsedMs: Date.now() - started } : current);
        }, 250);
        return () => clearInterval(timer);
      }, [state.running, state.startedAt]);
      const cancelWait = () => {
        controllerRef.current?.abort();
        controllerRef.current = null;
        setState((current) => ({ ...current, running: false, cancelled: true, elapsedMs: Date.now() - (current.startedAt || Date.now()) }));
      };
      const save = () => {
        const commands = String(state.commandText ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
        if (commands.length === 0) {
          setState((current) => ({ ...current, error: "\u8BF7\u81F3\u5C11\u586B\u5199\u4E00\u6761\u9A8C\u6536\u547D\u4EE4\u3002" }));
          return;
        }
        setState((current) => ({ ...current, saving: true, error: null, errorCode: null }));
        writeJson("acceptance-config", { requirementId: item.id, commands, apply: true }, root).then(() => {
          skipAutoRunRef.current = true;
          load();
          onDone?.();
        }).catch((error) => setState((current) => ({ ...current, saving: false, error: error.message, errorCode: error.code ?? null })));
      };
      const plan = state.plan;
      const result = state.result;
      const evidence = result?.evidence;
      const editing = state.editing;
      const summary = evidence ? describeAcceptance(evidence) : null;
      const commandTextEmpty = !String(state.commandText ?? "").split("\n").some((line) => line.trim());
      const footer = editing ? [
        h("button", { key: "cancel", style: button, onClick: () => {
          if (plan) setState((current) => ({ ...current, editing: false, error: null }));
          else onClose();
        } }, plan ? "\u53D6\u6D88\u4FEE\u6539" : "\u5173\u95ED"),
        h("button", { key: "save", style: primary, onClick: save, disabled: state.saving || commandTextEmpty }, state.saving ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58\u547D\u4EE4")
      ] : state.running ? [
        h("button", { key: "cancel", style: button, onClick: cancelWait }, "\u505C\u6B62\u7B49\u5F85")
      ] : [
        h("button", { key: "close", style: result ? primary : button, onClick: onClose }, "\u5173\u95ED"),
        evidence ? h("button", { key: "again", style: button, onClick: beginRun }, "\u91CD\u8DD1\u9A8C\u6536") : null,
        evidence || plan ? h("button", { key: "edit", style: button, onClick: () => setState((current) => ({ ...current, editing: true, error: null })) }, "\u4FEE\u6539\u547D\u4EE4") : null,
        plan && !evidence ? h("button", { key: "run", style: primary, onClick: beginRun }, "\u8FD0\u884C\u9A8C\u6536") : null
      ];
      return h(
        ModalShell,
        {
          title: `\u9A8C\u8BC1\u4EA4\u4ED8 \xB7 ${item.id}`,
          lead: "\u8FD0\u884C\u5DF2\u767B\u8BB0\u7684\u68C0\u67E5\uFF0C\u6838\u5BF9\u4EA4\u4ED8\u662F\u5426\u7B26\u5408\u8981\u6C42\u3002\u7ED3\u679C\u4F1A\u7559\u4E0B\u8BC1\u636E\uFF1B\u68C0\u67E5\u901A\u8FC7\u4E0D\u7B49\u4E8E\u4F60\u5DF2\u63A5\u53D7\u4EA4\u4ED8\u3002",
          onClose,
          feedbackContext: feedbackContextFor(item),
          width: "820px",
          footer
        },
        state.loading ? h("p", { style: muted }, "\u6B63\u5728\u8BFB\u53D6\u9A8C\u6536\u914D\u7F6E\u2026") : null,
        editing ? h(
          "div",
          null,
          h("p", { style: { margin: 0, ...muted } }, "\u4E00\u884C\u4E00\u6761\u547D\u4EE4\uFF1B\u547D\u4EE4\u4E0D\u7ECF\u8FC7 shell\uFF0C\u4E0D\u80FD\u7528 | > ; & $ \u7B49\u64CD\u4F5C\u7B26\u3002"),
          h(
            "p",
            { style: { margin: "6px 0 0", color: T.text3, fontSize: "12px" } },
            "\u793A\u4F8B\uFF08\u8BF7\u66FF\u6362\u6210\u8BE5\u9700\u6C42\u5BF9\u5E94\u7684\u6D4B\u8BD5\uFF09\uFF1A",
            h("code", { style: { marginLeft: "6px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" } }, "node --test test/your-feature.test.mjs")
          ),
          h("textarea", {
            value: state.commandText,
            name: "acceptance-command",
            autoComplete: "off",
            "aria-label": "\u9A8C\u6536\u547D\u4EE4",
            spellCheck: false,
            onChange: (event) => setState((current) => ({ ...current, commandText: event.target.value })),
            placeholder: "node --test test/your-feature.test.mjs",
            style: { ...input, width: "100%", minHeight: "96px", marginTop: "8px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "12px", lineHeight: 1.6, resize: "vertical" }
          }),
          h("p", { style: { margin: "8px 0 0", color: T.text3, fontSize: "12px" } }, "\u4FDD\u5B58\u540E\u4F1A\u5199\u5165 .alm/acceptance/<\u9700\u6C42 ID>.json\uFF1B\u65E7\u8BC1\u636E\u4F1A\u6807\u8BB0\u4E3A\u4E0E\u5F53\u524D\u7248\u672C\u4E0D\u4E00\u81F4\u3002")
        ) : null,
        state.error && !editing ? h(
          "div",
          { style: { marginTop: "10px", padding: "10px 12px", border: `1px solid ${T.err}`, borderRadius: "10px", background: T.layer } },
          h("p", { style: { margin: 0, color: T.err, fontSize: "12.5px" } }, state.error)
        ) : null,
        editing && state.error ? h("p", { style: { margin: "8px 0 0", color: T.err, fontSize: "12.5px" } }, state.error) : null,
        state.running ? h(
          "div",
          { style: { marginTop: "12px", padding: "12px 14px", border: `1px solid ${T.line}`, borderRadius: "10px", background: T.layer } },
          h(
            "div",
            { style: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px" } },
            h("p", { style: { margin: 0, color: T.text, fontSize: "13px", fontWeight: 600 } }, "\u6B63\u5728\u6267\u884C\u9A8C\u6536\u547D\u4EE4"),
            h("span", { style: { color: T.text3, fontSize: "12px" } }, `\u5DF2\u7528 ${formatAcceptanceMs(state.elapsedMs)}`)
          ),
          h("p", { style: { margin: "6px 0 0", color: T.text3, fontSize: "12px" } }, "\u547D\u4EE4\u5728\u4ED3\u5E93\u6839\u6267\u884C\uFF0C\u5B8C\u6210\u540E\u4F1A\u5199\u5165\u8BC1\u636E\uFF1B\u53EF\u4EE5\u505C\u6B62\u7B49\u5F85\uFF0C\u547D\u4EE4\u672C\u8EAB\u4E0D\u4F1A\u4E2D\u65AD\u3002")
        ) : null,
        state.cancelled && !state.running && !evidence ? h("p", { style: { margin: "10px 0 0", color: T.text3, fontSize: "12.5px" } }, "\u5DF2\u505C\u6B62\u7B49\u5F85\u3002\u547D\u4EE4\u53EF\u80FD\u4ECD\u5728\u540E\u53F0\u6267\u884C\uFF0C\u7A0D\u540E\u5237\u65B0\u53EF\u67E5\u770B\u8BC1\u636E\u3002") : null,
        plan ? h(
          "details",
          { "data-acceptance-commands": "true", style: { marginTop: "12px" } },
          h("summary", { style: { cursor: "pointer", fontSize: "12px", color: T.text2 } }, "\u67E5\u770B\u6267\u884C\u547D\u4EE4\u4E0E\u7248\u672C"),
          h(PlanRows, {
            rows: [
              ["\u9700\u6C42", plan.requirement],
              ["\u63D0\u4EA4", shortHash(plan.headSha, 12)],
              ["\u547D\u4EE4\u6570", `${plan.commands.length}`]
            ]
          }),
          h(
            "div",
            { style: { marginTop: "8px", border: `1px solid ${T.line}`, borderRadius: "10px", padding: "6px 12px" } },
            plan.commands.map(
              (command) => h(
                "div",
                { key: command.id, style: { ...row, borderBottom: "none", padding: "4px 0", alignItems: "baseline" } },
                h("span", { style: { color: T.text3, fontSize: "11.5px", width: "80px", flex: "none" } }, command.id),
                h("code", { style: { color: T.text, fontSize: "12px", wordBreak: "break-all" } }, command.command.join(" "))
              )
            )
          )
        ) : null,
        summary ? h(
          "div",
          { style: { marginTop: "12px" } },
          h(
            "div",
            {
              style: {
                padding: "12px 14px",
                border: `1px solid ${summary.tone === "ok" ? T.ok : summary.tone === "err" ? T.err : T.warn}`,
                borderRadius: "10px",
                background: T.layer
              }
            },
            h("p", { style: { margin: 0, color: summary.tone === "ok" ? T.ok : summary.tone === "err" ? T.err : T.warn, fontSize: "13px", fontWeight: 650 } }, summary.headline),
            summary.failures.length ? h(
              "div",
              { style: { marginTop: "8px" } },
              h("p", { style: { margin: 0, color: T.text3, fontSize: "11.5px" } }, "\u5931\u8D25\u7684\u6D4B\u8BD5"),
              summary.failures.slice(0, 5).map(
                (entry, index) => h("div", { key: `${entry}-${index}`, style: { marginTop: "4px", color: T.text2, fontSize: "12px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", wordBreak: "break-all" } }, entry)
              ),
              summary.failures.length > 5 ? h("p", { style: { margin: "4px 0 0", color: T.text3, fontSize: "11.5px" } }, `\u53E6\u6709 ${summary.failures.length - 5} \u9879\uFF0C\u5C55\u5F00\u5B8C\u6574\u65E5\u5FD7\u67E5\u770B\u3002`) : null
            ) : null,
            summary.errors.length ? h(
              "div",
              { style: { marginTop: "8px" } },
              summary.errors.map((entry) => h("p", { key: entry, style: { margin: "2px 0 0", color: T.err, fontSize: "12px", wordBreak: "break-word" } }, entry))
            ) : null,
            summary.suggestion ? h("p", { style: { margin: "8px 0 0", color: T.text2, fontSize: "12.5px", lineHeight: 1.6 } }, `\u5EFA\u8BAE\uFF1A${summary.suggestion}`) : null
          ),
          h(
            "details",
            { "data-acceptance-evidence": "true", style: { marginTop: "10px" } },
            h("summary", { style: { cursor: "pointer", fontSize: "12px", color: T.text2 } }, "\u67E5\u770B\u9A8C\u8BC1\u4F9D\u636E"),
            h("p", { style: { margin: "8px 0 0", color: T.text3, fontSize: "11.5px", overflowWrap: "anywhere" } }, `\u63D0\u4EA4 ${shortHash(evidence.headSha, 12)} \xB7 \u8BC1\u636E ${result.evidencePath}`),
            h(AcceptanceProvenance, { latest: evidence })
          ),
          summary.logs.length ? h(
            "details",
            { style: { marginTop: "10px" } },
            h("summary", { style: { cursor: "pointer", color: T.text3, fontSize: "12px" } }, "\u5C55\u5F00\u5B8C\u6574\u8F93\u51FA\uFF08\u539F\u59CB\u65E5\u5FD7\uFF09"),
            summary.logs.map(
              (log) => h(
                "div",
                { key: log.id, style: { marginTop: "8px" } },
                h("p", { style: { margin: "0 0 4px", color: T.text3, fontSize: "11.5px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" } }, `${log.id} \xB7 ${log.command} \xB7 ${log.error ? log.error : `exit ${log.exit ?? "timeout"}`} \xB7 ${formatAcceptanceMs(log.durationMs)}`),
                h("pre", { style: { margin: 0, padding: "10px", maxHeight: "260px", overflow: "auto", background: T.layer2 ?? T.layer, border: `1px solid ${T.line}`, borderRadius: "8px", fontSize: "11px", whiteSpace: "pre-wrap", color: T.text2 } }, log.text || "\uFF08\u65E0\u8F93\u51FA\uFF09")
              )
            )
          ) : null
        ) : null
      );
    }
    function AiReviewModal({ item, root, onClose, onDone }) {
      const hasStored = Boolean(item.aiReview?.stored);
      const [phase, setPhase] = useState(hasStored ? "loading" : "intro");
      const [report, setReport] = useState(null);
      const [error, setError] = useState(null);
      const [selected, setSelected] = useState([]);
      const [adopted, setAdopted] = useState(null);
      const applyReport = (next) => {
        setReport(next);
        setSelected([]);
        setPhase("report");
      };
      const load = useCallback(() => {
        if (!hasStored) return;
        setPhase("loading");
        writeJson("ai-review", { requirementId: item.id, load: true }, root).then((next) => applyReport(next)).catch((err) => {
          setError(err.message);
          setPhase("intro");
        });
      }, [hasStored, item.id, root]);
      useEffect(() => {
        load();
      }, [load]);
      const generate = () => {
        setPhase("generating");
        setError(null);
        writeJson("ai-review", { requirementId: item.id }, root).then((next) => applyReport(next)).catch((err) => {
          setError(err.message);
          setPhase("intro");
        });
      };
      const adopt = () => {
        if (selected.length === 0) return;
        setPhase("adopting");
        setError(null);
        writeJson("ai-review", { requirementId: item.id, apply: true, selectedSuggestionIds: selected }, root).then((next) => {
          setAdopted(next.adopted ?? { suggestionIds: selected });
          setReport(next);
          setPhase("adopted");
          onDone?.();
        }).catch((err) => {
          setError(err.message);
          setPhase("report");
        });
      };
      const toggle = (id) => setSelected((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]);
      const verdictMeta = report ? VERDICT[report.verdict] ?? VERDICT.warn : null;
      return h(
        ModalShell,
        {
          title: `AI \u4F18\u5316\u5EFA\u8BAE \xB7 ${item.id}`,
          lead: "AI \u5EFA\u8BAE\u4EC5\u4F9B\u4F18\u5316\u9700\u6C42\u6B63\u6587\u3002\u9ED8\u8BA4\u4E0D\u9009\u62E9\uFF1B\u8BF7\u660E\u786E\u52FE\u9009\u8981\u5E94\u7528\u7684\u5EFA\u8BAE\uFF0C\u4E5F\u53EF\u4EE5\u6682\u4E0D\u91C7\u7EB3\u5E76\u7EE7\u7EED\u5F53\u524D\u6D41\u7A0B\u3002",
          onClose,
          feedbackContext: feedbackContextFor(item),
          width: "860px",
          footer: [
            h("button", { key: "close", style: phase === "report" ? button : primary, onClick: onClose }, phase === "adopted" ? "\u5173\u95ED" : phase === "report" ? "\u6682\u4E0D\u91C7\u7EB3\uFF0C\u7EE7\u7EED\u63A8\u8FDB" : "\u53D6\u6D88"),
            phase === "intro" || phase === "report" && !report ? h("button", { key: "generate", style: primary, onClick: generate }, "\u751F\u6210 AI \u4F18\u5316\u5EFA\u8BAE") : null,
            phase === "intro" && hasStored ? h("button", { key: "load", style: button, onClick: load }, "\u67E5\u770B\u5DF2\u6709\u5EFA\u8BAE") : null,
            phase === "report" ? h("button", { key: "adopt", style: primary, onClick: adopt, disabled: selected.length === 0 }, selected.length === 0 ? "\u91C7\u7EB3\u6240\u9009\u5EFA\u8BAE" : `\u91C7\u7EB3\u6240\u9009\u5EFA\u8BAE\uFF08${selected.length}\uFF09`) : null
          ]
        },
        phase === "loading" ? h("p", { style: muted }, "\u6B63\u5728\u8BFB\u53D6\u5DF2\u6709 AI \u4F18\u5316\u5EFA\u8BAE\u2026") : null,
        phase === "generating" ? h(
          "div",
          { style: { padding: "16px 0", color: T.text2, fontSize: "13px", lineHeight: 1.9 } },
          h("p", { style: { margin: 0 } }, "AI \u6B63\u5728\u9605\u8BFB\u9700\u6C42\u5E76\u751F\u6210\u4F18\u5316\u5EFA\u8BAE\uFF0C\u901A\u5E38\u9700\u8981 10\u201360 \u79D2\u2026"),
          h("p", { style: { margin: "4px 0 0", ...muted } }, "\u672C\u6B21\u8C03\u7528\u4F7F\u7528 DSH \u5F53\u524D\u9ED8\u8BA4\u6A21\u578B\uFF1B\u5EFA\u8BAE\u4F1A\u4FDD\u5B58\u5230 .alm/reviews/<REQ>.ai.json\u3002")
        ) : null,
        error ? h("p", { style: { margin: "10px 0 0", color: T.err, fontSize: "12.5px" } }, error) : null,
        phase === "intro" ? h(
          "div",
          { style: { padding: "10px 0", color: T.text2, fontSize: "13px", lineHeight: 1.9 } },
          h("p", { style: { margin: 0 } }, "\u8FD8\u6CA1\u6709 AI \u4F18\u5316\u5EFA\u8BAE\u3002\u751F\u6210\u540E\u53EF\u4EE5\u67E5\u770B\uFF1A"),
          h(
            "ul",
            { style: { margin: "6px 0 0", paddingLeft: "20px" } },
            h("li", null, "\u53EF\u53C2\u8003\u7684\u95EE\u9898\u4E0E\u98CE\u9669\u63D0\u793A"),
            h("li", null, "\u53EF\u6267\u884C\u7684\u4F18\u5316\u5EFA\u8BAE\uFF08\u9700\u660E\u786E\u52FE\u9009\u5E94\u7528\uFF09"),
            h("li", null, "\u5206\u6B65\u4F18\u5316\u65B9\u6848\u4E0E\u5EFA\u8BAE\u80CC\u666F")
          )
        ) : null,
        report ? h(
          "div",
          { style: { marginTop: "10px" } },
          h(
            "div",
            { style: { display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" } },
            h("span", { style: { borderRadius: "999px", padding: "2px 10px", fontSize: "11.5px", color: verdictMeta.color, background: verdictMeta.bg } }, report.verdict),
            h("b", { style: { fontSize: "13.5px", color: T.text, fontWeight: 500 } }, report.summary)
          ),
          h(
            "details",
            { style: { marginTop: "6px", ...muted } },
            h("summary", { style: { cursor: "pointer" } }, "\u5EFA\u8BAE\u6765\u6E90"),
            h("p", null, `${report.provider} \xB7 ${report.model} \xB7 ${formatLocalStamp(report.generatedAt)}`)
          ),
          h(
            "div",
            { style: { marginTop: "12px" } },
            h("div", { style: { fontSize: "11px", letterSpacing: ".08em", color: T.text3, marginBottom: "6px" } }, "\u95EE\u9898\u4E0E\u98CE\u9669\u63D0\u793A"),
            (report.findings ?? []).length ? report.findings.map(
              (finding) => h(
                "div",
                { key: finding.id, style: { borderLeft: `3px solid ${finding.severity === "block" ? T.err : finding.severity === "warn" ? T.warn : T.line2}`, background: T.layer2, borderRadius: "8px", padding: "7px 10px", marginBottom: "6px", fontSize: "12.5px", color: T.text2 } },
                h("b", { style: { color: T.text, fontWeight: 500 } }, `${finding.title} `),
                finding.detail,
                finding.ref ? h("span", { style: { ...muted, marginLeft: "6px" } }, `\uFF08${finding.ref}\uFF09`) : null
              )
            ) : h("p", { style: { margin: 0, ...muted } }, "\u6CA1\u6709\u989D\u5916\u95EE\u9898\u63D0\u793A\u3002")
          ),
          h(
            "div",
            { style: { marginTop: "12px" } },
            h("div", { style: { fontSize: "11px", letterSpacing: ".08em", color: T.text3, marginBottom: "6px" } }, "\u4F18\u5316\u5EFA\u8BAE\uFF08\u52FE\u9009\u540E\u5E94\u7528\uFF09"),
            (report.suggestions ?? []).map(
              (suggestion) => h(
                "label",
                { key: suggestion.id, style: { display: "flex", gap: "8px", alignItems: "flex-start", border: `1px solid ${T.line}`, borderRadius: "8px", padding: "8px 10px", marginBottom: "6px", fontSize: "12.5px", color: T.text2, cursor: "pointer" } },
                h("input", { type: "checkbox", name: `review-suggestion-${suggestion.id}`, "aria-label": `\u91C7\u7528\u4F18\u5316\u5EFA\u8BAE\uFF1A${suggestion.title}`, checked: selected.includes(suggestion.id), onChange: () => toggle(suggestion.id), style: { marginTop: "2px" } }),
                h(
                  "span",
                  null,
                  h("b", { style: { color: T.text, fontWeight: 500 } }, `[${suggestion.category}] ${suggestion.title}`),
                  h("span", { style: { display: "block", marginTop: "2px" } }, suggestion.detail),
                  suggestion.suggestedText ? h("code", { style: { display: "block", marginTop: "4px", color: T.text3, fontSize: "11.5px", whiteSpace: "pre-wrap" } }, suggestion.suggestedText) : null
                )
              )
            )
          ),
          (report.plan ?? []).length ? h(
            "details",
            { style: { marginTop: "12px" } },
            h("summary", { style: { cursor: "pointer", fontSize: "12px", color: T.text2, marginBottom: "6px" } }, "\u67E5\u770B\u5EFA\u8BAE\u65B9\u6848"),
            h(
              "ol",
              { style: { margin: 0, paddingLeft: "20px", fontSize: "12.5px", color: T.text2, lineHeight: 1.9 } },
              report.plan.map((entry, index) => h("li", { key: `${entry.step}-${index}` }, h("b", { style: { color: T.text, fontWeight: 500 } }, entry.step), `\uFF1A${entry.detail}`))
            )
          ) : null,
          report.proposedBrief ? h(
            "details",
            { style: { marginTop: "12px" } },
            h("summary", { style: { cursor: "pointer", fontSize: "12px", color: T.text2, marginBottom: "6px" } }, "\u67E5\u770B\u5EFA\u8BAE\u80CC\u666F\uFF08\u975E\u5DF2\u786E\u8BA4\u9700\u6C42\uFF09"),
            h("pre", { style: { margin: 0, padding: "10px", maxHeight: "160px", overflow: "auto", background: T.layer, border: `1px solid ${T.line}`, borderRadius: "8px", fontSize: "11.5px", lineHeight: 1.8, whiteSpace: "pre-wrap" } }, report.proposedBrief),
            h("p", { style: { margin: "6px 0 0", ...muted } }, "\u5EFA\u8BAE\u80CC\u666F\u53EA\u4FDD\u5B58\u5728\u8BC4\u5BA1\u62A5\u544A\u4E2D\uFF0C\u4E0D\u6574\u6BB5\u5199\u5165\u9700\u6C42 brief\uFF0C\u907F\u514D\u91CD\u590D\u81A8\u80C0\u3002")
          ) : null,
          phase === "adopted" ? h(
            "div",
            { style: { margin: "12px 0 0", fontSize: "12.5px", color: T.ok, lineHeight: 1.9 } },
            h("p", { style: { margin: 0 } }, `\u5DF2\u5E94\u7528 ${adopted?.suggestionIds?.length ?? selected.length} \u6761\u5EFA\u8BAE\uFF1Bbrief \u7684\u300CAI \u4F18\u5316\u5EFA\u8BAE\u300D\u5DF2\u66F4\u65B0\uFF08\u4E0D\u4F1A\u91CD\u590D\u8FFD\u52A0\uFF09\u3002`),
            h("p", { style: { margin: "2px 0 0", color: T.text2 } }, "\u8FD9\u53EA\u66F4\u65B0\u9700\u6C42\u6B63\u6587\uFF0C\u4E0D\u4EE3\u8868\u8BC4\u5BA1\u901A\u8FC7\u3001\u4EBA\u5DE5\u9A8C\u6536\u6216\u53D1\u5E03\u6388\u6743\u3002")
          ) : null
        ) : null
      );
    }
    class ModalBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }
      static getDerivedStateFromError(error) {
        return { error };
      }
      componentDidCatch(error, info) {
        try {
          console.error("[requirements] modal render failed", error, info?.componentStack);
        } catch {
        }
      }
      render() {
        if (!this.state.error) return this.props.children;
        return h(
          "div",
          {
            role: "alert",
            style: {
              position: "fixed",
              inset: 0,
              zIndex: 70,
              background: "rgba(4,6,9,.62)",
              backdropFilter: "blur(6px)",
              display: "grid",
              placeItems: "center",
              padding: "24px"
            }
          },
          h(
            "div",
            { style: { width: "560px", maxWidth: "92vw", background: T.base, border: `1px solid ${T.line2}`, borderRadius: "16px", padding: "22px 24px" } },
            h("h3", { style: { margin: 0, fontSize: "16px" } }, "\u9762\u677F\u6CA1\u6709\u6B63\u5E38\u6253\u5F00"),
            h(
              "p",
              { style: { margin: "8px 0 0", color: T.text2, fontSize: "13px", lineHeight: 1.75 } },
              `\u9519\u8BEF\uFF1A${this.state.error?.message ?? "\u672A\u77E5\u9519\u8BEF"}\u3002\u5173\u95ED\u540E\u53EF\u91CD\u8BD5\uFF1B\u5982\u679C\u6301\u7EED\u51FA\u73B0\uFF0C\u8BF7\u5237\u65B0\u9875\u9762\u3002`
            ),
            h(
              "div",
              { style: { display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "8px", marginTop: "16px" } },
              layerFeedbackButton({ label: "\u9762\u677F\u6CA1\u6709\u6B63\u5E38\u6253\u5F00", context: { recentError: this.state.error?.message ?? null } }),
              h("button", { style: { ...button }, onClick: this.props.onClose }, "\u5173\u95ED")
            )
          )
        );
      }
    }
    function RehearsalModal({ item, root, onClose, onDone }) {
      const original = {
        title: item.title ?? "",
        priority: item.priority ?? "P1",
        brief: item.briefText ?? ""
      };
      const [draft, setDraft] = useState(original);
      const [state, setState] = useState({ loading: false, preview: null, result: null, error: null, stale: false });
      const [idempotencyKey] = useState(() => `ui-rehearsal-${item.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
      const changes = () => REHEARSAL_FIELDS.map(([field]) => ({ field, value: draft[field] ?? "" })).filter(
        (entry) => String(entry.value) !== String(original[entry.field] ?? "")
      );
      const fieldLabel = (key) => (REHEARSAL_FIELDS.find(([id]) => id === key) ?? [key, key])[1];
      const edit = (field, value) => {
        setDraft((current) => ({ ...current, [field]: value }));
        setState((current) => ({ ...current, preview: null, result: null, error: null, stale: false }));
      };
      const preview = () => {
        const list = changes();
        if (list.length === 0) {
          setState({ loading: false, preview: null, result: null, error: "\u8FD8\u6CA1\u6709\u6539\u52A8\uFF1A\u5148\u4FEE\u6539\u6807\u9898\u3001\u4F18\u5148\u7EA7\u6216\u80CC\u666F\uFF0C\u518D\u9884\u89C8\u5F71\u54CD\u9762\u3002", stale: false });
          return;
        }
        setState({ loading: true, preview: null, result: null, error: null, stale: false });
        writeJson("rehearsal", { requirementId: item.id, changes: list }, root).then((next) => setState({ loading: false, preview: next, result: null, error: null, stale: false })).catch((error) => setState({ loading: false, preview: null, result: null, error: error.message, stale: false }));
      };
      const submit = () => {
        const current = state.preview;
        if (!current || state.loading) return;
        const list = changes();
        setState((previous) => ({ ...previous, loading: true, result: null, error: null, stale: false }));
        writeJson(
          "rehearsal",
          { requirementId: item.id, changes: list, apply: true, expectedBaseline: current.baseline, actor: "human:local", idempotencyKey },
          root
        ).then((result2) => {
          setState({ loading: false, preview: null, result: result2, error: null, stale: false });
          onDone?.();
        }).catch((error) => {
          const stale = error.code === "stale-preview" || String(error.message ?? "").includes("stale-preview");
          if (!stale) {
            setState((previous) => ({ ...previous, loading: false, error: error.message, stale: false }));
            return;
          }
          setState((previous) => ({ ...previous, loading: false, error: null, stale: true }));
          writeJson("rehearsal", { requirementId: item.id, changes: list }, root).then((next) => setState((previous) => ({ ...previous, loading: false, preview: next, error: null, stale: true }))).catch((nextError) => setState((previous) => ({ ...previous, loading: false, error: nextError.message, stale: true })));
        });
      };
      const previewData = state.preview;
      const result = state.result;
      const previewChanges = previewData ? previewData.changes ?? (previewData.change ? [previewData.change] : []) : [];
      const editedLabels = changes().map((entry) => fieldLabel(entry.field));
      const hasChanges = editedLabels.length > 0;
      const nodeLabel = (node) => {
        if (!node) return "\u2014";
        if (typeof node === "string") return node;
        return `${node.id ?? node.title ?? node.assetId ?? "\u2014"}${node.title && node.id ? ` \xB7 ${node.title}` : ""}`;
      };
      const groups = [
        ["reverify", "\u9700\u91CD\u9A8C"],
        ["reconfirm", "\u9700\u91CD\u65B0\u786E\u8BA4"],
        ["reference", "\u4EC5\u53C2\u8003"]
      ];
      const fieldInput = (field) => {
        if (field === "priority") {
          return h(
            "select",
            { style: input, value: draft.priority, onChange: (event) => edit("priority", event.target.value) },
            ["P0", "P1", "P2", "P3"].map((priority) => h("option", { key: priority, value: priority }, priority))
          );
        }
        if (field === "brief") {
          return h("textarea", {
            name: `rehearsal-${field}`,
            autoComplete: "off",
            "aria-label": `\u53D8\u66F4\u8BD5\u6F14 ${field}`,
            style: { ...input, width: "100%", minHeight: "150px", resize: "vertical", fontFamily: "inherit", lineHeight: 1.7 },
            value: draft.brief,
            onChange: (event) => edit("brief", event.target.value)
          });
        }
        return h("input", { name: `rehearsal-${field}`, autoComplete: "off", "aria-label": `\u53D8\u66F4\u8BD5\u6F14 ${field}`, style: input, value: draft.title, autoFocus: field === "title", onChange: (event) => edit("title", event.target.value) });
      };
      return h(
        ModalShell,
        {
          title: `\u53D8\u66F4\u8BD5\u6F14 \xB7 ${item.id}`,
          lead: "\u4E00\u6B21\u53EF\u6539\u6807\u9898\u3001\u4F18\u5148\u7EA7\u3001\u80CC\u666F\uFF1B\u53EA\u63D0\u4EA4\u6709\u6539\u52A8\u7684\u5B57\u6BB5\u3002\u8BD5\u6F14\u4E0D\u5199\u6587\u4EF6\uFF0C\u786E\u8BA4\u63D0\u4EA4\u643A\u5E26\u5F53\u524D baseline \u505A CAS \u5E76\u5199\u5BA1\u8BA1\u8BB0\u5F55\u3002",
          onClose,
          feedbackContext: feedbackContextFor(item),
          width: "860px",
          footer: [
            h("button", { key: "close", style: result ? primary : button, onClick: onClose }, result ? "\u5173\u95ED" : "\u53D6\u6D88"),
            result ? null : h(
              "span",
              { key: "hint", style: { marginRight: "auto", fontSize: "12px", color: hasChanges ? T.ok : T.text3 } },
              hasChanges ? `\u5C06\u63D0\u4EA4\uFF1A${editedLabels.join("\u3001")}` : "\u5148\u4FEE\u6539\u4EFB\u4E00\u5B57\u6BB5\uFF0C\u518D\u9884\u89C8\u5F71\u54CD\u9762"
            ),
            result ? null : h("button", { key: "preview", style: { ...button, opacity: state.loading ? 0.5 : 1 }, onClick: preview, disabled: state.loading }, state.loading ? "\u5904\u7406\u4E2D\u2026" : "\u9884\u89C8\u5F71\u54CD\u9762"),
            previewData && !result ? h("button", { key: "submit", style: primary, onClick: submit, disabled: state.loading }, "\u786E\u8BA4\u63D0\u4EA4") : null
          ]
        },
        h(
          "div",
          { style: { marginTop: "14px", border: `1px solid ${T.line}`, borderRadius: "10px", padding: "12px" } },
          h(
            "div",
            { style: { display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "baseline", flexWrap: "wrap" } },
            h("div", { style: { fontSize: "11px", letterSpacing: ".08em", textTransform: "uppercase", color: T.text3 } }, "\u53EF\u4FEE\u6539\u5B57\u6BB5"),
            h("span", { style: { fontSize: "12px", color: hasChanges ? T.ok : T.text3 } }, hasChanges ? `\u5C06\u63D0\u4EA4\uFF1A${editedLabels.join("\u3001")}` : "\u5C1A\u672A\u4FEE\u6539")
          ),
          REHEARSAL_FIELDS.map(
            ([field, label]) => h(
              "label",
              { key: field, style: { display: "flex", flexDirection: "column", gap: "4px", marginTop: "10px", fontSize: "12px", color: T.text2 } },
              h("span", null, label, h("span", { style: { ...muted, marginLeft: "8px" } }, String(draft[field] ?? "") === String(original[field] ?? "") ? "\u672A\u4FEE\u6539" : "\u5DF2\u4FEE\u6539")),
              fieldInput(field)
            )
          )
        ),
        state.stale ? h("p", { style: { margin: "10px 0 0", color: T.warn, fontSize: "12.5px", lineHeight: 1.8 } }, "\u5DF2\u88AB\u4ED6\u4EBA\u4FEE\u6539\uFF0C\u5DF2\u91CD\u65B0\u8BA1\u7B97\uFF0C\u8BF7\u786E\u8BA4\u3002") : null,
        state.loading ? h("p", { style: { margin: "10px 0 0", ...muted } }, "\u6B63\u5728\u8BFB\u53D6\u5F71\u54CD\u9762\u2026") : null,
        state.error ? h("p", { style: { margin: "10px 0 0", color: T.err, fontSize: "12.5px" } }, state.error) : null,
        result ? h(
          "div",
          { style: { marginTop: "14px" } },
          h("p", { style: { color: T.text, fontSize: "13px" } }, result.applied === false ? "\u672A\u63D0\u4EA4\u53D8\u66F4\u3002" : "\u53D8\u66F4\u5DF2\u63D0\u4EA4\u3002"),
          h("details", null, h("summary", { style: { cursor: "pointer", color: T.text2, fontSize: "12px" } }, "\u67E5\u770B\u63D0\u4EA4\u8BB0\u5F55"), h(PlanRows, {
            rows: [
              ["\u72B6\u6001", result.applied === false ? "\u672A\u63D0\u4EA4" : "\u5DF2\u63D0\u4EA4"],
              ["\u4FEE\u8BA2", result.revision ? `v${result.revision}` : "\u2014"],
              ["\u53D8\u66F4", (result.changes ?? []).map((entry) => fieldLabel(entry.field)).join("\u3001") || "\u2014"],
              ["\u6587\u4EF6", result.file ?? "\u2014"],
              ["\u5BA1\u8BA1", result.auditFile ?? "\u2014"]
            ]
          })),
          result.applied !== false ? h("p", { style: { margin: "8px 0 0", color: T.warn, fontSize: "12px" } }, "\u5185\u5BB9\u5DF2\u53D8\u66F4\uFF0C\u65E7\u8BC4\u5BA1\u4E0E\u9A8C\u6536\u8BC1\u636E\u4E0D\u518D\u9002\u7528\uFF0C\u9700\u8981\u91CD\u65B0\u68C0\u67E5\u3002") : null
        ) : null,
        previewData ? h(
          "div",
          { style: { marginTop: "14px" } },
          h("p", { style: { fontSize: "13px", color: T.text } }, `\u5C06\u4FEE\u6539\uFF1A${previewChanges.map((entry) => fieldLabel(entry.field)).join("\u3001")}`),
          h(
            "details",
            { style: { marginTop: "8px" } },
            h("summary", { style: { cursor: "pointer", fontSize: "12px", color: T.text2 } }, "\u67E5\u770B\u53D8\u66F4\u57FA\u7EBF"),
            h(PlanRows, { rows: [
              ["\u9700\u6C42", item.id],
              ["\u57FA\u7EBF\u5185\u5BB9\u54C8\u5E0C", shortHash(previewData.baseline?.contentHash)],
              ["\u57FA\u7EBF\u5173\u7CFB\u5FEB\u7167", shortHash(previewData.baseline?.relationHash)],
              ["\u57FA\u7EBF\u63D0\u4EA4", shortHash(previewData.baseline?.headSha, 8)],
              ["\u57FA\u7EBF\u4FEE\u8BA2", `v${previewData.baseline?.revision ?? item.revision ?? 1}`]
            ] })
          ),
          previewChanges.map(
            (entry) => h(
              "div",
              { key: entry.field, style: { marginTop: "10px" } },
              h("div", { style: { fontSize: "11px", letterSpacing: ".08em", textTransform: "uppercase", color: T.text3, marginBottom: "5px" } }, fieldLabel(entry.field)),
              h(
                "div",
                { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "10px" } },
                h(
                  "div",
                  { style: { border: `1px solid ${T.line}`, borderRadius: "10px", padding: "10px 12px", background: T.layer } },
                  h("div", { style: { fontSize: "11px", color: T.text3, marginBottom: "4px" } }, "\u53D8\u66F4\u524D"),
                  h("div", { style: { fontSize: "12.5px", color: T.text2, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: entry.field === "brief" ? "180px" : "none", overflow: entry.field === "brief" ? "auto" : "visible" } }, entry.before || "\uFF08\u7A7A\uFF09")
                ),
                h(
                  "div",
                  { style: { border: `1px solid ${T.line}`, borderLeft: `3px solid ${T.brand}`, borderRadius: "10px", padding: "10px 12px" } },
                  h("div", { style: { fontSize: "11px", color: T.text3, marginBottom: "4px" } }, "\u53D8\u66F4\u540E"),
                  h("div", { style: { fontSize: "12.5px", color: T.text, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: entry.field === "brief" ? "180px" : "none", overflow: entry.field === "brief" ? "auto" : "visible" } }, entry.after || "\uFF08\u7A7A\uFF09")
                )
              )
            )
          ),
          h(
            "div",
            { style: { marginTop: "12px" } },
            h("div", { style: { fontSize: "11px", letterSpacing: ".08em", textTransform: "uppercase", color: T.text3 } }, "\u5F71\u54CD\u5206\u7EC4\uFF08\u63D0\u793A\uFF0C\u4E0D\u662F\u963B\u585E\uFF09"),
            groups.map(([key, label]) => {
              const nodes = previewData.impact?.groups?.[key] ?? [];
              return h(
                "div",
                { key, style: { marginTop: "6px", fontSize: "12px", color: T.text2 } },
                h("span", { style: { color: T.text3, marginRight: "6px" } }, `${label} ${nodes.length}`),
                nodes.length ? h("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "4px" } }, nodes.map((node, index) => h(MetaChip, { key: `${key}-${index}` }, nodeLabel(node)))) : h("span", { style: muted }, "\u65E0")
              );
            })
          ),
          previewData.impact?.paths?.length ? h(
            "details",
            { style: { marginTop: "10px", borderTop: `1px solid ${T.line}`, paddingTop: "8px" } },
            h("summary", { style: { cursor: "pointer", fontSize: "12px", color: T.text2 } }, `\u5F71\u54CD\u8DEF\u5F84\uFF08${previewData.impact.paths.length}\uFF09`),
            h(
              "div",
              { style: { marginTop: "6px", fontSize: "11.5px", color: T.text2, lineHeight: 1.8 } },
              previewData.impact.paths.map(
                (path, index) => h(
                  "div",
                  { key: index },
                  `${path.to} \xB7 \u6DF1\u5EA6 ${path.depth}`,
                  path.relations?.length ? h("span", { style: { color: T.text3 } }, ` \xB7 ${path.relations.map((relation) => `${relation.from}\u2192${relation.type}\u2192${relation.to}`).join(" / ")}`) : null
                )
              )
            )
          ) : null,
          previewData.impact?.blindSpots?.length ? h(
            "div",
            { style: { marginTop: "10px", border: `1px solid ${T.line}`, borderRadius: "10px", padding: "8px 12px" } },
            h("div", { style: { color: T.warn, fontSize: "12px", marginBottom: "3px" } }, "\u76F2\u533A\uFF1A\u672A\u767B\u8BB0\u5F71\u54CD\u4E0D\u7B49\u4E8E\u65E0\u5F71\u54CD"),
            previewData.impact.blindSpots.map(
              (spot, index) => h(
                "div",
                { key: index, style: { fontSize: "12px", color: T.text2, lineHeight: 1.8 } },
                `${spot.kind === "no-relations" ? "\u672A\u767B\u8BB0\u5173\u7CFB" : spot.kind === "unresolved-target" ? "\u76EE\u6807\u8D44\u4EA7\u7F3A\u5931" : "\u672A\u77E5\u5173\u7CFB\u7C7B\u578B"}\uFF1A${spot.detail}`
              )
            )
          ) : null,
          previewData.impact?.coverage ? h("p", { style: { margin: "8px 0 0", ...muted } }, `\u626B\u63CF\u5173\u7CFB ${previewData.impact.coverage.relations ?? 0} \xB7 \u5DF2\u63A2\u7D22 ${previewData.impact.coverage.explored ?? 0} \xB7 \u6DF1\u5EA6\u4E0A\u9650 ${previewData.impact.coverage.maxDepth ?? 4}${previewData.impact.coverage.truncated ? " \xB7 \u5DF2\u622A\u65AD" : ""}`) : null,
          h("p", { style: { margin: "8px 0 0", ...muted } }, "\u5F71\u54CD\u662F\u63D0\u793A\uFF0C\u4E0D\u662F\u963B\u585E\uFF1B\u786E\u8BA4\u63D0\u4EA4\u524D\u8BF7\u4EBA\u5DE5\u5224\u65AD\u3002")
        ) : null
      );
    }
    function ArchiveModal({ item, root, onClose, onDone }) {
      const [reason, setReason] = useState("");
      const [idempotencyKey] = useState(() => `ui-archive-${item.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
      const [state, setState] = useState({ loading: true, preview: null, result: null, error: null, stale: false });
      const load = useCallback(() => {
        setState({ loading: true, preview: null, result: null, error: null, stale: false });
        writeJson("archive", { requirementId: item.id, file: item.file }, root).then((preview2) => setState({ loading: false, preview: preview2, result: null, error: null, stale: false })).catch((error) => setState({ loading: false, preview: null, result: null, error: error.message, stale: false }));
      }, [item.id, root]);
      useEffect(() => {
        load();
      }, [load]);
      const submit = () => {
        const preview2 = state.preview;
        if (!preview2 || state.loading) return;
        setState((current) => ({ ...current, loading: true, result: null, error: null, stale: false }));
        writeJson(
          "archive",
          {
            requirementId: item.id,
            file: item.file,
            apply: true,
            expectedBaseline: preview2.baseline,
            actor: "human:local",
            reason,
            idempotencyKey
          },
          root
        ).then((result2) => {
          setState({ loading: false, preview: null, result: result2, error: null, stale: false });
        }).catch((error) => {
          if (error.code !== "stale-preview") {
            setState((current) => ({ ...current, loading: false, error: error.message }));
            return;
          }
          setState((current) => ({ ...current, loading: false, error: null, stale: true }));
          writeJson("archive", { requirementId: item.id, file: item.file }, root).then((next) => setState((current) => ({ ...current, loading: false, preview: next, error: null, stale: true }))).catch((nextError) => setState((current) => ({ ...current, loading: false, error: nextError.message, stale: true })));
        });
      };
      const preview = state.preview;
      const result = state.result;
      const close = () => {
        if (result) onDone?.();
        else onClose();
      };
      return h(
        ModalShell,
        {
          title: `\u5173\u95ED\u5F52\u6863 \xB7 ${item.id}`,
          lead: "\u8FD9\u6761\u9700\u6C42\u5C06\u9000\u51FA\u6D3B\u8DC3\u6D41\u7A0B\uFF0C\u4F46\u539F\u6587\u3001\u8BC1\u636E\u548C\u5386\u53F2\u4ECD\u4FDD\u7559\u3002\u786E\u8BA4\u4E0D\u518D\u63A8\u8FDB\u540E\u518D\u5F52\u6863\u3002",
          onClose: close,
          feedbackContext: feedbackContextFor(item),
          width: "620px",
          footer: [
            h("button", { key: "close", style: result ? primary : button, onClick: close }, result ? "\u5173\u95ED" : "\u53D6\u6D88"),
            result ? null : h("button", { key: "submit", style: primary, onClick: submit, disabled: state.loading || !preview }, state.loading ? "\u5F52\u6863\u4E2D\u2026" : "\u786E\u8BA4\u5173\u95ED\u5F52\u6863")
          ]
        },
        state.loading ? h("p", { style: { margin: "10px 0 0", ...muted } }, "\u6B63\u5728\u68C0\u67E5\u72B6\u6001\u4E0E\u57FA\u7EBF\u2026") : null,
        state.error ? h("p", { role: "alert", style: { margin: "10px 0 0", color: T.err, fontSize: "12.5px", lineHeight: 1.8 } }, state.error) : null,
        state.stale ? h("p", { style: { margin: "10px 0 0", color: T.warn, fontSize: "12.5px" } }, "\u9700\u6C42\u521A\u521A\u53D1\u751F\u53D8\u5316\uFF0C\u5DF2\u91CD\u65B0\u8BA1\u7B97\uFF0C\u8BF7\u518D\u6B21\u786E\u8BA4\u3002") : null,
        preview ? h(
          "div",
          { style: { marginTop: "14px" } },
          h(PlanRows, {
            rows: [
              ["\u9700\u6C42", `${item.title} \xB7 ${item.id}`],
              ["\u72B6\u6001", `${preview.status.from} \u2192 ${preview.status.to}\uFF08\u5DF2\u5F52\u6863\uFF09`],
              ["\u4FEE\u8BA2", `v${preview.baseline?.revision ?? item.revision ?? 1} \u2192 v${preview.revision}`],
              ["\u6587\u4EF6", preview.file ?? "\u2014"],
              ["\u5F71\u54CD", "\u8BC4\u5BA1\u3001\u9A8C\u6536\u8BC1\u636E\u4E0E GitHub \u5F52\u5C5E\u4FDD\u7559\uFF1B\u8BB0\u5F55\u79FB\u51FA\u6D3B\u8DC3\u5217\u8868"]
            ]
          }),
          h(
            "label",
            { style: { display: "flex", flexDirection: "column", gap: "5px", marginTop: "12px", fontSize: "12px", color: T.text2 } },
            h("span", null, "\u5173\u95ED\u539F\u56E0\uFF08\u53EF\u9009\uFF09"),
            h("textarea", {
              name: "archive-reason",
              autoComplete: "off",
              "aria-label": "\u5173\u95ED\u539F\u56E0\uFF08\u53EF\u9009\uFF09",
              value: reason,
              onChange: (event) => setReason(event.target.value),
              placeholder: "\u4F8B\u5982\uFF1A\u4E1A\u52A1\u8C03\u6574\uFF0C\u672C\u671F\u4E0D\u5F00\u53D1\uFF1B\u6216\u5DF2\u88AB\u5176\u4ED6\u65B9\u6848\u8986\u76D6\u3002",
              maxLength: 500,
              style: { ...input, width: "100%", minHeight: "76px", resize: "vertical", fontFamily: "inherit", lineHeight: 1.7 }
            })
          )
        ) : null,
        result ? h(
          "div",
          { style: { marginTop: "14px" } },
          h("details", null, h("summary", { style: { cursor: "pointer", color: T.text2, fontSize: "12px" } }, "\u67E5\u770B\u5F52\u6863\u8BB0\u5F55"), h(PlanRows, {
            rows: [
              ["\u72B6\u6001", "\u5DF2\u5F52\u6863"],
              ["\u4FEE\u8BA2", result.revision ? `v${result.revision}` : "\u2014"],
              ["\u6587\u4EF6", result.file ?? "\u2014"],
              ["\u5BA1\u8BA1", result.auditFile ?? "\u2014"]
            ]
          })),
          h(
            "p",
            { style: { margin: "8px 0 0", color: T.ok, fontSize: "12.5px" } },
            result.alreadyArchived ? "\u8BE5\u9700\u6C42\u5DF2\u5728\u4E4B\u524D\u5B8C\u6210\u5F52\u6863\uFF0C\u672C\u6B21\u8BF7\u6C42\u672A\u91CD\u590D\u5199\u5165\u3002" : "\u5DF2\u5173\u95ED\u5F52\u6863\uFF1B\u8BE5\u9700\u6C42\u4E0D\u518D\u51FA\u73B0\u5728\u6D3B\u8DC3\u7B5B\u9009\u4E2D\u3002"
          )
        ) : null
      );
    }
    function RemoveModal({ item, root, onClose, onDone }) {
      const [reason, setReason] = useState("");
      const [confirmed, setConfirmed] = useState(false);
      const [idempotencyKey] = useState(() => `ui-remove-${item.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
      const [state, setState] = useState({ loading: true, preview: null, result: null, error: null, stale: false });
      const load = useCallback(() => {
        setState({ loading: true, preview: null, result: null, error: null, stale: false });
        writeJson("remove", { requirementId: item.id, file: item.file }, root).then((preview2) => setState({ loading: false, preview: preview2, result: null, error: null, stale: false })).catch((error) => setState({ loading: false, preview: null, result: null, error: error.message, stale: false }));
      }, [item.id, item.file, root]);
      useEffect(() => {
        load();
      }, [load]);
      const submit = () => {
        const preview2 = state.preview;
        if (!preview2 || state.loading || !confirmed) return;
        setState((current) => ({ ...current, loading: true, result: null, error: null, stale: false }));
        writeJson(
          "remove",
          {
            requirementId: item.id,
            file: item.file,
            apply: true,
            expectedBaseline: preview2.baseline,
            actor: "human:local",
            reason,
            idempotencyKey
          },
          root
        ).then((result2) => setState({ loading: false, preview: null, result: result2, error: null, stale: false })).catch((error) => {
          if (error.code !== "stale-preview") {
            setState((current) => ({ ...current, loading: false, error: error.message }));
            return;
          }
          setState((current) => ({ ...current, loading: false, error: null, stale: true }));
          setConfirmed(false);
          writeJson("remove", { requirementId: item.id, file: item.file }, root).then((next) => setState((current) => ({ ...current, loading: false, preview: next, error: null, stale: true }))).catch((nextError) => setState((current) => ({ ...current, loading: false, error: nextError.message, stale: true })));
        });
      };
      const preview = state.preview;
      const result = state.result;
      const close = () => {
        if (result) onDone?.();
        else onClose();
      };
      return h(
        ModalShell,
        {
          title: `\u5220\u9664\u9700\u6C42 \xB7 ${item.id}`,
          lead: "\u8FD9\u6761\u8BB0\u5F55\u5C06\u4ECE\u4ED3\u5E93\u548C\u6240\u6709\u5217\u8868\u79FB\u9664\u3002\u539F\u6587\u4F1A\u7559\u5728\u5BA1\u8BA1\u4E2D\uFF0C\u4F46\u4E0D\u4F1A\u81EA\u52A8\u6062\u590D\u3002\u8BF7\u6838\u5BF9\u5220\u9664\u8303\u56F4\u5E76\u660E\u786E\u786E\u8BA4\u3002",
          onClose: close,
          feedbackContext: feedbackContextFor(item),
          width: "620px",
          footer: [
            h("button", { key: "close", style: result ? primary : button, onClick: close }, result ? "\u5173\u95ED" : "\u53D6\u6D88"),
            result ? null : h("button", { key: "submit", style: { ...primary, background: T.err, borderColor: T.err }, onClick: submit, disabled: state.loading || !preview || !confirmed }, state.loading ? "\u5220\u9664\u4E2D\u2026" : "\u786E\u8BA4\u5220\u9664")
          ]
        },
        state.loading ? h("p", { style: { margin: "10px 0 0", ...muted } }, "\u6B63\u5728\u68C0\u67E5\u72B6\u6001\u4E0E\u57FA\u7EBF\u2026") : null,
        state.error ? h("p", { role: "alert", style: { margin: "10px 0 0", color: T.err, fontSize: "12.5px", lineHeight: 1.8 } }, state.error) : null,
        state.stale ? h("p", { style: { margin: "10px 0 0", color: T.warn, fontSize: "12.5px" } }, "\u9700\u6C42\u521A\u521A\u53D1\u751F\u53D8\u5316\uFF0C\u5DF2\u91CD\u65B0\u8BA1\u7B97\uFF0C\u8BF7\u518D\u6B21\u786E\u8BA4\u3002") : null,
        preview ? h(
          "div",
          { style: { marginTop: "14px" } },
          h(PlanRows, {
            rows: [
              ["\u9700\u6C42", `${item.title} \xB7 ${item.id}`],
              ["\u6587\u4EF6", preview.file ?? "\u2014"],
              ["\u65B9\u5F0F", preview.mode === "block" ? "\u4ECE\u5171\u4EAB sdoc \u4E2D\u5220\u9664\u8BE5\u8BB0\u5F55\u5757\uFF0C\u4FDD\u7559\u540C\u6587\u4EF6\u5176\u4ED6\u9700\u6C42" : "\u5220\u9664\u6574\u4E2A\u9700\u6C42\u6587\u4EF6"],
              ["\u4FEE\u8BA2", `v${preview.baseline?.revision ?? item.revision ?? 1}`],
              ["\u53EF\u6062\u590D", "\u5BA1\u8BA1\u4E2D\u4FDD\u5B58\u5220\u9664\u524D\u5168\u6587\u4E0E\u57FA\u7EBF"]
            ]
          }),
          h(
            "label",
            { style: { display: "flex", gap: "7px", alignItems: "flex-start", marginTop: "12px", fontSize: "12px", color: T.text2, cursor: "pointer" } },
            h("input", { type: "checkbox", name: "delete-confirmed", "aria-label": "\u786E\u8BA4\u5220\u9664\u8BE5\u9700\u6C42\u8BB0\u5F55", checked: confirmed, onChange: (event) => setConfirmed(event.target.checked), style: { marginTop: "2px" } }),
            h("span", null, "\u6211\u77E5\u9053\u5220\u9664\u540E\u8BE5\u8BB0\u5F55\u4E0D\u518D\u51FA\u73B0\u5728\u5217\u8868\u4E2D\uFF1B\u9700\u8981\u65F6\u4ECE\u5BA1\u8BA1\u6062\u590D\u3002")
          ),
          h(
            "label",
            { style: { display: "flex", flexDirection: "column", gap: "5px", marginTop: "10px", fontSize: "12px", color: T.text2 } },
            h("span", null, "\u5220\u9664\u539F\u56E0\uFF08\u53EF\u9009\uFF09"),
            h("textarea", {
              name: "delete-reason",
              autoComplete: "off",
              "aria-label": "\u5220\u9664\u539F\u56E0\uFF08\u53EF\u9009\uFF09",
              value: reason,
              onChange: (event) => setReason(event.target.value),
              placeholder: "\u4F8B\u5982\uFF1A\u6D4B\u8BD5\u6570\u636E\u6E05\u7406\uFF1B\u6216\u8FD9\u6761\u8BB0\u5F55\u5DF2\u5408\u5E76\u5230\u5176\u4ED6\u9700\u6C42\u3002",
              maxLength: 500,
              style: { ...input, width: "100%", minHeight: "66px", resize: "vertical", fontFamily: "inherit", lineHeight: 1.7 }
            })
          )
        ) : null,
        result ? h(
          "div",
          { style: { marginTop: "14px" } },
          h("details", null, h("summary", { style: { cursor: "pointer", color: T.text2, fontSize: "12px" } }, "\u67E5\u770B\u5220\u9664\u8BB0\u5F55"), h(PlanRows, {
            rows: [
              ["\u7ED3\u679C", result.alreadyRemoved ? "\u5DF2\u5220\u9664\uFF08\u6B64\u524D\u5DF2\u5B8C\u6210\uFF09" : "\u5DF2\u5220\u9664"],
              ["\u6587\u4EF6", result.file ?? "\u2014"],
              ["\u65B9\u5F0F", result.mode === "block" ? "\u5220\u9664\u8BB0\u5F55\u5757" : "\u5220\u9664\u6587\u4EF6"],
              ["\u5BA1\u8BA1", result.auditFile ?? "\u2014"],
              ["\u65F6\u95F4", result.removedAt ?? "\u2014"]
            ]
          })),
          h("p", { style: { margin: "8px 0 0", color: T.ok, fontSize: "12.5px" } }, result.alreadyRemoved ? "\u8BE5\u9700\u6C42\u6B64\u524D\u5DF2\u5220\u9664\uFF0C\u672C\u6B21\u8BF7\u6C42\u672A\u91CD\u590D\u5199\u5165\u3002" : "\u8BB0\u5F55\u5DF2\u4ECE\u4ED3\u5E93\u79FB\u9664\uFF1B\u9700\u8981\u6062\u590D\u65F6\u4ECE\u5BA1\u8BA1\u6587\u4EF6\u627E\u56DE\u539F\u6587\u3002")
        ) : null
      );
    }
    const INTENT_ROUTE_LIST = [
      ["create", "\u65B0\u5EFA\u9700\u6C42\u8349\u7A3F", "\u628A\u8FD9\u6B21\u6539\u52A8\u5199\u6210\u4E00\u4EFD\u65B0\u7684\u9700\u6C42\u8349\u6848"],
      ["change", "\u53D8\u66F4\u5DF2\u6709\u9700\u6C42", "\u4FEE\u6539\u5DF2\u5B58\u5728\u627F\u8BFA\uFF0C\u4FDD\u7559\u4FEE\u8BA2\u5386\u53F2"],
      ["reuse", "\u5DF2\u88AB\u8986\u76D6", "\u73B0\u6709\u627F\u8BFA\u5DF2\u7ECF\u8986\u76D6\uFF0C\u4E0D\u5FC5\u65B0\u5199"],
      ["investigate", "\u5148\u8C03\u67E5", "\u8BC1\u636E\u4E0D\u8DB3\uFF0C\u5148\u8C03\u67E5\u518D\u51B3\u5B9A"],
      ["decline", "\u5EFA\u8BAE\u6682\u7F13\u6216\u4E0D\u505A", "\u5F53\u524D\u4E0D\u5EFA\u8BAE\u505A\uFF0C\u8BB0\u4E0B\u7406\u7531"],
      ["answer", "\u76F4\u63A5\u7B54\u7591", "\u53EA\u662F\u95EE\u9898\uFF0C\u4E0D\u6539\u52A8\u8D44\u4EA7"]
    ];
    const INTENT_ROUTE_LABELS = INTENT_ROUTE_LIST.reduce((acc, entry) => {
      acc[entry[0]] = entry[1];
      return acc;
    }, {});
    const INTENT_MATCH_LABELS = { covered: "\u5DF2\u8986\u76D6", related: "\u76F8\u5173", conflict: "\u51B2\u7A81", uncertain: "\u4E0D\u786E\u5B9A" };
    const INTENT_UNKNOWN_LABELS = { clarify: "\u6F84\u6E05", investigate: "\u8F6C\u8C03\u67E5", exclude: "\u6392\u9664", pending: "\u5F85\u5904\u7406" };
    const INTENT_FIELDS = ["title", "problem", "goal", "inScope", "outOfScope", "acceptance"];
    const INTENT_STAGES = ["\u8BFB\u53D6\u9879\u76EE\u4E0A\u4E0B\u6587", "\u68C0\u7D22\u76F8\u5173\u9700\u6C42", "\u751F\u6210\u5224\u65AD"];
    const INTENT_MAX_IMAGES = 4;
    const INTENT_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
    const INTENT_STATE_LABELS = {
      editing: "\u6B63\u5728\u7F16\u8F91",
      analyzing: "\u5206\u6790\u4E2D",
      needs_input: "\u5F85\u4F60\u56DE\u7B54",
      ready_for_confirmation: "\u53EF\u786E\u8BA4",
      committed: "\u5DF2\u4FDD\u5B58",
      cancelled: "\u5DF2\u53D6\u6D88",
      failed: "\u5931\u8D25"
    };
    const INTENT_VERDICT_LABELS = { answered: "\u5DF2\u56DE\u7B54", "partially-answered": "\u90E8\u5206\u56DE\u7B54", "not-determined": "\u672A\u786E\u5B9A" };
    const INTENT_INVESTIGATION_STAGES = ["\u8BFB\u53D6\u6587\u4EF6", "\u751F\u6210\u8BC1\u636E", "\u6838\u5BF9\u5F15\u7528"];
    function intentView(payload) {
      const view = payload?.session ?? payload?.data?.session ?? null;
      if (!view) return null;
      const analysisStatus = payload?.analysisStatus ?? view.analysisStatus ?? null;
      return analysisStatus ? { ...view, analysisStatus } : view;
    }
    function intentAnalysisStatus(payload) {
      return payload?.analysisStatus ?? payload?.session?.analysisStatus ?? null;
    }
    function intentInvestigationId(investigation) {
      return investigation?.investigationId ?? investigation?.id ?? null;
    }
    function intentInvestigationList(payload) {
      const list = payload?.investigations ?? payload?.session?.investigations ?? [];
      return Array.isArray(list) ? list : [];
    }
    function intentInvestigationTime(investigation) {
      return intentTime(investigation?.finishedAt ?? investigation?.createdAt ?? investigation?.startedAt ?? null);
    }
    function intentRefLabel(ref) {
      if (!ref?.path) return ref?.ref ?? "\u672A\u77E5\u6765\u6E90";
      const line = ref.line === void 0 || ref.line === null ? "" : `#L${ref.line}${ref.endLine ? `-${ref.endLine}` : ""}`;
      return `${ref.path}${line}`;
    }
    function intentSame(a, b) {
      return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    }
    function intentLines(values) {
      return (values ?? []).join("\n");
    }
    function intentTime(iso) {
      if (!iso) return "\u2014";
      const date = new Date(iso);
      return Number.isNaN(date.getTime()) ? String(iso) : date.toLocaleString();
    }
    function intentIdemKey() {
      return `ui-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    }
    function intentBriefOf(candidate) {
      const c = candidate ?? {};
      const parts = [];
      if (c.problem) parts.push(`## \u95EE\u9898
${c.problem}`);
      if (c.goal) parts.push(`## \u76EE\u6807
${c.goal}`);
      if ((c.inScope ?? []).length) parts.push(`## \u8303\u56F4\u5185
${c.inScope.map((line) => `- ${line}`).join("\n")}`);
      if ((c.outOfScope ?? []).length) parts.push(`## \u8303\u56F4\u5916
${c.outOfScope.map((line) => `- ${line}`).join("\n")}`);
      if ((c.acceptance ?? []).length) {
        parts.push(
          `## \u9A8C\u6536
${c.acceptance.map((row2) => `- \u5F53 ${row2.precondition || "\u2014"}\uFF0C${row2.action || "\u2014"}\uFF0C\u5E94 ${row2.expected || "\u2014"}`).join("\n")}`
        );
      }
      return parts.join("\n\n");
    }
    function intentManualSession({ text, source, extractedText, attachment, projectId, projectName }) {
      return {
        sessionId: null,
        state: "editing",
        manual: true,
        input: {
          text,
          source,
          extractedText: extractedText ?? "",
          attachment: attachment ?? null,
          inputRevision: 0,
          explicit: { owner: null, priority: null }
        },
        answers: [],
        runs: [],
        context: { projectId: projectId ?? null, projectName: projectName ?? null, queryStatus: "not-queried", readSet: [], boundary: "\u672C\u9879\u76EE" },
        items: [
          {
            itemId: "manual-1",
            sourceRefs: [],
            userProblem: text,
            desiredOutcome: "",
            recommendedRoute: "create",
            routeRationale: "\u6CA1\u6709\u6A21\u578B\u5224\u65AD\uFF1A\u53BB\u5411\u4E0E\u5019\u9009\u5B8C\u5168\u7531\u4F60\u586B\u5199\uFF0C\u4ECD\u9700\u786E\u8BA4\u624D\u4F1A\u4FDD\u5B58\u3002",
            related: [],
            assumptions: [],
            unknowns: [],
            candidate: { title: "", problem: text, goal: "", inScope: [], outOfScope: [], acceptance: [] },
            counterexample: null,
            fields: {}
          }
        ],
        nextQuestion: null,
        confirmation: null,
        artifacts: [],
        receipt: null,
        readiness: null
      };
    }
    const DRAFT_PROVENANCE_LABELS = {
      "user-stated": { label: "\u7528\u6237\u539F\u8BDD", tone: "neutral" },
      "user-answer": { label: "\u7528\u6237\u56DE\u7B54", tone: "neutral" },
      "human-edit": { label: "\u4EBA\u5DE5\u7F16\u8F91", tone: "brand" },
      "verified-context": { label: "\u5DF2\u6838\u5B9E", tone: "success" },
      "ai-suggestion": { label: "AI \u5EFA\u8BAE", tone: "warn" },
      unconfirmed: { label: "\u672A\u786E\u8BA4", tone: "warn" }
    };
    function draftProvenanceBadge(provenance) {
      const key = Object.prototype.hasOwnProperty.call(DRAFT_PROVENANCE_LABELS, provenance) ? provenance : "unconfirmed";
      const entry = DRAFT_PROVENANCE_LABELS[key];
      const color = entry.tone === "warn" ? T.warn : entry.tone === "success" ? T.ok : entry.tone === "brand" ? T.text : T.text2;
      return h(
        "span",
        {
          "data-draft-provenance": key,
          title: `\u6765\u6E90\uFF1A${entry.label}`,
          style: {
            fontSize: "10.5px",
            lineHeight: 1.5,
            color,
            border: `1px solid ${T.line2}`,
            borderRadius: "999px",
            padding: "0 7px",
            whiteSpace: "nowrap"
          }
        },
        entry.label
      );
    }
    function draftText(value) {
      return (typeof value === "string" ? value : value === null || value === void 0 ? "" : String(value)).replace(/\$\\(?:right)?arrow\$/g, "\u2192").replace(/\s*->\s*/g, " \u2192 ");
    }
    function draftList(value) {
      if (!Array.isArray(value)) return [];
      return value.map((entry) => typeof entry === "string" ? entry : draftText(entry?.text ?? entry?.title ?? entry)).map((entry) => entry.trim()).filter((entry) => entry !== "");
    }
    function draftOfSession(session) {
      if (!session || typeof session !== "object") return null;
      if (session.docDraft && typeof session.docDraft === "object") return session.docDraft;
      const items = Array.isArray(session.items) ? session.items : [];
      for (const item of items) {
        if (item && typeof item === "object" && item.docDraft && typeof item.docDraft === "object") return item.docDraft;
      }
      return null;
    }
    function draftChangesCount(changes) {
      if (!changes) return 0;
      if (Array.isArray(changes)) return changes.length;
      const bucket = (value) => Array.isArray(value) ? value.length : 0;
      return bucket(changes.added) + bucket(changes.removed) + bucket(changes.modified) + bucket(changes.pending);
    }
    function countDraftChanges(before, after) {
      if (!before || !after) return 0;
      let count = 0;
      for (const field of ["goal", "problem"]) {
        if (draftText(before[field]).trim() !== draftText(after[field]).trim()) count += 1;
      }
      for (const field of ["scope", "outOfScope", "constraints"]) {
        if (JSON.stringify(draftList(before[field])) !== JSON.stringify(draftList(after[field]))) count += 1;
      }
      const digest = (entry) => JSON.stringify([entry?.id, entry?.title, entry?.behavior, entry?.text, entry?.provenance]);
      const compareRows = (key) => {
        const left = (Array.isArray(before[key]) ? before[key] : []).map(digest);
        const right = (Array.isArray(after[key]) ? after[key] : []).map(digest);
        if (JSON.stringify(left) !== JSON.stringify(right)) count += 1;
      };
      compareRows("features");
      compareRows("acceptance");
      compareRows("pending");
      return count;
    }
    function DraftDiffSummary({ diff, style }) {
      if (!diff) return null;
      const bucket = (key) => Array.isArray(diff[key]) ? diff[key].length : 0;
      const added = bucket("added");
      const removed = bucket("removed");
      const modified = bucket("modified");
      const pending = bucket("pending");
      const parts = [];
      if (added) parts.push(`\u65B0\u589E ${added}`);
      if (removed) parts.push(`\u5220\u9664 ${removed}`);
      if (modified) parts.push(`\u6539\u5199 ${modified}`);
      if (pending) parts.push(`\u5F85\u786E\u8BA4 ${pending}`);
      if (!parts.length) parts.push("\u65E0\u6761\u6B3E\u7EA7\u5DEE\u5F02");
      return h(
        "div",
        {
          "data-draft-diff": "true",
          style: {
            marginTop: "6px",
            padding: "6px 10px",
            border: `1px solid ${T.line}`,
            borderRadius: "8px",
            fontSize: "11.5px",
            lineHeight: 1.6,
            color: T.text2,
            background: T.layer2,
            ...style
          }
        },
        parts.join(" \xB7 ")
      );
    }
    function IntentDraftPanel({
      draft,
      open,
      onToggle,
      editingKey,
      editValue,
      editBusy,
      notice,
      diff,
      onStartEdit,
      onChangeEdit,
      onCancelEdit,
      onSaveEdit
    }) {
      if (!draft) {
        return h(
          "section",
          { "data-intent-draft": "empty", style: { ...card, cursor: "default", marginBottom: "10px", padding: "10px 14px" } },
          h("div", { style: { fontSize: "11px", letterSpacing: ".05em", color: T.text3, textTransform: "uppercase" } }, "\u9700\u6C42\u8349\u7A3F"),
          h("div", { style: { fontSize: "12px", color: T.text3, marginTop: "4px" } }, "\u8FD9\u4EFD\u4F1A\u8BDD\u8FD8\u6CA1\u6709\u7ED3\u6784\u5316\u9700\u6C42\u8349\u7A3F\uFF08\u65E7\u6A21\u578B\u8F93\u51FA\u6216\u670D\u52A1\u7AEF\u672A\u8FD4\u56DE docDraft\uFF09\uFF0C\u786E\u8BA4\u65F6\u4F1A\u6309\u73B0\u6709\u6B63\u6587\u5904\u7406\u3002")
        );
      }
      const features = Array.isArray(draft.features) ? draft.features : [];
      const acceptance = Array.isArray(draft.acceptance) ? draft.acceptance : [];
      const scope = draftList(draft.scope);
      const outOfScope = draftList(draft.outOfScope);
      const constraints = draftList(draft.constraints);
      const pending = Array.isArray(draft.pending) ? draft.pending : [];
      const docHash = typeof draft.docHash === "string" ? draft.docHash : "";
      const shortDocHash = docHash ? shortHash(docHash.replace(/^sha256:/, "")) : "";
      const noticeCount = typeof notice?.count === "number" ? notice.count : 0;
      const changeCount = draftChangesCount(diff) || noticeCount;
      const noticeText = notice?.message ?? (changeCount ? `\u8349\u7A3F\u5DF2\u66F4\u65B0\uFF08${changeCount} \u5904\u53D8\u5316\uFF09` : "");
      const sectionLabel = {
        fontSize: "11px",
        letterSpacing: ".05em",
        color: T.text3,
        textTransform: "uppercase"
      };
      const paragraph = { fontSize: "13px", lineHeight: 1.7, color: T.text2, marginTop: "4px", whiteSpace: "pre-wrap", wordBreak: "break-word", overflowWrap: "anywhere" };
      const listBody = (rows, empty) => rows.length ? h(
        "ul",
        { style: { margin: "4px 0 0", paddingLeft: "18px", fontSize: "13px", lineHeight: 1.7, color: T.text2 } },
        rows.map((row2, index) => h("li", { key: `${index}-${row2.slice(0, 24)}` }, row2))
      ) : h("div", { style: { fontSize: "12.5px", color: T.text3, marginTop: "4px" } }, empty);
      const editorFor = (key, rows = 2) => h(
        "div",
        { style: { marginTop: "6px" } },
        h("textarea", {
          "data-draft-edit-input": key,
          name: `draft-edit-${key}`,
          autoComplete: "off",
          "aria-label": `\u7F16\u8F91\u8349\u7A3F ${key}`,
          value: editValue,
          onChange: (event) => onChangeEdit(event.target.value),
          rows,
          style: { ...input, width: "100%", minWidth: 0, resize: "vertical", fontFamily: "inherit", fontSize: "13px", lineHeight: 1.7, boxSizing: "border-box" }
        }),
        h(
          "div",
          { style: { display: "flex", gap: "6px", marginTop: "6px" } },
          h("button", { type: "button", "data-draft-edit-save": key, style: { ...primary, padding: "2px 10px" }, disabled: editBusy, onClick: onSaveEdit }, editBusy ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58\u4FEE\u6539"),
          h("button", { type: "button", style: { ...button, padding: "2px 10px" }, disabled: editBusy, onClick: onCancelEdit }, "\u53D6\u6D88")
        )
      );
      const section = (key, title, value, body, options = {}) => {
        const editing = editingKey === key;
        return h(
          "div",
          { "data-draft-section": key, style: { borderTop: `1px solid ${T.line}`, paddingTop: "8px", marginTop: "8px", minWidth: 0 } },
          h(
            "div",
            { style: { display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" } },
            h("div", { style: sectionLabel }, title),
            options.provenance ? draftProvenanceBadge(options.provenance) : null,
            options.locked ? null : h(
              "button",
              {
                type: "button",
                "data-draft-edit": key,
                style: { ...DETAIL_LINK, marginLeft: "auto", fontSize: "11.5px" },
                disabled: editBusy,
                onClick: () => onStartEdit(key, value)
              },
              editing ? "\u7F16\u8F91\u4E2D" : "\u7F16\u8F91"
            )
          ),
          editing ? editorFor(key, options.rows ?? 2) : body
        );
      };
      const provenanceOf = draft.provenance ?? (draft.confirmedAt ? "verified-context" : "unconfirmed");
      const pendingRows = pending.map((entry, index) => {
        if (typeof entry === "string") return { id: `Q-${String(index + 1).padStart(2, "0")}`, text: entry, status: "open" };
        return { id: entry?.id ?? `Q-${String(index + 1).padStart(2, "0")}`, text: entry?.text ?? "", status: entry?.status ?? "open" };
      });
      return h(
        "section",
        {
          "data-intent-draft": "panel",
          "aria-label": "\u9700\u6C42\u8349\u7A3F",
          style: { ...card, cursor: "default", marginBottom: "10px", padding: "10px 14px", minWidth: 0 }
        },
        h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } },
          h(
            "button",
            {
              type: "button",
              "data-draft-toggle": "true",
              "aria-expanded": open ? "true" : "false",
              style: { ...button, padding: "2px 10px" },
              onClick: onToggle
            },
            open ? "\u6536\u8D77\u9700\u6C42\u8349\u7A3F" : "\u5C55\u5F00\u9700\u6C42\u8349\u7A3F"
          ),
          h("span", { style: { fontSize: "12.5px", fontWeight: 600, color: T.text } }, "\u9700\u6C42\u8349\u7A3F"),
          h("span", { style: { fontSize: "11px", color: T.text3 } }, `v${draft.draftRevision ?? "\u2014"}`),
          h("span", { style: { fontSize: "11px", color: T.text3 } }, `${features.length} \u4E2A\u529F\u80FD \xB7 ${acceptance.length} \u6761\u9A8C\u6536`),
          h(
            "span",
            {
              "data-draft-diff-count": String(changeCount),
              role: "status",
              "aria-live": "polite",
              style: { fontSize: "11.5px", color: changeCount ? T.warn : T.text3, marginLeft: "auto" }
            },
            noticeText || (changeCount ? `\u8349\u7A3F\u5DF2\u66F4\u65B0\uFF08${changeCount} \u5904\u53D8\u5316\uFF09` : "\u8349\u7A3F\u672A\u53D8\u5316")
          ),
          docHash ? h(
            "span",
            {
              "data-draft-dochash": shortDocHash,
              title: docHash,
              style: { fontSize: "11px", color: T.text3, fontFamily: "ui-monospace, Cascadia Code, monospace" }
            },
            shortDocHash
          ) : null,
          editBusy ? h("span", { style: { fontSize: "11.5px", color: T.text3 } }, "\u6B63\u5728\u4FDD\u5B58\u2026") : null
        ),
        open ? h(
          "div",
          { "data-draft-body": "true", style: { marginTop: "8px", minWidth: 0 } },
          h(DraftDiffSummary, { diff }),
          section("goal", "\u76EE\u6807", draftText(draft.goal), h("div", { style: paragraph }, draftText(draft.goal) || "\uFF08\u5C1A\u672A\u586B\u5199\uFF09"), {
            provenance: provenanceOf,
            rows: 2
          }),
          section(
            "problem",
            "\u95EE\u9898\u4E0E\u573A\u666F",
            draftText(draft.problem),
            h("div", { style: paragraph }, draftText(draft.problem) || "\uFF08\u5C1A\u672A\u586B\u5199\uFF09"),
            { provenance: provenanceOf, rows: 3 }
          ),
          h(
            "div",
            { "data-draft-section": "features", style: { borderTop: `1px solid ${T.line}`, paddingTop: "8px", marginTop: "8px", minWidth: 0 } },
            h("div", { style: { ...sectionLabel, marginBottom: "2px" } }, `\u8BE6\u7EC6\u529F\u80FD\uFF08${features.length}\uFF09`),
            features.length ? features.map((feature) => {
              const id = draftText(feature?.id) || "FR-??";
              const key = `feature:${id}`;
              const editing = editingKey === key;
              const clauses = [];
              if (feature?.preconditions?.length) clauses.push(`\u524D\u7F6E\uFF1A${draftList(feature.preconditions).join("\uFF1B")}`);
              if (feature?.response) clauses.push(`\u54CD\u5E94\uFF1A${draftText(feature.response)}`);
              if (feature?.boundaries?.length) clauses.push(`\u8FB9\u754C\uFF1A${draftList(feature.boundaries).join("\uFF1B")}`);
              return h(
                "div",
                {
                  key,
                  "data-draft-feature": id,
                  style: { border: `1px solid ${T.line}`, borderRadius: "8px", padding: "6px 10px", marginTop: "6px", minWidth: 0 }
                },
                h(
                  "div",
                  { style: { display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" } },
                  h("span", { style: { fontSize: "12.5px", fontWeight: 600, color: T.text } }, `${id}${feature?.title ? ` ${draftText(feature.title)}` : ""}`),
                  draftProvenanceBadge(feature?.provenance),
                  h(
                    "button",
                    {
                      type: "button",
                      "data-draft-edit": key,
                      style: { ...DETAIL_LINK, marginLeft: "auto", fontSize: "11.5px" },
                      disabled: editBusy,
                      onClick: () => onStartEdit(key, draftText(feature?.behavior))
                    },
                    editing ? "\u7F16\u8F91\u4E2D" : "\u7F16\u8F91"
                  )
                ),
                editing ? editorFor(key, 3) : h(
                  "div",
                  { style: { fontSize: "13px", lineHeight: 1.7, color: T.text2, marginTop: "4px", whiteSpace: "pre-wrap", wordBreak: "break-word", overflowWrap: "anywhere" } },
                  draftText(feature?.behavior) || "\uFF08\u5C1A\u672A\u586B\u5199\u884C\u4E3A\uFF09"
                ),
                clauses.length ? h("div", { style: { fontSize: "12px", lineHeight: 1.7, color: T.text3, marginTop: "3px" } }, clauses.join("\uFF1B")) : null
              );
            }) : h("div", { style: { fontSize: "12.5px", color: T.text3, marginTop: "4px" } }, "\uFF08\u5C1A\u672A\u62C6\u5206\u529F\u80FD\u6761\u76EE\uFF09")
          ),
          h(
            "div",
            { "data-draft-section": "acceptance", style: { borderTop: `1px solid ${T.line}`, paddingTop: "8px", marginTop: "8px", minWidth: 0 } },
            h("div", { style: { ...sectionLabel, marginBottom: "2px" } }, `\u9A8C\u6536\u8981\u6C42\uFF08${acceptance.length}\uFF09`),
            acceptance.length ? acceptance.map((entry) => {
              const id = draftText(entry?.id) || "AC-??";
              const key = `ac:${id}`;
              const editing = editingKey === key;
              const relates = draftList(entry?.featureIds);
              return h(
                "div",
                { key, "data-draft-ac": id, style: { border: `1px solid ${T.line}`, borderRadius: "8px", padding: "6px 10px", marginTop: "6px", minWidth: 0 } },
                h(
                  "div",
                  { style: { display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" } },
                  h("span", { style: { fontSize: "12.5px", fontWeight: 600, color: T.text } }, id),
                  relates.length ? h("span", { style: { fontSize: "11px", color: T.text3 } }, `\u5173\u8054 ${relates.join(" / ")}`) : null,
                  draftProvenanceBadge(entry?.provenance),
                  h(
                    "button",
                    {
                      type: "button",
                      "data-draft-edit": key,
                      style: { ...DETAIL_LINK, marginLeft: "auto", fontSize: "11.5px" },
                      disabled: editBusy,
                      onClick: () => onStartEdit(key, draftText(entry?.text))
                    },
                    editing ? "\u7F16\u8F91\u4E2D" : "\u7F16\u8F91"
                  )
                ),
                editing ? editorFor(key, 3) : h(
                  "div",
                  { style: { fontSize: "13px", lineHeight: 1.7, color: T.text2, marginTop: "4px", whiteSpace: "pre-wrap", wordBreak: "break-word", overflowWrap: "anywhere" } },
                  draftText(entry?.text) || "\uFF08\u5C1A\u672A\u586B\u5199\u9A8C\u6536\u6761\u6B3E\uFF09"
                ),
                entry?.judgement ? h("div", { style: { fontSize: "12px", lineHeight: 1.7, color: T.text3, marginTop: "3px" } }, `\u5224\u5B9A\uFF1A${draftText(entry.judgement)}`) : null
              );
            }) : h("div", { style: { fontSize: "12.5px", color: T.text3, marginTop: "4px" } }, "\uFF08\u5C1A\u672A\u63D0\u70BC\u9A8C\u6536\u6761\u76EE\uFF09")
          ),
          section("scope", "\u672C\u6B21\u8303\u56F4", scope.join("\n"), listBody(scope, "\uFF08\u5C1A\u672A\u586B\u5199\u8303\u56F4\uFF09"), { rows: 3 }),
          section("outOfScope", "\u4E0D\u5305\u542B", outOfScope.join("\n"), listBody(outOfScope, "\uFF08\u5C1A\u672A\u586B\u5199\u4E0D\u5305\u542B\u9879\uFF09"), { rows: 3 }),
          section("constraints", "\u5FC5\u8981\u7EA6\u675F", constraints.join("\n"), listBody(constraints, "\uFF08\u5C1A\u672A\u586B\u5199\u7EA6\u675F\uFF09"), { rows: 3 }),
          h(
            "div",
            { "data-draft-section": "pending", style: { borderTop: `1px solid ${T.line}`, paddingTop: "8px", marginTop: "8px", minWidth: 0 } },
            h(
              "div",
              { style: { display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" } },
              h("div", { style: sectionLabel }, `\u5F85\u786E\u8BA4\uFF08${pendingRows.length}\uFF09`),
              h("span", { style: { fontSize: "11px", color: T.text3 } }, "\u672A\u7EB3\u5165\u6B63\u5F0F\u627F\u8BFA")
            ),
            pendingRows.length ? h(
              "ul",
              { style: { margin: "4px 0 0", paddingLeft: "18px", fontSize: "12.5px", lineHeight: 1.7, color: T.text2 } },
              pendingRows.map((entry) => h("li", { key: entry.id }, `${entry.id} ${entry.text}${entry.status && entry.status !== "open" ? `\uFF08${entry.status}\uFF09` : ""}`))
            ) : h("div", { style: { fontSize: "12.5px", color: T.text3, marginTop: "4px" } }, "\u6CA1\u6709\u5F85\u786E\u8BA4\u9879\u3002")
          )
        ) : null
      );
    }
    const intentInputRecovery = /* @__PURE__ */ new Map();
    const intentEditRecovery = /* @__PURE__ */ new Map();
    function IntentModal({ root, project, projectName, projectId, onClose: closeModal, onCreated, onOpenRequirement }) {
      const recoveryScope = `${root ?? ""}
${projectId ?? project ?? ""}`;
      const [recoveredInput] = useState(() => intentInputRecovery.get(recoveryScope) ?? null);
      useEffect(() => {
        if (recoveredInput && intentInputRecovery.get(recoveryScope) === recoveredInput) intentInputRecovery.delete(recoveryScope);
      }, []);
      const explicitlyClosedRef = useRef(false);
      const onClose = () => {
        explicitlyClosedRef.current = true;
        intentInputRecovery.delete(recoveryScope);
        closeModal();
      };
      const [screen, setScreen] = useState("input");
      const [history, setHistory] = useState({ loading: false, sessions: [], error: null, selected: null });
      const [editRecoveries, setEditRecoveries] = useState(() => intentEditRecovery.get(recoveryScope) ?? []);
      const historyRequestRef = useRef(0);
      const historyRecoveryRef = useRef(null);
      const historyAbortRef = useRef(null);
      const historyScope = `${root ?? ""}
${projectId ?? project ?? ""}`;
      const historyScopeRef = useRef(historyScope);
      const initializedHistoryScopeRef = useRef(historyScope);
      historyScopeRef.current = historyScope;
      const explicitProject = projectId || project;
      const historyAllowed = !!explicitProject && explicitProject !== ALL_PROJECTS;
      const historyCurrent = (token, scope) => mountedRef.current && historyRequestRef.current === token && historyScopeRef.current === scope;
      const invalidateHistory = () => {
        historyRequestRef.current += 1;
        historyAbortRef.current?.abort();
        historyAbortRef.current = null;
      };
      const [rawText, setRawText] = useState(() => recoveredInput?.rawText ?? "");
      const [requirementMatch, setRequirementMatch] = useState(null);
      const [attachMatchedFeedback, setAttachMatchedFeedback] = useState(true);
      const matchRequestRef = useRef(0);
      const [source, setSource] = useState(() => recoveredInput?.source ?? "text");
      const [attachment, setAttachment] = useState(() => recoveredInput?.attachment ?? null);
      const [chatMarkdown, setChatMarkdown] = useState(() => recoveredInput?.chatMarkdown ?? "");
      const [intake, setIntake] = useState(() => recoveredInput?.intake ?? { loading: false, error: null, data: null });
      const intakeRequestRef = useRef(0);
      const [images, setImages] = useState(() => recoveredInput?.images ?? []);
      const imagesRef = useRef([]);
      imagesRef.current = images;
      const imageGenerationRef = useRef(0);
      const imageReadEpochRef = useRef(0);
      const imageReadsRef = useRef(0);
      const pendingImageFilesRef = useRef(/* @__PURE__ */ new Set());
      const clearImages = () => {
        imageGenerationRef.current += 1;
        pendingImageFilesRef.current.clear();
        for (const image of imagesRef.current) {
          if (image.previewObjectUrl && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(image.previewObjectUrl);
        }
        imagesRef.current = [];
        setImages([]);
      };
      const fileInputRef = useRef(null);
      const [analyzePhase, setAnalyzePhase] = useState(null);
      const [expandedImageId, setExpandedImageId] = useState(null);
      const [dragging, setDragging] = useState(false);
      const [composerFocused, setComposerFocused] = useState(false);
      const [ownerChoice, setOwnerChoice] = useState("");
      const [priorityChoice, setPriorityChoice] = useState("");
      const [simpleDraft, setSimpleDraft] = useState(null);
      const [grillAnswers, setGrillAnswers] = useState({});
      const [grillCustom, setGrillCustom] = useState({});
      const [session, setSession] = useState(null);
      const [manual, setManual] = useState({});
      const [routeChoices, setRouteChoices] = useState({});
      const [unknownChoices, setUnknownChoices] = useState({});
      const [conflicts, setConflicts] = useState([]);
      const [busy, setBusy] = useState(false);
      const [editBusy, setEditBusy] = useState(false);
      const [error, setError] = useState(null);
      const [notice, setNotice] = useState(() => recoveredInput ? `\u5DF2\u6062\u590D\u672C\u7A97\u53E3\u4E2D\u672A\u63D0\u4EA4\u7684\u8F93\u5165\uFF1B\u91CD\u65B0\u6253\u5F00\u5E94\u7528\u540E\u65E0\u6CD5\u6062\u590D\u3002${recoveredInput.intakeInterrupted ? "\u804A\u5929\u89E3\u6790\u5DF2\u4E2D\u65AD\uFF0C\u8BF7\u91CD\u65B0\u89E3\u6790\u3002" : ""}` : null);
      const [questionText, setQuestionText] = useState("");
      const [serverBlockers, setServerBlockers] = useState([]);
      const [confirmState, setConfirmState] = useState({ loading: false, error: null, result: null });
      const [rehearsal, setRehearsal] = useState({ loading: false, error: null, data: null, base: null });
      const [receipt, setReceipt] = useState(null);
      const [answerChoice, setAnswerChoice] = useState(null);
      const [answerBusy, setAnswerBusy] = useState(false);
      const [answerElapsed, setAnswerElapsed] = useState(0);
      const [answerFeedback, setAnswerFeedback] = useState(null);
      const [answerCheck, setAnswerCheck] = useState(null);
      const [groupDrafts, setGroupDrafts] = useState({});
      const [groupBusy, setGroupBusy] = useState(false);
      const [groupElapsed, setGroupElapsed] = useState(0);
      const [groupFeedback, setGroupFeedback] = useState(null);
      const [analysisMonitorLost, setAnalysisMonitorLost] = useState(false);
      const [editingQuestionId, setEditingQuestionId] = useState(null);
      const [expandedWhy, setExpandedWhy] = useState({});
      const [decisionsOpen, setDecisionsOpen] = useState(false);
      const [answerHistoryPage, setAnswerHistoryPage] = useState(null);
      const answerHistoryAbort = useRef(null);
      const answerHistoryKey = JSON.stringify([root, historyScope, session?.sessionId, session?.historicalAnswersSnapshot]);
      const answerHistoryKeyRef = useRef(answerHistoryKey);
      answerHistoryKeyRef.current = answerHistoryKey;
      useEffect(() => {
        setAnswerHistoryPage(null);
        return () => {
          answerHistoryAbort.current?.abort();
          answerHistoryAbort.current = null;
        };
      }, [answerHistoryKey]);
      const [draftBarExpanded, setDraftBarExpanded] = useState(false);
      const [draftOpen, setDraftOpen] = useState(false);
      const [draftEditing, setDraftEditing] = useState(null);
      const [draftEditValue, setDraftEditValue] = useState("");
      const [draftBusy, setDraftBusy] = useState(false);
      const [draftNotice, setDraftNotice] = useState(null);
      const [draftDiff, setDraftDiff] = useState(null);
      const draftPrevRef = useRef(null);
      const [investigations, setInvestigations] = useState([]);
      const [investigation, setInvestigation] = useState({ open: false, busy: false, elapsed: 0, error: null, data: null, question: null, expandedId: null });
      const requestRef = useRef(0);
      const abortRef = useRef(null);
      const retryAnalysisRef = useRef(false);
      const answerAbortRef = useRef(null);
      const answerPollRef = useRef(null);
      const answerPollAbortRef = useRef(null);
      const answerTimerRef = useRef(null);
      const investAbortRef = useRef(null);
      const investTimerRef = useRef(null);
      const mountedRef = useRef(true);
      const sessionRef = useRef(null);
      const aiValuesRef = useRef({ inputRevision: null, values: {} });
      const idemRef = useRef(null);
      const screenHeadingRef = useRef(null);
      const blockerRef = useRef(null);
      const priorityRef = useRef(null);
      const editQueueRef = useRef(Promise.resolve());
      const adoptionUncertainRef = useRef(false);
      const confirmEntryRef = useRef(false);
      const editPendingRef = useRef(0);
      const editGenerationRef = useRef(0);
      const groupTimerRef = useRef(null);
      const groupPollRef = useRef(null);
      const groupPollAbortRef = useRef(null);
      const groupPanelRef = useRef(null);
      const groupFeedbackRef = useRef(null);
      const candidateRef = useRef(null);
      const fieldLabelStyle = { fontSize: "11px", letterSpacing: ".06em", textTransform: "uppercase", color: T.text3 };
      const blockTitleStyle = { fontSize: "12px", fontWeight: 600, color: T.text };
      const candidateDirty = Object.entries(manual).some(([itemId, fields]) => {
        const item = (session?.items ?? []).find((entry) => entry.itemId === itemId);
        return Object.entries(fields ?? {}).some(([field, value]) => !intentSame(value, item?.candidate?.[field]));
      });
      const routeDirty = Object.entries(routeChoices).some(([itemId, value]) => {
        const item = (session?.items ?? []).find((entry) => entry.itemId === itemId);
        return value !== (item?.effectiveRoute ?? item?.recommendedRoute ?? "create");
      });
      const explicitDirty = Boolean(session?.sessionId) && (ownerChoice !== (session.input?.explicit?.owner ?? "") || priorityChoice !== (session.input?.explicit?.priority ?? ""));
      const unknownDirty = Object.entries(unknownChoices).some(([key, value]) => {
        const separator = key.lastIndexOf(":");
        const item = (session?.items ?? []).find((entry) => entry.itemId === key.slice(0, separator));
        const index = Number(key.slice(separator + 1));
        return separator < 1 || !Number.isInteger(index) || !item?.unknowns?.[index] || value !== (item.unknowns[index].resolution ?? "pending");
      });
      const unsavedIntent = screen !== "receipt" && (screen === "input" && (rawText !== (session?.input?.rawText ?? "") || images.length > 0 || Boolean(chatMarkdown.trim())) || candidateDirty || routeDirty || explicitDirty || unknownDirty || Boolean(draftEditing) || Object.keys(groupDrafts).length > 0 || answerChoice !== null || Boolean(questionText.trim()) || editBusy || draftBusy || answerBusy || groupBusy || confirmState.loading);
      const historyInputRef = useRef(null);
      historyInputRef.current = { rawText, chatMarkdown, images, source, attachment, intake, ownerChoice, priorityChoice };
      const recoveryRef = useRef(null);
      recoveryRef.current = { scope: recoveryScope, screen, session, rawText, chatMarkdown, images, source, attachment, intake, unsavedIntent, manual, routeChoices, unknownChoices, ownerChoice, priorityChoice, questionText, answerChoice, groupDrafts, editingQuestionId, draftEditing, draftEditValue };
      useEffect(() => {
        const guard = (event) => {
          if (unsavedIntent || imageReadsRef.current > 0) {
            event.preventDefault();
            event.returnValue = "";
          }
        };
        window.addEventListener?.("beforeunload", guard);
        return () => window.removeEventListener?.("beforeunload", guard);
      }, [unsavedIntent]);
      useEffect(() => {
        mountedRef.current = true;
        const pendingRecovery = intentInputRecovery.get(recoveryScope);
        if (pendingRecovery?.owner === recoveryRef) intentInputRecovery.delete(recoveryScope);
        const existingEdits = intentEditRecovery.get(recoveryScope) ?? [];
        const retainedEdits = existingEdits.filter((entry) => entry.owner !== recoveryRef);
        if (retainedEdits.length !== existingEdits.length) {
          if (retainedEdits.length) intentEditRecovery.set(recoveryScope, retainedEdits);
          else intentEditRecovery.delete(recoveryScope);
        }
        return () => {
          const current = recoveryRef.current;
          if (!explicitlyClosedRef.current && current?.screen === "input" && !current.session && (current.rawText || current.chatMarkdown || current.images.length || pendingImageFilesRef.current.size)) {
            intentInputRecovery.set(current.scope, {
              owner: recoveryRef,
              rawText: current.rawText,
              chatMarkdown: current.chatMarkdown,
              source: current.source,
              attachment: current.attachment,
              intakeInterrupted: current.intake.loading,
              intake: current.intake.loading ? { loading: false, error: null, data: null } : current.intake,
              images: current.images.map((image) => ({ ...image, previewObjectUrl: null, previewUrl: `data:${image.mimeType || "image/png"};base64,${image.dataBase64}`, status: "pending", data: null, error: null })),
              pendingFiles: Array.from(pendingImageFilesRef.current).flat()
            });
          }
          if (!explicitlyClosedRef.current && current?.session?.sessionId && current.unsavedIntent && ["review", "confirm"].includes(current.screen)) {
            intentEditRecovery.set(current.scope, [...intentEditRecovery.get(current.scope) ?? [], { ...current, owner: recoveryRef }]);
          }
          mountedRef.current = false;
          imageGenerationRef.current += 1;
          pendingImageFilesRef.current.clear();
          requestRef.current += 1;
          if (answerTimerRef.current) clearInterval(answerTimerRef.current);
          if (answerPollRef.current) clearTimeout(answerPollRef.current);
          if (groupTimerRef.current) clearInterval(groupTimerRef.current);
          if (groupPollRef.current) clearTimeout(groupPollRef.current);
          if (investTimerRef.current) clearInterval(investTimerRef.current);
          for (const controller of [abortRef.current, answerAbortRef.current, answerPollAbortRef.current, groupPollAbortRef.current, investAbortRef.current]) {
            if (!controller) continue;
            try {
              controller.abort();
            } catch {
            }
          }
          for (const image of imagesRef.current) {
            if (image.previewObjectUrl && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(image.previewObjectUrl);
          }
        };
      }, []);
      useEffect(() => {
        if (!session || session.manual) return;
        const explicit = session.input?.explicit ?? {};
        if (explicit.owner) setOwnerChoice((current) => current || explicit.owner);
        if (explicit.priority) setPriorityChoice((current) => current || explicit.priority);
      }, [session]);
      useEffect(() => {
        if (screen === "input") return;
        const node = screenHeadingRef.current;
        if (node && typeof node.focus === "function") {
          try {
            node.focus({ preventScroll: true });
          } catch {
            node.focus();
          }
          const dialog = node.closest('[role="dialog"]');
          if (dialog) dialog.scrollTop = 0;
        }
      }, [screen]);
      useEffect(() => {
        if (!editingQuestionId) return;
        const panel2 = groupPanelRef.current;
        if (!panel2 || typeof panel2.querySelector !== "function") return;
        const node = panel2.querySelector(`[data-question-id="${editingQuestionId}"] button[aria-pressed], [data-question-id="${editingQuestionId}"] textarea`);
        if (node && typeof node.focus === "function") {
          try {
            node.focus({ preventScroll: true });
          } catch {
            node.focus();
          }
        }
      }, [editingQuestionId]);
      const invalidateIdem = () => {
        idemRef.current = null;
      };
      const beginRequest = () => {
        const token = requestRef.current + 1;
        requestRef.current = token;
        return token;
      };
      const isCurrent = (token) => mountedRef.current && requestRef.current === token;
      const setSessionView = (view) => {
        sessionRef.current = view ?? null;
        if (mountedRef.current) setSession(view ?? null);
      };
      const stopTimer = (ref) => {
        if (ref.current) {
          clearInterval(ref.current);
          ref.current = null;
        }
      };
      const startTimer = (ref, tick) => {
        stopTimer(ref);
        ref.current = setInterval(() => {
          if (!mountedRef.current) {
            stopTimer(ref);
            return;
          }
          tick();
        }, 1e3);
      };
      const trackInvestigations = (payload) => {
        const list = intentInvestigationList(payload);
        if (list.length === 0) return;
        setInvestigations((current) => {
          const seen = /* @__PURE__ */ new Map();
          for (const entry of [...list, ...current]) {
            const id = intentInvestigationId(entry);
            if (!id || seen.has(id)) continue;
            seen.set(id, entry);
          }
          return [...seen.values()].slice(0, 20);
        });
      };
      useEffect(() => {
        const draft = session?.docDraft;
        if (!draft || !session?.sessionId) return;
        const suggestions = [...(draft.acceptance ?? []).map((entry) => ({ ...entry, text: entry.text ?? "" })), ...(draft.pending ?? []).filter((entry) => /^\[验收建议·AI 建议\]/.test(entry.text ?? "")).map((entry) => ({ text: entry.text.replace(/^\[验收建议·AI 建议\]\s*/, ""), provenance: "ai-suggestion" }))];
        if (!suggestions.length) suggestions.push({ text: "\u7528\u6237\u80FD\u591F\u5B8C\u6210\u9884\u671F\u53D8\u5316\u3002", provenance: "ai-suggestion" }, { text: "\u7528\u6237\u80FD\u591F\u6838\u5BF9\u9884\u671F\u53D8\u5316\u662F\u5426\u751F\u6548\u3002", provenance: "ai-suggestion" });
        setSimpleDraft({ title: draft.title || session.items?.[0]?.candidate?.title || "", goal: draft.goal || "", problem: draft.problem || "", acceptance: suggestions });
        setGrillAnswers({});
      }, [session?.sessionId, Boolean(session?.docDraft)]);
      const activeItems = () => (session?.items ?? []).filter((item) => !item.excluded);
      const routeOf = (item) => routeChoices[item?.itemId] ?? item?.effectiveRoute ?? item?.recommendedRoute ?? "create";
      const fieldWasEdited = (item, field) => (manual[item?.itemId] ?? {})[field] !== void 0;
      const candidateOf = (item) => {
        const base = item?.candidate ?? {};
        const edited = manual[item?.itemId] ?? {};
        return {
          title: edited.title ?? base.title ?? "",
          problem: edited.problem ?? base.problem ?? "",
          goal: edited.goal ?? base.goal ?? "",
          inScope: edited.inScope ?? base.inScope ?? [],
          outOfScope: edited.outOfScope ?? base.outOfScope ?? [],
          acceptance: edited.acceptance ?? base.acceptance ?? []
        };
      };
      const cleanCandidate = (candidate) => ({
        title: String(candidate.title ?? "").trim(),
        problem: String(candidate.problem ?? "").trim(),
        goal: String(candidate.goal ?? "").trim(),
        inScope: (candidate.inScope ?? []).map((line) => String(line).trim()).filter((line) => line !== ""),
        outOfScope: (candidate.outOfScope ?? []).map((line) => String(line).trim()).filter((line) => line !== ""),
        acceptance: (candidate.acceptance ?? []).map((row2) => ({
          ...row2,
          precondition: row2?.precondition ?? "",
          action: row2?.action ?? "",
          expected: row2?.expected ?? "",
          judgement: row2?.judgement ?? "pass"
        }))
      });
      const changeBaseOf = (item) => {
        const related = item?.related ?? [];
        return related.find((entry) => entry.match === "covered" || entry.match === "conflict") ?? related.find((entry) => entry.match === "related") ?? related[0] ?? null;
      };
      const relatedTitleOf = (entry) => {
        if (entry?.title) return entry.title;
        const readSet = session?.context?.readSet ?? [];
        const found = readSet.find((item) => item?.uid === entry?.uid || item?.id === entry?.uid);
        return found?.title ?? null;
      };
      const errorOf = (caught) => ({
        code: caught?.code ?? null,
        status: caught?.status ?? null,
        message: caught?.message ?? String(caught),
        reasons: caught?.reasons ?? caught?.payload?.error?.reasons ?? [],
        appliedArtifacts: caught?.appliedArtifacts ?? caught?.payload?.error?.appliedArtifacts ?? [],
        manualFallback: caught?.manualFallback === true || caught?.payload?.manualFallback === true
      });
      const setManualField = (itemId, field, value) => {
        invalidateIdem();
        setServerBlockers([]);
        setManual((current) => ({ ...current, [itemId]: { ...current[itemId] ?? {}, [field]: value } }));
      };
      const applySession = (view) => {
        if (!view) return;
        setAnalysisMonitorLost(false);
        const nextValues = {};
        for (const item of view.items ?? []) {
          const base = item.candidate ?? {};
          const fieldValues = {};
          for (const field of INTENT_FIELDS) fieldValues[field] = base[field] ?? (Array.isArray(base[field]) ? [] : "");
          nextValues[item.itemId] = fieldValues;
        }
        const previous = aiValuesRef.current.values;
        const found = [];
        for (const item of view.items ?? []) {
          const edited = manual[item.itemId] ?? {};
          for (const field of INTENT_FIELDS) {
            if (edited[field] === void 0) continue;
            const before = previous[item.itemId]?.[field];
            const after = nextValues[item.itemId]?.[field];
            if (before === void 0 && after === void 0) continue;
            if (before !== void 0 && after !== void 0 && !intentSame(before, after) && !intentSame(edited[field], after) && !intentSame(edited[field], before)) {
              found.push({ itemId: item.itemId, field, manualValue: edited[field], aiValue: after });
            }
          }
        }
        setConflicts(found);
        aiValuesRef.current = { inputRevision: view.input?.inputRevision ?? null, values: nextValues };
        const carryFor = session?.manual ? manual["manual-1"] : null;
        const firstNew = (view.items ?? []).find((item) => !item.excluded);
        if (carryFor && firstNew) {
          setManual((current) => current[firstNew.itemId] ? current : { ...current, [firstNew.itemId]: carryFor });
        }
        const previousRoutes = routeChoices;
        const nextRoutes = {};
        for (const item of view.items ?? []) {
          if (previousRoutes[item.itemId] !== void 0) nextRoutes[item.itemId] = previousRoutes[item.itemId];
        }
        setRouteChoices(nextRoutes);
        const nextDraft = draftOfSession(view);
        const previousDraft = draftPrevRef.current;
        draftPrevRef.current = nextDraft;
        if (previousDraft && nextDraft && previousDraft.docHash !== nextDraft.docHash) {
          const changed = countDraftChanges(previousDraft, nextDraft);
          setDraftNotice({ count: changed, message: `\u8349\u7A3F\u5DF2\u66F4\u65B0\uFF08${changed} \u5904\u53D8\u5316\uFF09` });
          setDraftDiff(null);
        }
        setSessionView(view);
      };
      const readHistory = async (sessionId = null, recovery = null) => {
        if (!historyAllowed) return;
        if (sessionId && (unsavedIntent || imageReadsRef.current > 0) && !window.confirm("\u5207\u6362\u5386\u53F2\u4F1A\u8BDD\u4F1A\u4E22\u5F03\u5F53\u524D\u672A\u4FDD\u5B58\u7684\u5185\u5BB9\uFF0C\u786E\u5B9A\u7EE7\u7EED\uFF1F")) return;
        const inputAtStart = historyInputRef.current;
        const editsAtStart = recoveryRef.current;
        const imageReadAtStart = imageReadEpochRef.current;
        invalidateHistory();
        editQueueRef.current = Promise.resolve();
        editPendingRef.current = 0;
        editGenerationRef.current += 1;
        setEditBusy(false);
        const token = historyRequestRef.current;
        const scope = historyScope;
        historyRecoveryRef.current = recovery;
        const controller = new AbortController();
        historyAbortRef.current = controller;
        let timedOut = false;
        const timeout = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, 1e4);
        if (sessionId) setNotice(null);
        setHistory((value) => ({ ...value, loading: true, error: null, selected: sessionId }));
        try {
          const query = `project=${encodeURIComponent(explicitProject)}&root=${encodeURIComponent(root ?? "")}`;
          const suffix = sessionId ? `session=${encodeURIComponent(sessionId)}` : "action=history";
          const signal = controller.signal;
          const response = await fetch(`/api/alm/requirements/intent?${query}&${suffix}`, { headers: { accept: "application/json" }, signal });
          const payload = await response.json().catch((error2) => {
            if (signal.aborted) throw signal.reason ?? error2;
            return null;
          });
          if (!response.ok || payload?.ok === false) throw new Error(payload?.error?.message ?? `HTTP ${response.status}`);
          if (!historyCurrent(token, scope)) return;
          if (!sessionId) {
            if (!Array.isArray(payload?.sessions) || payload.sessions.some((entry) => !entry || typeof entry.sessionId !== "string" || !entry.sessionId.trim())) throw new Error("\u610F\u56FE\u5386\u53F2\u54CD\u5E94\u4E0D\u5B8C\u6574\uFF0C\u8BF7\u91CD\u8BD5\u3002");
            setHistory({ loading: false, sessions: payload.sessions, error: null, selected: null });
            return;
          }
          const view = intentView(payload);
          if (!view || view.sessionId !== sessionId) throw new Error("\u670D\u52A1\u7AEF\u6CA1\u6709\u8FD4\u56DE\u6240\u9009\u610F\u56FE\uFF1B\u8BF7\u91CD\u8BD5\u52A0\u8F7D\u3002");
          if (view.state === "committed" && !view.receipt) throw new Error("\u5DF2\u63D0\u4EA4\u610F\u56FE\u7F3A\u5C11\u539F\u56DE\u6267\uFF1B\u65E0\u6CD5\u5B89\u5168\u6062\u590D\uFF0C\u8BF7\u91CD\u8BD5\u52A0\u8F7D\u3002");
          if (recovery && (view.state === "committed" || !Number.isInteger(view.sessionRevision) || view.sessionRevision < 1 || !Number.isInteger(recovery.session.sessionRevision) || view.sessionRevision !== recovery.session.sessionRevision || !Number.isInteger(view.input?.inputRevision) || view.input.inputRevision < 1 || !Number.isInteger(recovery.session.input?.inputRevision) || view.input.inputRevision !== recovery.session.input.inputRevision)) {
            throw new Error("\u670D\u52A1\u7AEF\u4F1A\u8BDD\u5DF2\u53D8\u5316\u6216\u7248\u672C\u672A\u77E5\uFF0C\u4E0D\u80FD\u81EA\u52A8\u6062\u590D\u7F16\u8F91\uFF1B\u8BF7\u67E5\u770B\u4FDD\u7559\u7684\u672C\u5730\u5185\u5BB9\u5E76\u624B\u52A8\u6838\u5BF9\u3002");
          }
          const currentInput = historyInputRef.current;
          const currentEdits = recoveryRef.current;
          const editFields = ["session", "manual", "routeChoices", "unknownChoices", "questionText", "answerChoice", "groupDrafts", "editingQuestionId", "draftEditing", "draftEditValue"];
          if (editFields.some((field) => currentEdits[field] !== editsAtStart[field]) || currentInput.rawText !== inputAtStart.rawText || currentInput.chatMarkdown !== inputAtStart.chatMarkdown || imagesRef.current !== inputAtStart.images || imageReadEpochRef.current !== imageReadAtStart || currentInput.source !== inputAtStart.source || currentInput.attachment !== inputAtStart.attachment || currentInput.intake !== inputAtStart.intake || currentInput.ownerChoice !== inputAtStart.ownerChoice || currentInput.priorityChoice !== inputAtStart.priorityChoice) {
            setHistory((value) => ({ ...value, loading: false, error: null, selected: null }));
            setNotice("\u52A0\u8F7D\u671F\u95F4\u8F93\u5165\u5DF2\u53D8\u5316\uFF0C\u5F53\u524D\u5185\u5BB9\u5DF2\u4FDD\u7559\uFF1B\u8BF7\u91CD\u65B0\u9009\u62E9\u5386\u53F2\u4F1A\u8BDD\u3002");
            return;
          }
          setManual({});
          setRouteChoices({});
          setUnknownChoices({});
          setConflicts([]);
          setGroupDrafts({});
          setAnswerChoice(null);
          setQuestionText("");
          setAnswerFeedback(null);
          setGroupFeedback(null);
          setAnswerCheck(null);
          setEditingQuestionId(null);
          setDraftEditing(null);
          setDraftEditValue("");
          setDraftNotice(null);
          setDraftDiff(null);
          setDraftOpen(false);
          setServerBlockers([]);
          adoptionUncertainRef.current = false;
          setError(null);
          setNotice(null);
          setConfirmState({ loading: false, error: null, result: null });
          invalidateIdem();
          aiValuesRef.current = { inputRevision: null, values: {} };
          draftPrevRef.current = draftOfSession(view);
          setAnalysisMonitorLost(false);
          investAbortRef.current?.abort();
          investAbortRef.current = null;
          stopTimer(investTimerRef);
          setSessionView(view);
          setInvestigations(intentInvestigationList(payload));
          setInvestigation({ open: false, busy: false, elapsed: 0, error: null, data: null, question: null, expandedId: null });
          setRawText(view.input?.rawText ?? "");
          intakeRequestRef.current += 1;
          setIntake({ loading: false, error: null, data: null });
          setChatMarkdown("");
          setSource(view.input?.source ?? "text");
          clearImages();
          setAttachment(null);
          setOwnerChoice(view.input?.explicit?.owner ?? "");
          setPriorityChoice(view.input?.explicit?.priority ?? "");
          setReceipt(view.receipt ? { receipt: view.receipt, artifacts: view.artifacts ?? view.receipt.artifacts ?? [], replayed: true } : null);
          if (recovery) {
            setManual(recovery.manual);
            setRouteChoices(recovery.routeChoices);
            setUnknownChoices(recovery.unknownChoices);
            setOwnerChoice(recovery.ownerChoice);
            setPriorityChoice(recovery.priorityChoice);
            setQuestionText(recovery.questionText);
            setAnswerChoice(recovery.answerChoice);
            setGroupDrafts(recovery.groupDrafts);
            setEditingQuestionId(recovery.editingQuestionId);
            setDraftEditing(recovery.draftEditing);
            setDraftEditValue(recovery.draftEditValue);
            setDraftOpen(Boolean(recovery.draftEditing));
            const remaining = (intentEditRecovery.get(scope) ?? []).filter((entry) => entry !== recovery);
            if (remaining.length) intentEditRecovery.set(scope, remaining);
            else intentEditRecovery.delete(scope);
            setEditRecoveries(remaining);
            setNotice("\u5DF2\u6062\u590D\u672A\u63D0\u4EA4\u7F16\u8F91\uFF0C\u8BF7\u6838\u5BF9\u540E\u518D\u63D0\u4EA4\u3002");
          }
          setScreen(view.state === "committed" ? "receipt" : "review");
          setHistory((value) => ({ ...value, loading: false, error: null, selected: sessionId }));
          if (view.state !== "committed" && view.analysisStatus?.status === "running") {
            const requestToken = beginRequest();
            if (view.analysisStatus.origin === "retry") {
              setNotice("\u6B63\u5728\u91CD\u65B0\u5206\u6790\uFF0C\u5B8C\u6210\u540E\u81EA\u52A8\u66F4\u65B0\u4F1A\u8BDD\u3002");
              pollAnalysis(sessionId, requestToken, true);
            } else if (view.questionGroup) {
              const savedInfo = {};
              setGroupFeedback({ kind: "running", ...savedInfo, elapsed: 0 });
              pollGroupAnalysis(sessionId, requestToken, savedInfo);
            } else {
              setAnswerFeedback({ kind: "success", message: "\u56DE\u7B54\u5DF2\u8BB0\u5F55\uFF0C\u6B63\u5728\u66F4\u65B0\u5019\u9009\u2026" });
              pollAnalysis(sessionId, requestToken);
            }
          }
        } catch (caught) {
          if (!historyCurrent(token, scope)) return;
          setHistory((value) => ({ ...value, loading: false, error: timedOut ? { message: "\u8BFB\u53D6\u610F\u56FE\u5386\u53F2\u8D85\u65F6\uFF0C\u8BF7\u91CD\u8BD5\u3002" } : errorOf(caught), selected: sessionId }));
        } finally {
          clearTimeout(timeout);
          if (historyAbortRef.current === controller) historyAbortRef.current = null;
        }
      };
      useEffect(() => {
        if (initializedHistoryScopeRef.current === historyScope) {
          return invalidateHistory;
        }
        initializedHistoryScopeRef.current = historyScope;
        invalidateHistory();
        setEditRecoveries(intentEditRecovery.get(historyScope) ?? []);
        requestRef.current += 1;
        setHistory({ loading: false, sessions: [], error: null, selected: null });
        editQueueRef.current = Promise.resolve();
        editPendingRef.current = 0;
        editGenerationRef.current += 1;
        adoptionUncertainRef.current = false;
        invalidateIdem();
        setSessionView(null);
        setOwnerChoice("");
        setPriorityChoice("");
        clearImages();
        setAttachment(null);
        setSource("text");
        intakeRequestRef.current += 1;
        setChatMarkdown("");
        setIntake({ loading: false, error: null, data: null });
        setInvestigations([]);
        setInvestigation({ open: false, busy: false, elapsed: 0, error: null, data: null, question: null, expandedId: null });
        setConflicts([]);
        setGroupDrafts({});
        setServerBlockers([]);
        setDraftNotice(null);
        setDraftDiff(null);
        setRawText("");
        setManual({});
        setRouteChoices({});
        setUnknownChoices({});
        setAnswerChoice(null);
        setQuestionText("");
        setAnswerFeedback(null);
        setGroupFeedback(null);
        setAnswerCheck(null);
        setGroupDrafts({});
        setReceipt(null);
        setError(null);
        setNotice(null);
        setBusy(false);
        setEditBusy(false);
        setDraftBusy(false);
        setDraftEditing(null);
        setDraftEditValue("");
        setConfirmState({ loading: false, error: null, result: null });
        setScreen("input");
        return invalidateHistory;
      }, [historyScope]);
      const renderHistory = () => h(
        "section",
        { "data-testid": "intent-history" },
        editRecoveries.map((editRecovery, index) => h(
          "div",
          { key: `${editRecovery.session.sessionId}:${index}`, role: "group", "aria-label": `\u672C\u5730\u7F16\u8F91 ${editRecovery.session.sessionId} ${index + 1}`, style: { marginBottom: "8px", color: T.text2 } },
          h("p", null, `\u672C\u7A97\u53E3\u4FDD\u7559\u4E86\u672A\u63D0\u4EA4\u7684\u6F84\u6E05\u7F16\u8F91\uFF1A${editRecovery.session.sessionId}\uFF08\u7B2C ${index + 1} \u4EFD\uFF09\u3002`),
          h("button", { type: "button", style: button, disabled: history.loading, onClick: () => readHistory(editRecovery.session.sessionId, editRecovery) }, "\u6838\u5BF9\u7248\u672C\u5E76\u6062\u590D\u7F16\u8F91"),
          h("button", { type: "button", style: button, disabled: history.loading, onClick: () => {
            if (!window.confirm("\u786E\u5B9A\u4E22\u5F03\u672C\u7A97\u53E3\u4FDD\u7559\u7684\u672A\u63D0\u4EA4\u7F16\u8F91\uFF1F")) return;
            const remaining = (intentEditRecovery.get(recoveryScope) ?? []).filter((entry) => entry !== editRecovery);
            if (remaining.length) intentEditRecovery.set(recoveryScope, remaining);
            else intentEditRecovery.delete(recoveryScope);
            setEditRecoveries(remaining);
          } }, "\u4E22\u5F03\u672C\u5730\u7F16\u8F91"),
          h("details", null, h("summary", null, "\u67E5\u770B\u672C\u5730\u672A\u63D0\u4EA4\u5185\u5BB9"), h("pre", { style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } }, JSON.stringify({ candidate: editRecovery.manual, routes: editRecovery.routeChoices, unknowns: editRecovery.unknownChoices, owner: editRecovery.ownerChoice, priority: editRecovery.priorityChoice, answer: editRecovery.questionText, choice: editRecovery.answerChoice, answers: editRecovery.groupDrafts, draft: editRecovery.draftEditing ? { field: editRecovery.draftEditing, value: editRecovery.draftEditValue } : null }, null, 2)))
        )),
        h("button", { type: "button", style: button, disabled: !historyAllowed || history.loading, onClick: () => readHistory() }, history.loading ? "\u52A0\u8F7D\u5386\u53F2\u4E2D\u2026" : "\u67E5\u770B\u670D\u52A1\u7AEF\u610F\u56FE\u5386\u53F2"),
        !historyAllowed ? h("p", { role: "status" }, "\u8BF7\u5148\u660E\u786E\u9009\u62E9\u4E00\u4E2A\u9879\u76EE\uFF0C\u518D\u67E5\u770B\u610F\u56FE\u5386\u53F2\u3002") : null,
        history.error ? h(
          "div",
          { role: "alert" },
          history.error.message,
          h("button", { type: "button", style: button, onClick: () => readHistory(history.selected, historyRecoveryRef.current) }, "\u91CD\u8BD5\u52A0\u8F7D")
        ) : null,
        history.sessions.map((entry) => h("button", {
          key: entry.sessionId,
          type: "button",
          style: { ...button, display: "block", marginTop: "6px" },
          "data-history-session": entry.sessionId,
          onClick: () => readHistory(entry.sessionId)
        }, `${entry.title ?? ""} \xB7 ${entry.sessionId} \xB7 ${entry.state} \xB7 ${entry.updatedAt ?? "\u66F4\u65B0\u65F6\u95F4\u672A\u77E5"}`))
      );
      const draftOf = () => draftOfSession(sessionRef.current ?? session);
      const draftPatchFor = (key, value) => {
        const draft = draftOf();
        if (!draft) return null;
        const text = String(value ?? "");
        if (key === "goal" || key === "problem") return { [key]: text.trim() };
        if (key === "scope" || key === "outOfScope") {
          return { [key]: text.split("\n").map((line) => line.trim()).filter((line) => line !== "") };
        }
        if (key === "constraints") {
          return { constraints: text.split("\n").map((line) => line.trim()).filter((line) => line !== "") };
        }
        if (key.startsWith("feature:")) {
          const id = key.slice("feature:".length);
          const features = (Array.isArray(draft.features) ? draft.features : []).map(
            (entry) => entry?.id === id ? { ...entry, behavior: text.trim(), provenance: "human-edit" } : entry
          );
          return { features };
        }
        if (key.startsWith("ac:")) {
          const id = key.slice("ac:".length);
          const acceptance = (Array.isArray(draft.acceptance) ? draft.acceptance : []).map(
            (entry) => entry?.id === id ? { ...entry, text: text.trim(), provenance: "human-edit" } : entry
          );
          return { acceptance };
        }
        return null;
      };
      const startDraftEdit = (key, value) => {
        if (draftBusy) return;
        setDraftOpen(true);
        setDraftEditing(key);
        setDraftEditValue(String(value ?? ""));
      };
      const cancelDraftEdit = () => {
        setDraftEditing(null);
        setDraftEditValue("");
      };
      const applyDraftResponse = (payload) => {
        if (payload?.session) applySession(payload.session);
        if (payload?.changes && !Array.isArray(payload.changes)) setDraftDiff(payload.changes);
        const current = draftOfSession(sessionRef.current) ?? draftOfSession(payload?.session);
        const count = draftChangesCount(payload?.changes) || countDraftChanges(draftPrevRef.current, current);
        setDraftNotice({ count, message: `\u8349\u7A3F\u5DF2\u66F4\u65B0\uFF08${count} \u5904\u53D8\u5316\uFF09` });
        setDraftOpen(true);
      };
      const submitDraftEdit = () => {
        const key = draftEditing;
        if (!key || draftBusy) return;
        const patch = draftPatchFor(key, draftEditValue);
        if (!patch) {
          setDraftEditing(null);
          return;
        }
        const current = sessionRef.current ?? session;
        if (!current?.sessionId) {
          setError({ code: "no-session", message: "\u670D\u52A1\u7AEF\u8FD8\u6CA1\u6709\u8FD9\u4EFD\u4F1A\u8BDD\uFF0C\u65E0\u6CD5\u4FDD\u5B58\u8349\u7A3F\u4FEE\u6539\uFF1B\u8BF7\u5148\u91CD\u65B0\u5206\u6790\u3002" });
          return;
        }
        const draft = draftOf();
        const baseRevision = draft?.draftRevision ?? current.draftRevision ?? null;
        const historyToken = historyRequestRef.current;
        const scope = historyScope;
        setDraftBusy(true);
        setError(null);
        writeJson(
          "intent",
          {
            action: "set-doc-draft",
            sessionId: current.sessionId,
            docDraft: patch,
            expectedDraftRevision: baseRevision,
            expectedSessionRevision: current.sessionRevision ?? null
          },
          root
        ).then((payload) => {
          if (!historyCurrent(historyToken, scope)) return;
          if (payload?.session || payload?.changed === true) applyDraftResponse(payload);
          else setDraftNotice({ count: 0, message: "\u8349\u7A3F\u672A\u53D8\u5316\uFF08\u670D\u52A1\u7AEF\u6CA1\u6709\u8FD4\u56DE\u65B0\u8349\u7A3F\uFF09" });
          setDraftEditing(null);
          setDraftEditValue("");
        }).catch((caught) => {
          if (!historyCurrent(historyToken, scope)) return;
          setError(errorOf(caught));
        }).finally(() => {
          if (!historyCurrent(historyToken, scope)) return;
          setDraftBusy(false);
        });
      };
      const runAnalyze = async (options = {}) => {
        if (imageReadsRef.current > 0) {
          setError({ code: "image-reading", message: "\u56FE\u7247\u6B63\u5728\u8BFB\u53D6\uFF0C\u8BF7\u7A0D\u540E\u518D\u5206\u6790\u3002" });
          return;
        }
        const analysisOptions = options && typeof options === "object" && !options.nativeEvent ? options : {};
        const retryExisting = screen === "review" && Boolean(sessionRef.current?.sessionId) && analysisOptions.textOverride === void 0;
        if (retryExisting && (draftEditing || Object.keys(groupDrafts).length || answerChoice !== null || questionText.trim())) {
          setError({ code: "unsubmitted-edits", message: "\u8BF7\u5148\u4FDD\u5B58\u6216\u53D6\u6D88\u6B63\u5728\u7F16\u8F91\u7684\u6B63\u6587\u548C\u56DE\u7B54\uFF0C\u518D\u91CD\u65B0\u5206\u6790\u3002" });
          return;
        }
        if (retryExisting && (candidateDirty || routeDirty || explicitDirty || editBusy)) {
          const scope = historyScope, historyToken = historyRequestRef.current, sessionId = sessionRef.current.sessionId;
          setBusy(true);
          try {
            await editQueueRef.current;
            if (!historyCurrent(historyToken, scope) || sessionRef.current?.sessionId !== sessionId) return;
            if (!await flushAllEdits()) throw new Error("\u670D\u52A1\u7AEF\u672A\u8FD4\u56DE\u5DF2\u4FDD\u5B58\u4F1A\u8BDD");
            if (!historyCurrent(historyToken, scope) || sessionRef.current?.sessionId !== sessionId) return;
          } catch (caught) {
            if (historyCurrent(historyToken, scope)) setError({ code: "edit-save-failed", message: `\u4FDD\u5B58\u5F53\u524D\u7F16\u8F91\u5931\u8D25\uFF1A${caught?.message ?? String(caught)}\uFF1B\u8BF7\u91CD\u8BD5\u3002` });
            return;
          } finally {
            if (historyCurrent(historyToken, scope)) setBusy(false);
          }
        }
        const typedText = String(analysisOptions.textOverride ?? (retryExisting ? sessionRef.current?.input?.text : rawText) ?? "").trim();
        if (typedText === "" && images.length === 0) {
          setError({ code: "input-required", message: "\u8BF7\u5148\u7528\u539F\u8BDD\u5199\u4E0B\u4F60\u60F3\u6539\u53D8\u4EC0\u4E48\uFF0C\u6216\u7C98\u8D34\u81F3\u5C11\u4E00\u5F20\u56FE\u7247" });
          return;
        }
        invalidateIdem();
        setServerBlockers([]);
        setError(null);
        setNotice(null);
        setAnswerFeedback(null);
        setAnswerCheck(null);
        const token = beginRequest();
        retryAnalysisRef.current = retryExisting;
        const controller = new AbortController();
        abortRef.current = controller;
        setScreen("analyzing");
        setBusy(true);
        setAnalyzePhase({ phase: images.length > 0 ? "ocr" : "analyze", index: 0, total: images.length });
        let prepared = [];
        try {
          prepared = await prepareOcrImages(retryExisting ? [] : images, {
            signal: controller.signal,
            isCurrent: () => isCurrent(token),
            onProgress: (index, total) => setAnalyzePhase({ phase: "ocr", index, total })
          });
        } catch (caught) {
          if (!isCurrent(token) || caught?.name === "AbortError") return;
          setBusy(false);
          setScreen("input");
          setError({ code: caught?.code ?? "ocr-failed", message: caught?.message ?? "\u56FE\u7247\u8BC6\u522B\u5931\u8D25" });
          return;
        }
        if (!isCurrent(token) || controller.signal.aborted) return;
        const imageMaterial = prepared.map((image, index) => {
          const lines = image.data?.lines;
          if (!Array.isArray(lines) || lines.length === 0) return "";
          return `\u56FE\u7247 ${index + 1}\uFF08${image.name}\uFF09\u8BC6\u522B\u6587\u672C\uFF1A
${lines.map((line) => `${line.ref} ${line.text}`).join("\n")}`;
        }).filter(Boolean).join("\n\n");
        const recognizedText = prepared.map((image) => String(image.data?.text ?? "").trim()).filter(Boolean).map((text2, index, list) => list.length > 1 ? `\u3010\u56FE\u7247 ${index + 1}\u3011
${text2}` : text2).join("\n\n");
        const text = typedText === "" ? recognizedText : typedText;
        if (text === "") {
          setBusy(false);
          setScreen("input");
          setError({ code: "empty-input", message: "\u56FE\u7247\u91CC\u6CA1\u6709\u8BC6\u522B\u5230\u6587\u5B57\uFF1B\u8BF7\u8865\u5145\u539F\u8BDD\u540E\u518D\u5206\u6790" });
          return;
        }
        setAnalyzePhase({ phase: "analyze", index: prepared.length, total: prepared.length });
        const parsedChat = intake.data?.schema === "alm.intake.chat/v1" ? String(intake.data.text ?? "") : "";
        const chatText = parsedChat;
        const collectedAttachment = prepared.length > 0 ? {
          name: prepared.map((image) => image.name).join("\u3001").slice(0, 200),
          kind: "screenshot",
          size: prepared.reduce((total, image) => total + (Number(image.size) || 0), 0)
        } : attachment ? { name: attachment.name, kind: attachment.kind } : void 0;
        const investigationIds = (analysisOptions.investigationIds ?? []).filter((id) => typeof id === "string" && id !== "").slice(0, 5);
        const body = {
          action: "analyze",
          projectId: projectId ?? project ?? void 0,
          input: {
            text,
            // 纯图片输入时，原话来自 OCR，来源标成 ocr；图文混合仍按文字/聊天记录。
            source: typedText === "" && prepared.length > 0 ? "ocr" : source,
            extractedText: [chatText, imageMaterial].filter(Boolean).join("\n\n"),
            attachment: collectedAttachment
          },
          explicit: { owner: ownerChoice.trim() || null, priority: priorityChoice || null }
        };
        if (investigationIds.length > 0) body.investigationIds = investigationIds;
        if (Array.isArray(analysisOptions.grillAnswers) && analysisOptions.grillAnswers.length > 0) body.grillAnswers = analysisOptions.grillAnswers;
        const previous = sessionRef.current;
        if (previous?.sessionId) body.sessionId = previous.sessionId;
        if (retryExisting) {
          body.retryExisting = true;
          body.expectedSessionRevision = previous.sessionRevision;
        }
        writeJson("intent", body, root, { signal: controller.signal }).then((payload) => {
          if (!isCurrent(token)) return;
          setBusy(false);
          const view = intentView(payload);
          if (!view) {
            setScreen("input");
            setError({ code: "empty-response", message: "\u5206\u6790\u6CA1\u6709\u8FD4\u56DE\u4F1A\u8BDD" });
            return;
          }
          trackInvestigations(payload);
          applySession(view);
          const match = payload?.matchedReq;
          if (match?.matchedReqId && ["high", "medium"].includes(match.confidence)) {
            setRequirementMatch(match);
            setAttachMatchedFeedback(true);
          } else setRequirementMatch(null);
          setScreen("review");
          if (investigationIds.length > 0) setNotice("\u5DF2\u628A\u8C03\u67E5\u8BC1\u636E\u5E26\u5165\u8FD9\u6B21\u5224\u65AD\uFF1B\u8BC1\u636E\u4ECD\u9700\u8981\u4F60\u6838\u5BF9\u3002");
        }).catch((caught) => {
          if (!isCurrent(token) || caught?.name === "AbortError") return;
          setBusy(false);
          const view = intentView(caught?.payload);
          if (view) applySession(view);
          const info = errorOf(caught);
          if (info.status === 503) {
            setNotice(`\u5206\u6790\u6682\u4E0D\u53EF\u7528\uFF1A${info.message}\u3002${retryExisting ? "\u4F1A\u8BDD\u53EF\u80FD\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5728\u201C\u5206\u6790\u4E0E\u8349\u6848\u4FE1\u606F\u201D\u4E2D\u91CD\u65B0\u52A0\u8F7D\u4F1A\u8BDD\u540E\u518D\u64CD\u4F5C\u3002" : "\u4F60\u4ECD\u53EF\u624B\u52A8\u586B\u5199\u5019\u9009\u5E76\u4FDD\u5B58\u4F1A\u8BDD\uFF0C\u7A0D\u540E\u518D\u786E\u8BA4\uFF1B\u73B0\u5728\u4E0D\u4F1A\u521B\u5EFA\u4EFB\u4F55\u9700\u6C42\u3002"}`);
            setScreen(view || retryExisting ? "review" : "input");
            return;
          }
          setError(info);
          if (retryExisting && !view) setNotice("\u4F1A\u8BDD\u53EF\u80FD\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5728\u201C\u5206\u6790\u4E0E\u8349\u6848\u4FE1\u606F\u201D\u4E2D\u91CD\u65B0\u52A0\u8F7D\u4F1A\u8BDD\u540E\u518D\u64CD\u4F5C\u3002");
          setScreen(view || retryExisting || investigationIds.length > 0 ? "review" : "input");
        });
      };
      const cancelAnalyze = () => {
        requestRef.current += 1;
        if (abortRef.current) {
          try {
            abortRef.current.abort();
          } catch {
          }
        }
        setBusy(false);
        setScreen(retryAnalysisRef.current ? "review" : "input");
        setAnalyzePhase(null);
        setImages((current) => current.map((image) => image.status === "recognizing" ? { ...image, status: "pending" } : image));
        setNotice(retryAnalysisRef.current ? "\u5DF2\u505C\u6B62\u7B49\u5F85\uFF1B\u670D\u52A1\u7AEF\u5206\u6790\u53EF\u80FD\u4ECD\u5728\u8FD0\u884C\u6216\u5DF2\u5B8C\u6210\u3002\u8BF7\u5728\u201C\u5206\u6790\u4E0E\u8349\u6848\u4FE1\u606F\u201D\u4E2D\u91CD\u65B0\u52A0\u8F7D\u4F1A\u8BDD\u540E\u518D\u64CD\u4F5C\u3002" : "\u5DF2\u505C\u6B62\u7B49\u5F85\uFF1B\u670D\u52A1\u7AEF\u5206\u6790\u53EF\u80FD\u4ECD\u5728\u8FD0\u884C\u6216\u5DF2\u5B8C\u6210\uFF0C\u65E7\u7ED3\u679C\u4E0D\u4F1A\u81EA\u52A8\u5199\u5165\u754C\u9762\u3002");
      };
      const startManual = () => {
        if (imageReadsRef.current > 0) {
          setError({ code: "image-reading", message: "\u56FE\u7247\u6B63\u5728\u8BFB\u53D6\uFF0C\u8BF7\u7A0D\u540E\u518D\u586B\u5199\u5019\u9009\u3002" });
          return;
        }
        const text = rawText.trim();
        if (text === "") {
          setError({
            code: "input-required",
            message: images.length > 0 ? "\u624B\u52A8\u586B\u5199\u5019\u9009\u9700\u8981\u5148\u5199\u4E0B\u539F\u8BDD\uFF1B\u56FE\u7247\u4F1A\u5728\u300C\u5206\u6790\u610F\u56FE\u300D\u65F6\u8BC6\u522B\u3002" : "\u8BF7\u5148\u7528\u539F\u8BDD\u5199\u4E0B\u4F60\u60F3\u6539\u53D8\u4EC0\u4E48\uFF0C\u518D\u624B\u52A8\u586B\u5199\u5019\u9009"
          });
          return;
        }
        requestRef.current += 1;
        invalidateIdem();
        setError(null);
        setNotice("\u624B\u52A8\u586B\u5199\uFF1A\u6CA1\u6709\u8C03\u7528\u6A21\u578B\u3002\u672A\u4FDD\u5B58\u524D\u4E0D\u4F1A\u521B\u5EFA\u4EFB\u4F55\u4E1C\u897F\uFF1B\u8981\u4FDD\u5B58\u4ECD\u9700\u5148\u62FF\u5230\u670D\u52A1\u7AEF\u4F1A\u8BDD\uFF08\u53EF\u7A0D\u540E\u70B9\u201C\u91CD\u65B0\u5206\u6790\u201D\uFF09\u3002");
        const recognizedMaterial = images.map((image) => {
          const lines = image.data?.lines;
          if (!Array.isArray(lines) || lines.length === 0) return "";
          return `\u56FE\u7247\uFF08${image.name}\uFF09\u8BC6\u522B\u6587\u672C\uFF1A
${lines.map((line) => `${line.ref} ${line.text}`).join("\n")}`;
        }).filter(Boolean).join("\n\n");
        const stub = intentManualSession({
          text,
          source,
          extractedText: [intake.data?.text ?? "", recognizedMaterial].filter(Boolean).join("\n\n"),
          attachment: images.length > 0 ? { name: images.map((image) => image.name).join("\u3001").slice(0, 200), kind: "screenshot" } : attachment ? { name: attachment.name, kind: attachment.kind } : null,
          projectId: projectId ?? project,
          projectName
        });
        aiValuesRef.current = { inputRevision: null, values: {} };
        setSessionView(stub);
        setScreen("review");
      };
      const answerPayload = () => {
        const question = session?.nextQuestion;
        if (!question) return null;
        const optionId = answerChoice && answerChoice !== "unknown" ? answerChoice : void 0;
        const text = answerChoice === "unknown" ? "\u6211\u4E0D\u77E5\u9053\uFF0C\u9700\u8981\u8C03\u67E5" : questionText.trim() === "" ? void 0 : questionText.trim();
        if (optionId === void 0 && text === void 0) return null;
        return { question, optionId, text };
      };
      const stopAnswerPoll = () => {
        answerPollAbortRef.current?.abort();
        answerPollAbortRef.current = null;
        if (answerPollRef.current) {
          clearTimeout(answerPollRef.current);
          answerPollRef.current = null;
        }
      };
      const pollSessionWithTimeout = (sessionId, controllerRef) => {
        const controller = new AbortController();
        controllerRef.current = controller;
        let timeout;
        return Promise.race([
          writeJson("intent", { action: "load", sessionId }, root, { signal: controller.signal }),
          new Promise((_, reject) => {
            timeout = setTimeout(() => {
              reject(controller.signal.aborted ? Object.assign(new Error("\u5DF2\u53D6\u6D88"), { name: "AbortError" }) : new Error("\u8BFB\u53D6\u8D85\u65F6"));
              controller.abort();
            }, 1e4);
          })
        ]).then((value) => {
          if (controller.signal.aborted) throw Object.assign(new Error("\u5DF2\u53D6\u6D88"), { name: "AbortError" });
          return value;
        }).finally(() => {
          clearTimeout(timeout);
          if (controllerRef.current === controller) controllerRef.current = null;
        });
      };
      const pollAnalysis = (sessionId, token, generic = false) => {
        stopAnswerPoll();
        const startedAt = Date.now();
        const tick = () => {
          if (!mountedRef.current || requestRef.current !== token) return;
          if (Date.now() - startedAt > 9e4) {
            setAnalysisMonitorLost(true);
            if (generic) setNotice("\u91CD\u65B0\u5206\u6790\u72B6\u6001\u8BFB\u53D6\u8D85\u65F6\uFF1B\u8BF7\u91CD\u65B0\u52A0\u8F7D\u4F1A\u8BDD\u540E\u6838\u5BF9\u3002");
            else setAnswerFeedback({ kind: "analysis-error", message: "\u56DE\u7B54\u5DF2\u8BB0\u5F55\uFF0C\u4F46\u91CD\u65B0\u5206\u6790\u8D85\u65F6\uFF1B\u53EF\u70B9\u201C\u91CD\u65B0\u5206\u6790\u201D\u91CD\u8BD5\u3002" });
            return;
          }
          pollSessionWithTimeout(sessionId, answerPollAbortRef).then((payload) => {
            if (!mountedRef.current || requestRef.current !== token) return;
            const view = intentView(payload);
            if (!view || view.sessionId !== sessionId) throw new Error("\u8FD4\u56DE\u7684\u4F1A\u8BDD\u4E0E\u5F53\u524D\u4F1A\u8BDD\u4E0D\u4E00\u81F4");
            if (view) applySession(view);
            trackInvestigations(payload);
            const status = intentAnalysisStatus(payload);
            if (!status || !["running", "done", "error"].includes(status.status)) throw new Error("\u91CD\u65B0\u5206\u6790\u72B6\u6001\u672A\u77E5\uFF0C\u8BF7\u6838\u5BF9\u4F1A\u8BDD\u540E\u91CD\u65B0\u5206\u6790");
            if (status.status === "running") {
              answerPollRef.current = setTimeout(tick, 800);
              return;
            }
            answerPollRef.current = null;
            if (status.status === "done") {
              if (generic) setNotice("\u91CD\u65B0\u5206\u6790\u5DF2\u5B8C\u6210\uFF0C\u4F1A\u8BDD\u5DF2\u66F4\u65B0\u3002");
              else setAnswerFeedback({ kind: "success", message: "\u5DF2\u8BB0\u5F55\u4F60\u7684\u56DE\u7B54\uFF0C\u5019\u9009\u5DF2\u66F4\u65B0" });
            } else {
              if (generic) setNotice(`\u91CD\u65B0\u5206\u6790\u5931\u8D25\uFF1A${status.error?.message ?? "\u672A\u77E5\u9519\u8BEF"}\uFF1B\u53EF\u91CD\u65B0\u5206\u6790\u3002`);
              else setAnswerFeedback({ kind: "analysis-error", message: `\u56DE\u7B54\u5DF2\u8BB0\u5F55\uFF0C\u4F46\u91CD\u65B0\u5206\u6790\u5931\u8D25\uFF1A${status.error?.message ?? "\u672A\u77E5\u9519\u8BEF"}\uFF1B\u53EF\u70B9\u201C\u91CD\u65B0\u5206\u6790\u201D\u3002` });
            }
          }).catch((caught) => {
            if (!mountedRef.current || requestRef.current !== token) return;
            if (caught?.name === "AbortError") return;
            answerPollRef.current = null;
            setAnalysisMonitorLost(true);
            if (generic) setNotice(`\u5237\u65B0\u4F1A\u8BDD\u5931\u8D25\uFF1A${caught.message ?? caught}\uFF1B\u8BF7\u91CD\u65B0\u52A0\u8F7D\u4F1A\u8BDD\u3002`);
            else setAnswerFeedback({ kind: "analysis-error", message: `\u56DE\u7B54\u5DF2\u8BB0\u5F55\uFF0C\u4F46\u5237\u65B0\u4F1A\u8BDD\u5931\u8D25\uFF1A${caught.message ?? caught}` });
          });
        };
        answerPollRef.current = setTimeout(tick, 600);
      };
      const submitAnswer = () => {
        const payload = answerPayload();
        if (!payload || answerBusy || !session?.sessionId) return;
        stopAnswerPoll();
        const token = beginRequest();
        const controller = new AbortController();
        answerAbortRef.current = controller;
        setAnswerBusy(true);
        setAnswerElapsed(0);
        setAnswerFeedback(null);
        setAnswerCheck(null);
        setError(null);
        startTimer(answerTimerRef, () => setAnswerElapsed((current) => current + 1));
        const body = {
          action: "answer",
          sessionId: session.sessionId,
          expectedInputRevision: session.input?.inputRevision ?? 0,
          questionId: payload.question.questionId
        };
        if (typeof session.sessionRevision === "number") body.expectedSessionRevision = session.sessionRevision;
        if (payload.optionId !== void 0) body.optionId = payload.optionId;
        if (payload.text !== void 0) body.text = payload.text;
        writeJson("intent", body, root, { signal: controller.signal }).then((response) => {
          if (answerAbortRef.current !== controller) return;
          answerAbortRef.current = null;
          stopTimer(answerTimerRef);
          if (!isCurrent(token)) {
            setAnswerBusy(false);
            return;
          }
          setAnswerBusy(false);
          setAnswerChoice(null);
          setQuestionText("");
          invalidateIdem();
          const view = intentView(response);
          if (view) applySession(view);
          trackInvestigations(response);
          const status = intentAnalysisStatus(response);
          if (status?.status === "running") {
            setAnswerFeedback({ kind: "success", message: "\u5DF2\u8BB0\u5F55\u4F60\u7684\u56DE\u7B54\uFF0C\u6B63\u5728\u66F4\u65B0\u5019\u9009\u2026" });
            pollAnalysis(session.sessionId, token);
          } else if (status?.status === "error") {
            setAnswerFeedback({ kind: "analysis-error", message: `\u56DE\u7B54\u5DF2\u8BB0\u5F55\uFF0C\u4F46\u91CD\u65B0\u5206\u6790\u5931\u8D25\uFF1A${status.error?.message ?? "\u672A\u77E5\u9519\u8BEF"}\uFF1B\u53EF\u70B9\u201C\u91CD\u65B0\u5206\u6790\u201D\u3002` });
          } else if (status?.status === "done") {
            setAnswerFeedback({ kind: "success", message: "\u5DF2\u8BB0\u5F55\u4F60\u7684\u56DE\u7B54\uFF0C\u5DF2\u66F4\u65B0\u5019\u9009" });
          } else {
            setAnswerFeedback({ kind: "analysis-error", message: "\u56DE\u7B54\u5DF2\u8BB0\u5F55\uFF0C\u4F46\u91CD\u65B0\u5206\u6790\u72B6\u6001\u672A\u77E5\uFF1B\u8BF7\u6838\u5BF9\u4F1A\u8BDD\u540E\u91CD\u65B0\u5206\u6790\u3002" });
          }
        }).catch((caught) => {
          if (answerAbortRef.current !== controller) return;
          answerAbortRef.current = null;
          stopTimer(answerTimerRef);
          if (!isCurrent(token)) {
            setAnswerBusy(false);
            return;
          }
          setAnswerBusy(false);
          if (caught?.name === "AbortError" || !Number.isInteger(caught?.status) || caught.status === 408 || caught.status >= 500) {
            setAnswerFeedback({ kind: "uncertain", message: "\u672A\u6536\u5230\u63D0\u4EA4\u7ED3\u679C\uFF0C\u56DE\u7B54\u53EF\u80FD\u5DF2\u4FDD\u5B58\uFF1B\u5DF2\u9009\u5185\u5BB9\u4ECD\u4FDD\u7559\uFF0C\u8BF7\u5148\u6838\u5BF9\u670D\u52A1\u7AEF\u4F1A\u8BDD\u518D\u63D0\u4EA4\u3002" });
            return;
          }
          const info = errorOf(caught);
          setAnswerFeedback({ kind: "error", message: `\u63D0\u4EA4\u5931\u8D25\uFF1A${info.message}`, retry: true });
          if (info.code === "stale-input" || info.code === "stale-context" || info.code === "stale-session") {
            const historyToken = historyRequestRef.current, scope = historyScope;
            const current = () => isCurrent(token) && historyCurrent(historyToken, scope) && sessionRef.current?.sessionId === session.sessionId;
            setNotice(`\u4F1A\u8BDD\u5DF2\u53D8\u5316\uFF08${info.message}\uFF09\uFF1B\u6B63\u5728\u8BFB\u53D6\u6700\u65B0\u4F1A\u8BDD\uFF0C\u672C\u5730\u56DE\u7B54\u4ECD\u4FDD\u7559\u3002`);
            loadLatestSession(session.sessionId).then((result) => {
              const view = result?.view;
              if (!current()) return;
              if (!view || view.sessionId !== session.sessionId) throw new Error("\u4F1A\u8BDD\u4E0D\u5339\u914D");
              applySession(view);
              setAnswerChoice(null);
              setNotice("\u5DF2\u8BFB\u53D6\u6700\u65B0\u4F1A\u8BDD\uFF1B\u8BF7\u6838\u5BF9\u95EE\u9898\u548C\u4FDD\u7559\u7684\u6587\u5B57\u540E\u91CD\u65B0\u4F5C\u7B54\u3002");
              if (result.payload) trackInvestigations(result.payload);
            }).catch(() => {
              if (current()) setNotice("\u4F1A\u8BDD\u5DF2\u53D8\u5316\uFF0C\u8BFB\u53D6\u6700\u65B0\u4F1A\u8BDD\u5931\u8D25\uFF1B\u672C\u5730\u56DE\u7B54\u4ECD\u4FDD\u7559\uFF0C\u8BF7\u91CD\u65B0\u6253\u5F00\u4F1A\u8BDD\u6838\u5BF9\u3002");
            });
          }
        });
      };
      const cancelAnswer = () => {
        const controller = answerAbortRef.current;
        answerAbortRef.current = null;
        if (controller) {
          try {
            controller.abort();
          } catch {
          }
        }
        stopTimer(answerTimerRef);
        setAnswerBusy(false);
        setAnswerFeedback({ kind: "uncertain", message: "\u5DF2\u505C\u6B62\u7B49\u5F85\uFF0C\u56DE\u7B54\u53EF\u80FD\u5DF2\u4FDD\u5B58\uFF1B\u5DF2\u9009\u5185\u5BB9\u4ECD\u4FDD\u7559\uFF0C\u8BF7\u5148\u6838\u5BF9\u670D\u52A1\u7AEF\u4F1A\u8BDD\u518D\u63D0\u4EA4\u3002" });
      };
      const questionGroupOf = () => {
        const group = sessionRef.current?.questionGroup ?? session?.questionGroup;
        const questions = Array.isArray(group?.questions) ? group.questions.filter((question) => question && question.questionId && typeof question.text === "string") : [];
        const recommendations = Array.isArray(group?.recommendations) ? group.recommendations.filter((question) => question && question.questionId && typeof question.text === "string") : [];
        if (!group || questions.length === 0 && recommendations.length === 0) return null;
        return { ...group, questions, recommendations };
      };
      const activeAnswerOf = (questionId) => {
        const list = session?.answers ?? [];
        for (let index = list.length - 1; index >= 0; index -= 1) {
          const entry = list[index];
          if (!entry || entry.supersededBy) continue;
          if (entry.questionId === questionId) return entry;
        }
        return null;
      };
      const lastAnswerOf = (questionId) => {
        const list = session?.answers ?? [];
        for (let index = list.length - 1; index >= 0; index -= 1) {
          const entry = list[index];
          if (entry && entry.questionId === questionId) return entry;
        }
        return null;
      };
      const groupDraftFor = (question) => {
        const edited = groupDrafts[question.questionId];
        if (edited) return edited;
        const active = activeAnswerOf(question.questionId);
        const answer = active ?? (question.status === "stale" ? lastAnswerOf(question.questionId) : null);
        const answerText = typeof answer?.text === "string" ? answer.text : "";
        return {
          optionId: answer?.optionId ?? null,
          text: answerText,
          undecided: !answer?.optionId && answerText === "\u5C1A\u4E0D\u80FD\u51B3\u5B9A\uFF0C\u9700\u8981\u8C03\u67E5",
          stalePrefill: Boolean(!active && answer)
        };
      };
      const groupProgressOf = (group) => {
        const stats = { total: 0, open: 0, answered: 0, stale: 0, pending: 0 };
        for (const question of group?.questions ?? []) {
          stats.total += 1;
          if (question.status === "answered") stats.answered += 1;
          else if (question.status === "stale") stats.stale += 1;
          else stats.open += 1;
        }
        stats.pending = stats.open + stats.stale;
        return stats;
      };
      const groupProgressText = (progress) => {
        const segments = [`\u5F85\u51B3\u5B9A ${progress.open} \u9879`, `\u5DF2\u5904\u7406 ${progress.answered} \u9879`];
        if (progress.stale > 0) segments.push(`\u5F85\u91CD\u65B0\u6838\u5BF9 ${progress.stale} \u9879`);
        return segments.join(" \xB7 ");
      };
      const groupInteractionLocked = () => groupBusy || groupFeedback?.kind === "running";
      const setGroupDraft = (questionId, patch) => {
        if (groupInteractionLocked()) return;
        setGroupFeedback(null);
        setAnswerCheck(null);
        setGroupDrafts((current) => {
          const base = current[questionId] ?? { optionId: null, text: "", undecided: false };
          return { ...current, [questionId]: { ...base, ...patch } };
        });
      };
      const groupAnswersPayload = (group) => {
        const list = [];
        for (const question of [...group?.questions ?? [], ...group?.recommendations ?? []]) {
          if (question.status === "answered" && editingQuestionId !== question.questionId) continue;
          const draft = groupDrafts[question.questionId] ?? (question.status === "stale" ? groupDraftFor(question) : null);
          if (!draft) continue;
          const text = String(draft.text ?? "").trim();
          if (draft.undecided) {
            list.push({ questionId: question.questionId, text: text || "\u5C1A\u4E0D\u80FD\u51B3\u5B9A\uFF0C\u9700\u8981\u8C03\u67E5" });
            continue;
          }
          if (!draft.optionId && text === "") continue;
          const entry = { questionId: question.questionId };
          if (draft.optionId) entry.optionId = draft.optionId;
          if (text !== "") entry.text = text;
          list.push(entry);
        }
        return list.slice(0, 3);
      };
      const stopGroupPoll = () => {
        groupPollAbortRef.current?.abort();
        groupPollAbortRef.current = null;
        if (groupPollRef.current) {
          clearTimeout(groupPollRef.current);
          groupPollRef.current = null;
        }
      };
      const groupTimingText = (payload) => {
        const view = intentView(payload) ?? sessionRef.current;
        const last = view?.timingSummary?.lastRun;
        if (!last) return null;
        const total = Number(last.totalMs);
        if (!Number.isFinite(total) || total < 0) return null;
        const model = Number(last.modelMs);
        if (Number.isFinite(model) && model >= 0) return `\u672C\u8F6E\u5206\u6790 ${Math.round(total / 1e3)}s\uFF08\u6A21\u578B ${Math.round(model / 1e3)}s\uFF09`;
        return `\u672C\u8F6E\u5206\u6790 ${Math.round(total / 1e3)}s`;
      };
      const pollGroupAnalysis = (sessionId, token, savedInfo) => {
        stopGroupPoll();
        const startedAt = Date.now();
        const tick = () => {
          if (!mountedRef.current || requestRef.current !== token) return;
          const elapsed = Math.round((Date.now() - startedAt) / 1e3);
          pollSessionWithTimeout(sessionId, groupPollAbortRef).then((payload) => {
            if (!mountedRef.current || requestRef.current !== token) return;
            const view = intentView(payload);
            if (!view || view.sessionId !== sessionId) throw new Error("\u8FD4\u56DE\u7684\u4F1A\u8BDD\u4E0E\u5F53\u524D\u4F1A\u8BDD\u4E0D\u4E00\u81F4");
            if (view) applySession(view);
            trackInvestigations(payload);
            const status = intentAnalysisStatus(payload);
            if (!status || !["running", "done", "error"].includes(status.status)) throw new Error("\u91CD\u65B0\u5206\u6790\u72B6\u6001\u672A\u77E5\uFF0C\u8BF7\u6838\u5BF9\u4F1A\u8BDD\u540E\u91CD\u65B0\u5206\u6790");
            if (status.status === "running") {
              if (elapsed >= 90) {
                setAnalysisMonitorLost(true);
                setGroupFeedback({ kind: "timeout", ...savedInfo, elapsed, message: "\u56DE\u7B54\u5DF2\u4FDD\u5B58\uFF0C\u4F46\u91CD\u65B0\u5206\u6790\u8D85\u65F6\u3002", retryAnalysis: true });
                return;
              }
              setGroupFeedback({ kind: "running", ...savedInfo, elapsed });
              groupPollRef.current = setTimeout(tick, 800);
              return;
            }
            groupPollRef.current = null;
            if (status.status === "error") {
              setGroupFeedback({ kind: "analysis-error", ...savedInfo, elapsed, message: `\u91CD\u65B0\u5206\u6790\u5931\u8D25\uFF1A${status.error?.message ?? "\u672A\u77E5\u9519\u8BEF"}`, timing: groupTimingText(payload), retryAnalysis: true });
              return;
            }
            setGroupFeedback({ kind: "done", ...savedInfo, elapsed, timing: groupTimingText(payload) });
          }).catch((caught) => {
            if (!mountedRef.current || requestRef.current !== token) return;
            if (caught?.name === "AbortError") return;
            groupPollRef.current = null;
            setAnalysisMonitorLost(true);
            const info = errorOf(caught);
            setGroupFeedback({ kind: "analysis-error", ...savedInfo, elapsed, message: `\u56DE\u7B54\u5DF2\u4FDD\u5B58\uFF0C\u4F46\u5237\u65B0\u4F1A\u8BDD\u5931\u8D25\uFF1A${info.message}`, retryAnalysis: true });
          });
        };
        groupPollRef.current = setTimeout(tick, 800);
      };
      const submitGroupAnswers = () => {
        const group = questionGroupOf();
        if (!group || groupInteractionLocked()) return;
        if (!session?.sessionId) {
          setGroupFeedback({ kind: "error", message: "\u624B\u52A8\u4F1A\u8BDD\u8FD8\u6CA1\u6709\u670D\u52A1\u7AEF\u4F1A\u8BDD\uFF1B\u5148\u201C\u91CD\u65B0\u5206\u6790\u201D\u62FF\u5230\u4F1A\u8BDD\u540E\u518D\u63D0\u4EA4\u56DE\u7B54\u3002" });
          return;
        }
        const answers = groupAnswersPayload(group);
        if (answers.length === 0) {
          setGroupFeedback({ kind: "error", message: "\u5148\u9009\u62E9\u9009\u9879\u6216\u5199\u4E0B\u56DE\u7B54\uFF0C\u518D\u63D0\u4EA4\u672C\u7EC4\u56DE\u7B54\u3002" });
          return;
        }
        stopGroupPoll();
        stopAnswerPoll();
        const token = beginRequest();
        const controller = new AbortController();
        answerAbortRef.current = controller;
        const startedAt = Date.now();
        setGroupBusy(true);
        setGroupElapsed(0);
        setGroupFeedback(null);
        setAnswerCheck(null);
        setError(null);
        setAnswerFeedback(null);
        startTimer(groupTimerRef, () => setGroupElapsed((current) => current + 1));
        const body = {
          action: "answer",
          sessionId: session.sessionId,
          expectedInputRevision: session.input?.inputRevision ?? 0,
          answers
        };
        if (typeof session.sessionRevision === "number") body.expectedSessionRevision = session.sessionRevision;
        writeJson("intent", body, root, { signal: controller.signal }).then((response) => {
          if (answerAbortRef.current !== controller) return;
          answerAbortRef.current = null;
          stopTimer(groupTimerRef);
          if (!isCurrent(token)) {
            setGroupBusy(false);
            return;
          }
          setGroupBusy(false);
          invalidateIdem();
          const saveMs = Math.max(0, Date.now() - startedAt);
          const view = intentView(response);
          if (view) applySession(view);
          trackInvestigations(response);
          const savedCount = Array.isArray(response?.saved) ? response.saved.length : answers.length;
          const savedInfo = { count: savedCount, saveMs };
          setGroupDrafts((current) => {
            const next = { ...current };
            for (const answer of answers) delete next[answer.questionId];
            return next;
          });
          setEditingQuestionId(null);
          const status = intentAnalysisStatus(response);
          if (status?.status === "running") {
            setGroupFeedback({ kind: "running", ...savedInfo, elapsed: 0 });
            pollGroupAnalysis(session.sessionId, token, savedInfo);
            return;
          }
          if (status?.status === "error") {
            setGroupFeedback({ kind: "analysis-error", ...savedInfo, elapsed: 0, message: `\u91CD\u65B0\u5206\u6790\u5931\u8D25\uFF1A${status.error?.message ?? "\u672A\u77E5\u9519\u8BEF"}`, timing: groupTimingText(response), retryAnalysis: true });
            return;
          }
          if (status?.status !== "done") {
            setGroupFeedback({ kind: "analysis-error", ...savedInfo, elapsed: 0, message: "\u56DE\u7B54\u5DF2\u4FDD\u5B58\uFF0C\u4F46\u91CD\u65B0\u5206\u6790\u72B6\u6001\u672A\u77E5\uFF1B\u8BF7\u6838\u5BF9\u4F1A\u8BDD\u540E\u91CD\u65B0\u5206\u6790\u3002", retryAnalysis: true });
            return;
          }
          setGroupFeedback({ kind: "done", ...savedInfo, elapsed: 0, timing: groupTimingText(response) });
        }).catch((caught) => {
          if (answerAbortRef.current !== controller) return;
          answerAbortRef.current = null;
          stopTimer(groupTimerRef);
          if (!isCurrent(token)) {
            setGroupBusy(false);
            return;
          }
          setGroupBusy(false);
          if (caught?.name === "AbortError" || !Number.isInteger(caught?.status) || caught.status === 408 || caught.status >= 500) {
            setGroupFeedback({ kind: "uncertain", message: "\u672A\u6536\u5230\u63D0\u4EA4\u7ED3\u679C\uFF0C\u56DE\u7B54\u53EF\u80FD\u5DF2\u4FDD\u5B58\uFF1B\u8349\u7A3F\u4ECD\u4FDD\u7559\uFF0C\u8BF7\u5148\u6838\u5BF9\u670D\u52A1\u7AEF\u4F1A\u8BDD\u518D\u63D0\u4EA4\u3002" });
            return;
          }
          const info = errorOf(caught);
          setGroupFeedback({ kind: "save-error", message: `\u63D0\u4EA4\u5931\u8D25\uFF1A${info.message}`, retry: true });
          if (info.code === "stale-input" || info.code === "stale-context" || info.code === "stale-session") {
            const historyToken = historyRequestRef.current, scope = historyScope;
            const current = () => isCurrent(token) && historyCurrent(historyToken, scope) && sessionRef.current?.sessionId === session.sessionId;
            setNotice(`\u4F1A\u8BDD\u5DF2\u53D8\u5316\uFF08${info.message}\uFF09\uFF1B\u6B63\u5728\u8BFB\u53D6\u6700\u65B0\u4F1A\u8BDD\uFF0C\u672C\u5730\u56DE\u7B54\u4ECD\u4FDD\u7559\u3002`);
            loadLatestSession(session.sessionId).then((result) => {
              const view = result?.view;
              if (!current()) return;
              if (!view || view.sessionId !== session.sessionId) throw new Error("\u4F1A\u8BDD\u4E0D\u5339\u914D");
              applySession(view);
              setNotice("\u5DF2\u8BFB\u53D6\u6700\u65B0\u4F1A\u8BDD\uFF1B\u8BF7\u6838\u5BF9\u95EE\u9898\u548C\u4FDD\u7559\u7684\u56DE\u7B54\u540E\u91CD\u8BD5\u3002");
              if (result.payload) trackInvestigations(result.payload);
            }).catch(() => {
              if (current()) setNotice("\u4F1A\u8BDD\u5DF2\u53D8\u5316\uFF0C\u8BFB\u53D6\u6700\u65B0\u4F1A\u8BDD\u5931\u8D25\uFF1B\u672C\u5730\u56DE\u7B54\u4ECD\u4FDD\u7559\uFF0C\u8BF7\u91CD\u65B0\u6253\u5F00\u4F1A\u8BDD\u6838\u5BF9\u3002");
            });
          }
        });
      };
      const cancelGroupSubmit = () => {
        const controller = answerAbortRef.current;
        answerAbortRef.current = null;
        if (controller) {
          try {
            controller.abort();
          } catch {
          }
        }
        stopTimer(groupTimerRef);
        setGroupBusy(false);
        setGroupFeedback({ kind: "uncertain", message: "\u5DF2\u505C\u6B62\u7B49\u5F85\uFF0C\u56DE\u7B54\u53EF\u80FD\u5DF2\u4FDD\u5B58\uFF1B\u8349\u7A3F\u4ECD\u4FDD\u7559\uFF0C\u8BF7\u5148\u6838\u5BF9\u670D\u52A1\u7AEF\u4F1A\u8BDD\u518D\u63D0\u4EA4\u3002" });
      };
      const jumpToCandidate = () => {
        const node = candidateRef.current;
        node?.querySelectorAll?.("[data-intent-candidate]")?.forEach((detail) => {
          detail.open = true;
        });
        if (node && typeof node.scrollIntoView === "function") node.scrollIntoView({ block: "start", behavior: REDUCE_MOTION ? "auto" : "smooth" });
      };
      const startEditingQuestion = (questionId) => {
        setEditingQuestionId(questionId);
        const panel2 = groupPanelRef.current;
        if (!panel2 || typeof panel2.querySelector !== "function") return;
        const node = panel2.querySelector(`[data-question-id="${questionId}"]`);
        if (node && typeof node.scrollIntoView === "function") node.scrollIntoView({ block: "center", behavior: REDUCE_MOTION ? "auto" : "smooth" });
      };
      const toggleDraftBar = () => {
        const next = !draftBarExpanded;
        setDraftBarExpanded(next);
        if (!next) return;
        if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => jumpToCandidate());
        else jumpToCandidate();
      };
      const mergeInvestigations = (list) => {
        if (!Array.isArray(list) || list.length === 0) return;
        setInvestigations((current) => {
          const seen = /* @__PURE__ */ new Map();
          for (const entry of [...list, ...current]) {
            const id = intentInvestigationId(entry);
            if (!id || seen.has(id)) continue;
            seen.set(id, entry);
          }
          return [...seen.values()].slice(0, 20);
        });
      };
      const startInvestigation = (focus) => {
        const current = sessionRef.current;
        if (!current?.sessionId) return;
        const question = current.nextQuestion;
        const questionId = question?.questionId ?? null;
        const text = String(focus ?? question?.text ?? "").trim();
        if (text === "") return;
        if (investAbortRef.current) {
          try {
            investAbortRef.current.abort();
          } catch {
          }
        }
        const controller = new AbortController();
        investAbortRef.current = controller;
        const scope = historyScope;
        const revision = current.input?.inputRevision;
        const stillCurrent = () => mountedRef.current && historyScopeRef.current === scope && sessionRef.current?.sessionId === current.sessionId && sessionRef.current?.input?.inputRevision === revision;
        setInvestigation({ open: true, busy: true, elapsed: 0, error: null, data: null, question: { questionId, text }, expandedId: null });
        startTimer(investTimerRef, () => {
          setInvestigation((current2) => ({ ...current2, elapsed: current2.elapsed + 1 }));
        });
        const body = {
          action: "investigate",
          sessionId: current.sessionId,
          expectedInputRevision: revision,
          questionId,
          question: text
        };
        writeJson("intent", body, root, { signal: controller.signal }).then((payload) => {
          if (investAbortRef.current !== controller) return;
          investAbortRef.current = null;
          stopTimer(investTimerRef);
          if (!stillCurrent()) {
            if (mountedRef.current && historyScopeRef.current === scope) setInvestigation({ open: false, busy: false, elapsed: 0, error: null, data: null, question: null, expandedId: null });
            return;
          }
          const data = payload?.investigation ?? payload?.data?.investigation ?? null;
          if (!data || data.sessionId !== current.sessionId || data.inputRevision !== revision) {
            setInvestigation((state) => ({ ...state, busy: false, error: { message: "\u8C03\u67E5\u7ED3\u679C\u4E0E\u5F53\u524D\u8F93\u5165\u4E0D\u4E00\u81F4\uFF0C\u8BF7\u91CD\u65B0\u8C03\u67E5\u3002" } }));
            return;
          }
          mergeInvestigations([data, ...intentInvestigationList(payload)]);
          setInvestigation((state) => ({ ...state, busy: false, error: null, data }));
        }).catch((caught) => {
          if (investAbortRef.current !== controller) return;
          investAbortRef.current = null;
          stopTimer(investTimerRef);
          if (!stillCurrent()) {
            if (mountedRef.current && historyScopeRef.current === scope) setInvestigation({ open: false, busy: false, elapsed: 0, error: null, data: null, question: null, expandedId: null });
            return;
          }
          if (caught?.name === "AbortError") {
            setInvestigation((state) => ({ ...state, busy: false, error: { code: "cancelled", message: "\u5DF2\u505C\u6B62\u7B49\u5F85\uFF1B\u670D\u52A1\u7AEF\u8C03\u67E5\u53EF\u80FD\u4ECD\u5728\u5B8C\u6210\uFF0C\u8BF7\u91CD\u65B0\u52A0\u8F7D\u4F1A\u8BDD\u6838\u5BF9\u3002" } }));
            return;
          }
          const info = errorOf(caught);
          const hint = info.code === "outside-root" ? "\u5F53\u524D\u9879\u76EE\u7684\u53EF\u8BFB\u8FB9\u754C\u4E4B\u5916\u7684\u5185\u5BB9\u4E0D\u4F1A\u88AB\u8BFB\u53D6\uFF0C\u8BF7\u7F29\u5C0F\u5230\u672C\u9879\u76EE\u3002" : info.code === "too-large" ? "\u95EE\u9898\u592A\u5927\uFF0C\u8BF7\u628A\u95EE\u9898\u7F29\u5C0F\u5230\u4E00\u4E2A\u5177\u4F53\u884C\u4E3A\u6216\u6587\u4EF6\u3002" : info.code === "no-question" ? "\u8BF7\u5148\u5199\u4E0B\u8981\u8C03\u67E5\u7684\u95EE\u9898\u3002" : info.status === 503 ? "\u6A21\u578B\u6682\u4E0D\u53EF\u7528\uFF0C\u7A0D\u540E\u91CD\u8BD5\uFF1B\u8FD9\u4E0D\u4F1A\u5F71\u54CD\u4F60\u5DF2\u7ECF\u586B\u5199\u7684\u5185\u5BB9\u3002" : info.status === 502 ? "\u6A21\u578B\u8FD9\u6B21\u6CA1\u6709\u7ED9\u51FA\u53EF\u6821\u9A8C\u7684\u8BC1\u636E\uFF0C\u7A0D\u540E\u91CD\u8BD5\u3002" : null;
          setInvestigation((state) => ({ ...state, busy: false, error: { ...info, hint } }));
        });
      };
      const cancelInvestigation = () => {
        const controller = investAbortRef.current;
        investAbortRef.current = null;
        if (controller) {
          try {
            controller.abort();
          } catch {
          }
        }
        stopTimer(investTimerRef);
        setInvestigation((state) => ({ ...state, busy: false, error: { code: "cancelled", message: "\u5DF2\u505C\u6B62\u7B49\u5F85\uFF1B\u670D\u52A1\u7AEF\u8C03\u67E5\u53EF\u80FD\u4ECD\u5728\u5B8C\u6210\uFF0C\u8BF7\u91CD\u65B0\u52A0\u8F7D\u4F1A\u8BDD\u6838\u5BF9\u3002" } }));
      };
      const reanalyzeWithEvidence = (entry) => {
        const id = intentInvestigationId(entry);
        if (!id || entry?.sessionId !== sessionRef.current?.sessionId || !Number.isSafeInteger(entry?.inputRevision) || entry.inputRevision !== sessionRef.current?.input?.inputRevision) {
          setNotice("\u8FD9\u6761\u8C03\u67E5\u4E0D\u5C5E\u4E8E\u5F53\u524D\u8F93\u5165\u7248\u672C\uFF1B\u8BF7\u5148\u8C03\u67E5\u5F53\u524D\u95EE\u9898\u3002");
          return;
        }
        setInvestigation((state) => ({ ...state, open: false }));
        runAnalyze({ investigationIds: [id] });
      };
      const loadLatestSession = (sessionId) => {
        const controller = new AbortController();
        let timer;
        return Promise.race([
          fetch(`/api/alm/requirements/intent?session=${encodeURIComponent(sessionId)}&project=${encodeURIComponent(explicitProject ?? "")}&root=${encodeURIComponent(root)}`, {
            headers: { accept: "application/json" },
            signal: controller.signal
          }).then(async (response) => {
            const payload = await response.json().catch(() => null);
            if (!response.ok || payload?.ok === false) throw new Error(payload?.error?.message ?? `HTTP ${response.status}`);
            return { view: intentView(payload), payload };
          }),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              reject(new Error("\u8BFB\u53D6\u8D85\u65F6"));
              controller.abort();
            }, 1e4);
          })
        ]).finally(() => clearTimeout(timer));
      };
      const checkAnswerSession = async () => {
        const current = sessionRef.current;
        if (!current?.sessionId || answerCheck?.loading) return;
        const token = requestRef.current;
        const historyToken = historyRequestRef.current;
        const scope = historyScope;
        const stillCurrent = () => isCurrent(token) && historyCurrent(historyToken, scope) && sessionRef.current?.sessionId === current.sessionId;
        setAnswerCheck({ loading: true });
        try {
          const result = await loadLatestSession(current.sessionId);
          if (!stillCurrent()) return;
          if (result.view?.sessionId !== current.sessionId) throw new Error("\u8FD4\u56DE\u7684\u4F1A\u8BDD\u4E0E\u5F53\u524D\u4F1A\u8BDD\u4E0D\u4E00\u81F4");
          if (!Array.isArray(result.view.answers) || result.view.answers.some((answer) => !answer || typeof answer !== "object" || Array.isArray(answer) || ["answerId", "questionText", "optionLabel", "optionId", "text"].some((key) => answer[key] != null && typeof answer[key] !== "string"))) throw new Error("\u4F1A\u8BDD\u56DE\u7B54\u4E0D\u53EF\u7528");
          setAnswerCheck({ answers: result.view.answers });
        } catch (caught) {
          if (stillCurrent()) setAnswerCheck({ error: caught?.message ?? "\u8BFB\u53D6\u5931\u8D25" });
        }
      };
      const renderAnswerCheck = () => h(
        "div",
        { style: { flexBasis: "100%", fontSize: "12px", color: T.text2, lineHeight: 1.7 } },
        h("button", { type: "button", style: button, disabled: answerCheck?.loading, onClick: checkAnswerSession }, answerCheck?.loading ? "\u8BFB\u53D6\u4E2D\u2026" : "\u6838\u5BF9\u670D\u52A1\u7AEF\u56DE\u7B54"),
        answerCheck?.error ? h("p", { role: "alert" }, `\u6838\u5BF9\u5931\u8D25\uFF1A${answerCheck.error}\uFF1B\u672C\u5730\u8F93\u5165\u4ECD\u4FDD\u7559\u3002`) : null,
        answerCheck?.answers ? h(
          "div",
          { role: "status" },
          h("p", null, "\u4EE5\u4E0B\u4E3A\u8BFB\u53D6\u65F6\u5DF2\u8BB0\u5F55\u7684\u56DE\u7B54\uFF1B\u5148\u524D\u8BF7\u6C42\u4ECD\u53EF\u80FD\u5728\u8BFB\u53D6\u540E\u5B8C\u6210\u3002"),
          answerCheck.answers.length ? h("ul", null, answerCheck.answers.map((answer, index) => h("li", { key: answer.answerId ?? index }, [answer.questionText, answer.optionLabel ?? answer.optionId, answer.text].filter(Boolean).join(" \xB7 ") || "\u56DE\u7B54\u5185\u5BB9\u4E0D\u53EF\u7528"))) : h("p", null, "\u8BFB\u53D6\u65F6\u5C1A\u65E0\u5DF2\u8BB0\u5F55\u7684\u56DE\u7B54\u3002")
        ) : null
      );
      const sendEdit = (fields, itemId, strict = false) => {
        const current = sessionRef.current;
        if (!current?.sessionId) return Promise.resolve(null);
        const body = {
          action: "edit",
          sessionId: current.sessionId,
          expectedInputRevision: current.input?.inputRevision ?? 0,
          fields
        };
        if (itemId) body.itemId = itemId;
        const historyToken = historyRequestRef.current;
        const scope = historyScope;
        const editGeneration = ++editGenerationRef.current;
        editPendingRef.current += 1;
        setEditBusy(true);
        const run = () => {
          if (!historyCurrent(historyToken, scope)) return null;
          if (adoptionUncertainRef.current) throw new Error("\u8C03\u67E5\u91C7\u7EB3\u7ED3\u679C\u672A\u77E5\uFF0C\u8BF7\u5148\u91CD\u65B0\u52A0\u8F7D\u4F1A\u8BDD\u6838\u5BF9\uFF0C\u518D\u4FDD\u5B58\u7F16\u8F91\u3002");
          const revision = sessionRef.current?.input?.inputRevision ?? 0;
          if (sessionRef.current?.sessionId !== current.sessionId) throw new Error("\u4F1A\u8BDD\u5728\u4FDD\u5B58\u671F\u95F4\u53D1\u751F\u53D8\u5316\uFF0C\u8BF7\u786E\u8BA4\u5F53\u524D\u5185\u5BB9\u540E\u91CD\u8BD5\u3002");
          return writeJson("intent", { ...body, expectedInputRevision: revision, expectedSessionRevision: sessionRef.current?.sessionRevision ?? null }, root).then((payload) => {
            if (!historyCurrent(historyToken, scope)) return null;
            const view = intentView(payload);
            const live = sessionRef.current;
            if (!view || live?.sessionId !== current.sessionId || (live?.input?.inputRevision ?? 0) !== revision) {
              if (strict) throw new Error("\u4F1A\u8BDD\u5728\u4FDD\u5B58\u671F\u95F4\u53D1\u751F\u53D8\u5316\uFF0C\u8BF7\u786E\u8BA4\u5F53\u524D\u5185\u5BB9\u540E\u91CD\u8BD5\u3002");
              return null;
            }
            sessionRef.current = view;
            setSession(view);
            return view;
          });
        };
        const queued = editQueueRef.current.then(run, run);
        editQueueRef.current = queued.catch(() => {
        });
        return queued.catch((caught) => {
          if (!historyCurrent(historyToken, scope)) return null;
          const info = errorOf(caught);
          setError(info);
          if (info.code === "stale-input" || info.code === "stale-context" || info.code === "stale-session") {
            const pendingNotice = `\u4F1A\u8BDD\u5DF2\u53D8\u5316\uFF08${info.message}\uFF09\uFF1B\u6B63\u5728\u91CD\u65B0\u8BFB\u53D6\uFF0C\u8BF7\u518D\u786E\u8BA4\u4E00\u6B21\u3002`;
            setNotice(pendingNotice);
            invalidateIdem();
            const sessionAtConflict = sessionRef.current;
            const currentRead = () => historyCurrent(historyToken, scope) && editGenerationRef.current === editGeneration && sessionRef.current === sessionAtConflict && sessionAtConflict?.sessionId === current.sessionId;
            const noteNewerSession = () => {
              if (historyCurrent(historyToken, scope) && sessionRef.current?.sessionId === current.sessionId) {
                setNotice((notice2) => notice2 === pendingNotice ? "\u4F1A\u8BDD\u5728\u8BFB\u53D6\u671F\u95F4\u518D\u6B21\u53D8\u5316\uFF0C\u8BF7\u6838\u5BF9\u5F53\u524D\u7F16\u8F91\u3002" : notice2);
              }
            };
            loadLatestSession(current.sessionId).then((result) => {
              if (!currentRead()) {
                noteNewerSession();
                return;
              }
              const view = result?.view;
              if (!view || view.sessionId !== current.sessionId) throw new Error("\u8FD4\u56DE\u7684\u4F1A\u8BDD\u4E0E\u5F53\u524D\u4F1A\u8BDD\u4E0D\u4E00\u81F4");
              applySession(view);
              if (result?.payload) trackInvestigations(result.payload);
              setNotice("\u4F1A\u8BDD\u5DF2\u91CD\u65B0\u8BFB\u53D6\uFF0C\u8BF7\u6838\u5BF9\u5F53\u524D\u7F16\u8F91\u540E\u91CD\u8BD5\u3002");
            }).catch(() => {
              if (currentRead()) setNotice("\u4F1A\u8BDD\u5DF2\u53D8\u5316\uFF0C\u91CD\u65B0\u8BFB\u53D6\u5931\u8D25\uFF1B\u5F53\u524D\u586B\u5199\u4ECD\u4FDD\u7559\uFF0C\u8BF7\u91CD\u8BD5\u3002");
              else noteNewerSession();
            });
          }
          if (strict) throw caught;
          return null;
        }).finally(() => {
          if (!historyCurrent(historyToken, scope)) return;
          editPendingRef.current -= 1;
          if (editPendingRef.current === 0) setEditBusy(false);
        });
      };
      const chooseRoute = (item, route) => {
        invalidateIdem();
        setServerBlockers([]);
        setRouteChoices((current) => ({ ...current, [item.itemId]: route }));
        sendEdit({ route }, item.itemId);
      };
      const changeOwner = (value) => {
        invalidateIdem();
        setServerBlockers([]);
        setOwnerChoice(value);
        sendEdit({ owner: value.trim() || null });
      };
      const changePriority = (value) => {
        invalidateIdem();
        setServerBlockers([]);
        setPriorityChoice(value);
        sendEdit({ priority: value || null });
      };
      const chooseUnknown = (item, index, resolution) => {
        invalidateIdem();
        setServerBlockers([]);
        setUnknownChoices((current) => ({ ...current, [`${item.itemId}:${index}`]: resolution }));
        sendEdit(
          {
            unknownResolutions: [
              {
                itemId: item.itemId,
                index,
                description: item.unknowns?.[index]?.description ?? "",
                resolution
              }
            ]
          },
          item.itemId
        );
      };
      const adoptInvestigation = async (item, unknown, entry) => {
        const current = sessionRef.current;
        if (!current || editPendingRef.current > 0 || adoptionUncertainRef.current || busy) return;
        const token = historyRequestRef.current;
        const scope = historyScope;
        const generation = ++editGenerationRef.current;
        editPendingRef.current += 1;
        setEditBusy(true);
        const run = async () => {
          if (!historyCurrent(token, scope)) return;
          const controller = new AbortController();
          let timer;
          let payload;
          try {
            payload = await Promise.race([
              writeJson("intent", { action: "adopt-investigation", sessionId: current.sessionId, expectedInputRevision: current.input?.inputRevision, expectedSessionRevision: current.sessionRevision, itemId: item.itemId, unknownDescription: unknown.description, investigationId: intentInvestigationId(entry) }, root, { signal: controller.signal }),
              new Promise((_, reject) => {
                timer = setTimeout(() => {
                  controller.abort();
                  reject(new Error("\u91C7\u7EB3\u8BF7\u6C42\u8D85\u65F6"));
                }, 1e4);
              })
            ]);
          } finally {
            clearTimeout(timer);
          }
          if (!historyCurrent(token, scope) || sessionRef.current?.sessionId !== current.sessionId || sessionRef.current?.sessionRevision !== current.sessionRevision) {
            if (mountedRef.current && historyScopeRef.current === scope && sessionRef.current?.sessionId === current.sessionId) setNotice("\u91C7\u7EB3\u8BF7\u6C42\u5DF2\u8FD4\u56DE\uFF0C\u4F46\u4F1A\u8BDD\u5DF2\u91CD\u65B0\u8BFB\u53D6\u6216\u66F4\u6539\uFF1B\u8BF7\u91CD\u65B0\u52A0\u8F7D\u4F1A\u8BDD\u6838\u5BF9\u7ED3\u679C\u3002");
            return;
          }
          const view = intentView(payload);
          if (!view || view.sessionId !== current.sessionId) throw new Error("\u8FD4\u56DE\u7684\u4F1A\u8BDD\u4E0D\u4E00\u81F4");
          invalidateIdem();
          setServerBlockers([]);
          if (editGenerationRef.current === generation) setUnknownChoices((choices) => {
            const next = { ...choices };
            delete next[`${item.itemId}:${item.unknowns.indexOf(unknown)}`];
            return next;
          });
          sessionRef.current = view;
          setSession(view);
          setNotice("\u5DF2\u91C7\u7EB3\u8BE5\u8C03\u67E5\u7528\u4E8E\u6B64\u672A\u77E5\u9879\uFF1B\u786E\u8BA4\u524D\u4ECD\u4F1A\u91CD\u65B0\u6838\u5BF9\u5F15\u7528\u3002");
        };
        const guardedRun = async () => {
          try {
            return await run();
          } catch (error2) {
            if (historyCurrent(token, scope) && sessionRef.current?.sessionId === current.sessionId) adoptionUncertainRef.current = true;
            throw error2;
          }
        };
        const queued = editQueueRef.current.then(guardedRun, guardedRun);
        editQueueRef.current = queued.catch(() => {
        });
        try {
          await queued;
        } catch (error2) {
          if (historyCurrent(token, scope) && sessionRef.current?.sessionId === current.sessionId) {
            adoptionUncertainRef.current = true;
            setServerBlockers([{ code: "adoption-unknown", message: "\u8C03\u67E5\u91C7\u7EB3\u7ED3\u679C\u672A\u77E5\uFF0C\u8BF7\u91CD\u65B0\u52A0\u8F7D\u4F1A\u8BDD\u6838\u5BF9\u540E\u518D\u64CD\u4F5C\u3002" }]);
            setNotice("\u8C03\u67E5\u91C7\u7EB3\u7ED3\u679C\u672A\u77E5\uFF0C\u670D\u52A1\u7AEF\u53EF\u80FD\u5DF2\u4FDD\u5B58\uFF1B\u8BF7\u91CD\u65B0\u52A0\u8F7D\u4F1A\u8BDD\u6838\u5BF9\u3002");
            setError(errorOf(error2));
          }
        } finally {
          if (historyCurrent(token, scope)) {
            editPendingRef.current -= 1;
            if (editPendingRef.current === 0) setEditBusy(false);
          }
        }
      };
      const resolveConflict = (conflict, useAi) => {
        if (useAi) setManualField(conflict.itemId, conflict.field, conflict.aiValue);
        setConflicts((current) => current.filter((entry) => !(entry.itemId === conflict.itemId && entry.field === conflict.field)));
      };
      const flushAllEdits = async () => {
        const current = sessionRef.current;
        if (!current?.sessionId) return null;
        const items = current.items ?? [];
        const merged = items.map((item) => ({ item, candidate: cleanCandidate(candidateOf(item)), route: routeOf(item) }));
        const resolutions = Object.entries(unknownChoices).map(([key, resolution]) => {
          const separator = key.indexOf(":");
          const itemId = key.slice(0, separator);
          const index = Number(key.slice(separator + 1));
          const item = items.find((entry) => entry.itemId === itemId);
          const description = item?.unknowns?.[index]?.description;
          if (separator < 1 || !Number.isInteger(index) || index < 0 || typeof description !== "string" || !description.trim() || item.unknowns.filter((entry) => entry.description === description).length !== 1) {
            throw new Error("\u672A\u77E5\u9879\u5DF2\u53D8\u5316\uFF0C\u65E0\u6CD5\u5B89\u5168\u4FDD\u5B58\u9009\u62E9\uFF1B\u5F53\u524D\u586B\u5199\u4ECD\u4FDD\u7559\uFF0C\u8BF7\u91CD\u65B0\u6838\u5BF9\u672A\u77E5\u9879\u540E\u91CD\u8BD5\u3002");
          }
          return { itemId, description, resolution };
        });
        if (merged.length === 0) return null;
        let chain = Promise.resolve(current);
        for (const [index, entry] of merged.entries()) {
          const fields = {};
          const edited = manual[entry.item.itemId] ?? {};
          for (const field of INTENT_FIELDS) {
            if (edited[field] !== void 0) fields[field] = entry.candidate[field];
          }
          if (routeChoices[entry.item.itemId] !== void 0) fields.route = entry.route;
          if (index === 0) {
            if (ownerChoice.trim()) fields.owner = ownerChoice.trim();
            if (priorityChoice) fields.priority = priorityChoice;
            if (resolutions.length) fields.unknownResolutions = resolutions;
          }
          if (Object.keys(fields).length) chain = chain.then(() => sendEdit(fields, entry.item.itemId, true));
        }
        return chain;
      };
      const analysisPending = () => session?.analysisStatus?.status === "running" && !analysisMonitorLost || groupFeedback?.kind === "running" || groupBusy || answerBusy;
      const confirmationGate = (humanConfirmation = false) => {
        const current = sessionRef.current ?? session;
        if (history.loading || history.error || current?.state === "committed") return { ready: false, reasons: [{ code: "history-not-editable", message: "\u5386\u53F2\u5C1A\u672A\u6210\u529F\u52A0\u8F7D\u6216\u5DF2\u63D0\u4EA4\uFF0C\u4E0D\u80FD\u786E\u8BA4" }], warnings: [] };
        const readiness = current?.readiness;
        if (!readiness || typeof readiness.ready !== "boolean") {
          return {
            ready: false,
            reasons: [{ code: "readiness-unavailable", message: "\u670D\u52A1\u7AEF\u5C1A\u672A\u8FD4\u56DE\u786E\u8BA4\u95E8\u7981\uFF0C\u8BF7\u5237\u65B0\u6216\u91CD\u65B0\u5206\u6790\u540E\u518D\u8BD5" }],
            warnings: []
          };
        }
        const reasons = (Array.isArray(readiness.reasons) ? [...readiness.reasons] : []).filter((entry) => !humanConfirmation || entry?.code !== "not-confirmed");
        const warnings = Array.isArray(readiness.warnings) ? [...readiness.warnings] : [];
        if (adoptionUncertainRef.current) reasons.push({ code: "adoption-unknown", message: "\u8C03\u67E5\u91C7\u7EB3\u7ED3\u679C\u672A\u77E5\uFF0C\u8BF7\u91CD\u65B0\u52A0\u8F7D\u4F1A\u8BDD\u6838\u5BF9\u540E\u518D\u64CD\u4F5C\u3002" });
        if (busy || editBusy || groupBusy || answerBusy) {
          reasons.push({ code: "client-operation-pending", message: "\u5F53\u524D\u64CD\u4F5C\u5C1A\u672A\u5B8C\u6210\uFF0C\u8BF7\u7A0D\u5019" });
        }
        const onlyHumanConfirmation = humanConfirmation && readiness.reasons?.length > 0 && readiness.reasons.every((entry) => entry?.code === "not-confirmed");
        return { ready: (readiness.ready === true || onlyHumanConfirmation) && reasons.length === 0, reasons, warnings };
      };
      const confirmationFormGate = () => {
        const current = sessionRef.current ?? session;
        const gate = confirmationGate();
        const reasons = gate.reasons.filter((entry) => entry?.code !== "needs-priority" && entry?.code !== "invalid-priority" && entry?.code !== "not-confirmed");
        if (!current?.sessionId) reasons.push({ code: "no-session", message: "\u670D\u52A1\u7AEF\u4F1A\u8BDD\u5C1A\u672A\u5EFA\u7ACB" });
        if (analysisPending() || editBusy) reasons.push({ code: "form-busy", message: "\u5206\u6790\u6216\u7F16\u8F91\u4ECD\u5728\u8FDB\u884C" });
        return { ready: reasons.length === 0, reasons, finalGate: gate };
      };
      const draftPhase = () => {
        if (analysisPending()) return { tone: "neutral", label: "\u91CD\u65B0\u5206\u6790\u4E2D" };
        const gate = confirmationGate();
        if (gate.ready) return { tone: "success", label: "\u8349\u7A3F\u53EF\u786E\u8BA4" };
        if ((sessionRef.current ?? session)?.state === "failed") return { tone: "error", label: "\u5206\u6790\u5931\u8D25" };
        return { tone: "warn", label: "\u8349\u7A3F\u672A\u5C31\u7EEA" };
      };
      const enterConfirm = async () => {
        if (history.loading || history.error || sessionRef.current?.state === "committed" || confirmEntryRef.current || busy || editBusy || analysisPending() || !sessionRef.current?.sessionId) return;
        confirmEntryRef.current = true;
        setBusy(true);
        setError(null);
        try {
          await editQueueRef.current;
          const saved = await flushAllEdits();
          if (!mountedRef.current) return;
          if (!saved) throw new Error("\u670D\u52A1\u7AEF\u672A\u8FD4\u56DE\u5DF2\u4FDD\u5B58\u4F1A\u8BDD\uFF0C\u8BF7\u91CD\u8BD5\u3002");
        } catch (caught) {
          if (mountedRef.current) {
            setError(errorOf(caught));
            setNotice("\u4FDD\u5B58\u5E76\u68C0\u67E5\u5931\u8D25\uFF0C\u5F53\u524D\u586B\u5199\u4ECD\u4FDD\u7559\uFF0C\u8BF7\u91CD\u8BD5\u3002");
          }
          return;
        } finally {
          confirmEntryRef.current = false;
          if (mountedRef.current) setBusy(false);
        }
        const formGate = confirmationFormGate();
        const gate = formGate.finalGate;
        const formReasons = formGate.reasons;
        if (!formGate.ready) {
          setNotice(formReasons.map((entry) => entry.message).filter(Boolean).join("\uFF1B") || "\u5206\u6790\u6216\u7F16\u8F91\u4ECD\u5728\u8FDB\u884C\uFF0C\u8BF7\u5B8C\u6210\u540E\u518D\u8FDB\u5165\u6700\u7EC8\u8868\u5355\u3002");
          requestAnimationFrame(() => blockerRef.current?.focus?.());
          return;
        }
        if (!idemRef.current) idemRef.current = intentIdemKey();
        setConfirmState({ loading: false, error: null, result: null });
        setScreen("confirm");
        if (gate.reasons.some((entry) => entry?.code === "needs-priority" || entry?.code === "invalid-priority")) {
          requestAnimationFrame(() => priorityRef.current?.focus?.());
        }
      };
      const submitConfirm = () => {
        if (history.loading || history.error || (sessionRef.current ?? session)?.state === "committed" || confirmState.loading) return;
        const current = sessionRef.current ?? session;
        if (!current?.sessionId) {
          setConfirmState({ loading: false, error: { code: "no-session", message: "\u670D\u52A1\u7AEF\u8FD8\u6CA1\u6709\u8FD9\u4EFD\u4F1A\u8BDD\uFF0C\u65E0\u6CD5\u4FDD\u5B58\uFF1B\u8BF7\u5148\u91CD\u65B0\u5206\u6790\u3002" }, result: null });
          return;
        }
        const gate = confirmationGate(true);
        if (!gate.ready) {
          setConfirmState({ loading: false, error: { code: "not-ready", message: "\u8FD8\u4E0D\u80FD\u4FDD\u5B58", reasons: gate.reasons }, result: null });
          requestAnimationFrame(() => {
            const node = screenHeadingRef.current;
            if (node && typeof node.scrollIntoView === "function") node.scrollIntoView({ block: "start", behavior: REDUCE_MOTION ? "auto" : "smooth" });
          });
          return;
        }
        if (!idemRef.current) idemRef.current = intentIdemKey();
        const confirmHistoryToken = historyRequestRef.current;
        const confirmHistoryScope = historyScope;
        setConfirmState({ loading: true, error: null, result: null });
        setError(null);
        flushAllEdits().then(() => {
          if (!historyCurrent(confirmHistoryToken, confirmHistoryScope)) return null;
          const refreshedGate = confirmationGate(true);
          if (!refreshedGate.ready) {
            setConfirmState({ loading: false, error: { code: "not-ready", message: "\u4FDD\u5B58\u524D\u95E8\u7981\u5DF2\u66F4\u65B0\uFF0C\u8BF7\u6838\u5BF9\u540E\u91CD\u8BD5", reasons: refreshedGate.reasons }, result: null });
            return null;
          }
          const latest = sessionRef.current ?? current;
          const items = (latest.items ?? []).filter((item) => !item.excluded).map((item) => ({
            itemId: item.itemId,
            route: routeOf(item),
            candidate: cleanCandidate(candidateOf(item)),
            unknowns: (item.unknowns ?? []).map((unknown, index) => ({
              ...unknown,
              resolution: unknownChoices[`${item.itemId}:${index}`] ?? unknown.resolution ?? "pending"
            }))
          }));
          const leadItem = items[0] ?? null;
          const body = {
            action: "confirm",
            sessionId: latest.sessionId,
            expectedInputRevision: latest.input?.inputRevision ?? 0,
            expectedSessionRevision: latest.sessionRevision ?? latest.draftRevision ?? null,
            docHash: latest.docDraft?.docHash ?? draftOf()?.docHash ?? null,
            draftRevision: latest.draftRevision ?? latest.docDraft?.draftRevision ?? draftOf()?.draftRevision ?? null,
            contextSnapshotId: latest.context?.contextSnapshotId ?? null,
            confirmation: {
              contentHash: latest.confirmation?.contentHash ?? latest.contentHash ?? null,
              route: leadItem?.route ?? "create",
              items,
              owner: ownerChoice.trim() || null,
              priority: priorityChoice || null
            },
            idempotencyKey: idemRef.current,
            actor: "human:local"
          };
          return writeJson("intent", body, root);
        }).then((payload) => {
          if (!historyCurrent(confirmHistoryToken, confirmHistoryScope) || !payload) return;
          setReceipt({ receipt: payload.receipt ?? null, artifacts: payload.artifacts ?? [], replayed: payload.replayed === true });
          setConfirmState({ loading: false, error: null, result: payload });
          setScreen("receipt");
        }).catch((caught) => {
          if (!historyCurrent(confirmHistoryToken, confirmHistoryScope)) return;
          const info = errorOf(caught);
          if (info.code === "draft-changed") {
            invalidateIdem();
            const details = info.payload && info.payload.error && info.payload.error.details || {};
            const latestDraft = details.latest?.docDraft ?? null;
            if (latestDraft) {
              const base = sessionRef.current ?? current;
              draftPrevRef.current = latestDraft;
              setSessionView({
                ...base,
                docDraft: latestDraft,
                draftRevision: details.latest?.draftRevision ?? latestDraft.draftRevision ?? base.draftRevision ?? null
              });
            }
            if (details.diff) setDraftDiff(details.diff);
            setDraftOpen(true);
            setDraftNotice({ count: draftChangesCount(details.diff), message: "\u8349\u7A3F\u5DF2\u66F4\u65B0\uFF0C\u8BF7\u91CD\u65B0\u786E\u8BA4" });
            setConfirmState({
              loading: false,
              error: { ...info, code: "draft-changed", message: "\u8349\u7A3F\u5DF2\u66F4\u65B0\uFF0C\u8BF7\u91CD\u65B0\u786E\u8BA4" },
              result: null
            });
            return;
          }
          if (info.code === "stale-input" || info.code === "stale-context" || info.code === "stale-session") {
            invalidateIdem();
            const token = historyRequestRef.current;
            const scope = historyScope;
            setConfirmState({ loading: true, error: { ...info, message: "\u4F1A\u8BDD\u5DF2\u53D8\u5316\uFF0C\u6B63\u5728\u91CD\u65B0\u8BFB\u53D6\uFF1B\u8BF7\u6838\u5BF9\u540E\u518D\u6B21\u786E\u8BA4\u3002" }, result: null });
            loadLatestSession(current.sessionId).then((result) => {
              const view = result?.view;
              if (!historyCurrent(token, scope) || sessionRef.current?.sessionId !== current.sessionId) return;
              if (!view || view.sessionId !== current.sessionId) throw new Error("\u8FD4\u56DE\u7684\u4F1A\u8BDD\u4E0E\u5F53\u524D\u4F1A\u8BDD\u4E0D\u4E00\u81F4");
              applySession(view);
              if (result?.payload) trackInvestigations(result.payload);
              setConfirmState({ loading: false, error: { ...info, message: "\u4F1A\u8BDD\u5DF2\u53D8\u5316\u5E76\u91CD\u65B0\u8BFB\u53D6\uFF0C\u8BF7\u6838\u5BF9\u540E\u518D\u6B21\u786E\u8BA4\u3002" }, result: null });
            }).catch(() => {
              if (historyCurrent(token, scope) && sessionRef.current?.sessionId === current.sessionId) setConfirmState({ loading: false, error: { ...info, message: "\u4F1A\u8BDD\u5DF2\u53D8\u5316\uFF0C\u91CD\u65B0\u8BFB\u53D6\u5931\u8D25\uFF1B\u8BF7\u91CD\u8BD5\u6216\u91CD\u65B0\u6253\u5F00\u4F1A\u8BDD\u3002" }, result: null });
            });
            return;
          }
          if (info.code === "not-ready") {
            setServerBlockers(info.reasons ?? []);
            setConfirmState({ loading: false, error: { ...info, message: "\u540E\u7AEF\u5224\u5B9A\u8FD8\u4E0D\u80FD\u4FDD\u5B58" }, result: null });
            return;
          }
          setConfirmState({ loading: false, error: info, result: null });
        });
      };
      const finish = () => {
        invalidateHistory();
        const artifacts = receipt?.artifacts ?? [];
        const requirement = artifacts.find((artifact) => artifact.kind === "requirement");
        if (onCreated) onCreated({ requirementId: requirement?.id ?? null, artifacts });
        onClose();
      };
      const handleClose = () => {
        if (screen === "receipt") {
          finish();
          return;
        }
        if (editBusy || confirmState.loading) return;
        if (analysisPending()) {
          setNotice("\u6A21\u578B\u4ECD\u5728\u540E\u53F0\u91CD\u65B0\u5206\u6790\uFF1B\u5B8C\u6210\u540E\u518D\u79BB\u5F00\u4EE5\u4FDD\u7559\u5F53\u524D\u53D6\u8BC1\u4E0A\u4E0B\u6587\u3002");
          return;
        }
        if (sessionRef.current?.sessionId && (screen === "review" || screen === "confirm")) {
          saveAndLeave();
          return;
        }
        if ((rawText.trim() || images.length || imageReadsRef.current > 0 || chatMarkdown.trim()) && !window.confirm("\u5C1A\u672A\u4FDD\u5B58\u7684\u539F\u8BDD\u3001\u804A\u5929\u8BB0\u5F55\u6216\u56FE\u7247\u5C06\u88AB\u4E22\u5F03\uFF0C\u786E\u5B9A\u79BB\u5F00\uFF1F")) return;
        invalidateHistory();
        onClose();
      };
      const saveAndLeave = () => {
        if (editBusy || confirmState.loading) return;
        if ((draftEditing || Object.keys(groupDrafts).length || answerChoice !== null || questionText.trim()) && !window.confirm("\u5C1A\u6709\u672A\u63D0\u4EA4\u7684\u8349\u7A3F\u6216\u56DE\u7B54\uFF0C\u79BB\u5F00\u5C06\u4E22\u5F03\u8FD9\u4E9B\u5185\u5BB9\u3002\u786E\u5B9A\u79BB\u5F00\uFF1F")) return;
        if (analysisPending()) {
          setNotice("\u6A21\u578B\u4ECD\u5728\u540E\u53F0\u91CD\u65B0\u5206\u6790\uFF1B\u5B8C\u6210\u540E\u518D\u79BB\u5F00\u3002");
          return;
        }
        setNotice("\u6B63\u5728\u4FDD\u5B58\u4F1A\u8BDD\uFF0C\u8BF7\u7A0D\u5019\u2026");
        const token = historyRequestRef.current;
        const scope = historyScope;
        flushAllEdits().then(() => {
          if (!historyCurrent(token, scope)) return;
          invalidateHistory();
          onClose();
        }).catch((caught) => {
          if (!historyCurrent(token, scope)) return;
          setError(errorOf(caught));
          setNotice("\u4F1A\u8BDD\u672A\u4FDD\u5B58\uFF0C\u5DF2\u4FDD\u7559\u5F53\u524D\u7F16\u8F91\u3002\u8BF7\u91CD\u8BD5\uFF0C\u4E0D\u8981\u5173\u95ED\u6B64\u7A97\u53E3\u3002");
        });
      };
      const postpone = () => {
        requestRef.current += 1;
        saveAndLeave();
      };
      const loadRehearsal = () => {
        const changeItems = activeItems().filter((item) => routeOf(item) === "change");
        const first = changeItems[0];
        if (!first) {
          setRehearsal({ loading: false, error: null, data: null, base: null });
          return;
        }
        const base = changeBaseOf(first);
        if (!base?.uid) {
          setRehearsal({ loading: false, error: null, data: null, base: base ?? null });
          return;
        }
        const candidate = cleanCandidate(candidateOf(first));
        const changes = [];
        if (candidate.title) changes.push({ field: "title", value: candidate.title });
        const brief = intentBriefOf(candidate);
        if (brief) changes.push({ field: "brief", value: brief });
        if (changes.length === 0) {
          setRehearsal({ loading: false, error: null, data: null, base });
          return;
        }
        setRehearsal({ loading: true, error: null, data: null, base });
        const requestPreview = (list) => postJson("requirements/rehearsal", { requirementId: base.uid, changes: list, apply: false }, root);
        requestPreview(changes).catch((caught) => {
          const info = errorOf(caught);
          const titleOnly = changes.filter((entry) => entry.field === "title");
          if (info.code === "brief-missing" && titleOnly.length > 0) return requestPreview(titleOnly);
          throw caught;
        }).then((payload) => {
          if (mountedRef.current) setRehearsal({ loading: false, error: null, data: payload, base });
        }).catch((caught) => {
          if (mountedRef.current) setRehearsal({ loading: false, error: caught.message, data: null, base });
        });
      };
      useEffect(() => {
        if (screen === "confirm") loadRehearsal();
      }, [screen, session?.sessionId, session?.input?.inputRevision]);
      const tonePill = (tone, text, key) => {
        const colors = EVIDENCE_TONE[tone] ?? EVIDENCE_TONE.neutral;
        return h(
          "span",
          {
            key: key ?? `${tone}-${text}`,
            style: {
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              border: `1px solid ${T.line2}`,
              borderRadius: "999px",
              padding: "1px 8px",
              fontSize: "11.5px",
              color: colors.color,
              background: colors.bg,
              whiteSpace: "nowrap"
            }
          },
          text
        );
      };
      const fieldBlock = (label, tag, control) => h(
        "div",
        { style: { marginTop: "8px" } },
        h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", marginBottom: "3px" } },
          h("span", { style: { fontSize: "11px", letterSpacing: ".06em", textTransform: "uppercase", color: T.text3 } }, label),
          tag
        ),
        control
      );
      const sourceTag = (edited) => h(
        "span",
        { style: { fontSize: "10.5px", color: edited ? T.warn : T.text3, border: `1px solid ${T.line2}`, borderRadius: "5px", padding: "0 5px" } },
        edited ? "\u5DF2\u624B\u6539" : "AI \u5019\u9009"
      );
      const linesField = (label, values, onChange, prefix = "") => h(
        "div",
        { style: { marginTop: "8px" } },
        h("div", { style: fieldLabelStyle }, label),
        h("textarea", {
          "aria-label": `${prefix}${label}`,
          name: `intent-${prefix}${label}`,
          autoComplete: "off",
          value: intentLines(values),
          onChange: (event) => onChange(event.target.value.split("\n")),
          placeholder: "\u6BCF\u884C\u4E00\u6761\uFF1B\u7559\u7A7A\u8868\u793A\u6682\u65E0",
          style: { ...input, width: "100%", minWidth: 0, minHeight: "48px", resize: "vertical", fontFamily: "inherit" }
        })
      );
      const acceptanceInput = (item, list, index, key, placeholder, prefix) => h("input", {
        key,
        "aria-label": `${prefix}\u9A8C\u6536\u6807\u51C6 ${index + 1}\uFF1A${placeholder}`,
        name: `intent-${item.itemId}-acceptance-${index + 1}-${key}`,
        autoComplete: "off",
        value: list?.[index]?.[key] ?? "",
        placeholder,
        onChange: (event) => {
          const next = (list ?? []).map((row2, position) => position === index ? { ...row2, [key]: event.target.value } : row2);
          setManualField(item.itemId, "acceptance", next);
        },
        style: { ...input, width: "100%", minWidth: 0, marginTop: "4px" }
      });
      const renderAcceptance = (item, list, prefix = "") => h(
        "div",
        { style: { marginTop: "10px" } },
        h(
          "div",
          { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" } },
          h("span", { style: fieldLabelStyle }, `\u9A8C\u6536\u6807\u51C6\uFF08${(list ?? []).length} \u6761\uFF09`),
          h(
            "button",
            {
              type: "button",
              style: { ...button, padding: "2px 9px", fontSize: "11px" },
              onClick: () => setManualField(item.itemId, "acceptance", [...list ?? [], { precondition: "", action: "", expected: "", judgement: "pass" }])
            },
            "\uFF0B \u52A0\u4E00\u6761"
          )
        ),
        (list ?? []).map(
          (row2, index) => h(
            "div",
            { key: index, style: { border: `1px solid ${T.line}`, borderRadius: "9px", padding: "8px 10px", marginTop: "6px", background: T.layer } },
            h(
              "div",
              { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" } },
              h("span", { style: { fontSize: "11px", color: T.text3 } }, `\u9A8C\u6536 ${index + 1}`),
              h(
                "button",
                {
                  type: "button",
                  style: { ...button, padding: "0 8px", fontSize: "11px" },
                  onClick: () => setManualField(item.itemId, "acceptance", (list ?? []).filter((_, position) => position !== index))
                },
                "\u5220\u9664"
              )
            ),
            acceptanceInput(item, list, index, "precondition", "\u524D\u7F6E\u6761\u4EF6", prefix),
            acceptanceInput(item, list, index, "action", "\u52A8\u4F5C", prefix),
            acceptanceInput(item, list, index, "expected", "\u671F\u671B\u7ED3\u679C", prefix),
            acceptanceInput(item, list, index, "judgement", "\u5224\u5B9A\uFF08pass / fail\uFF09", prefix)
          )
        )
      );
      const runIntake = (body) => {
        const token = ++intakeRequestRef.current;
        setIntake({ loading: true, error: null, data: null });
        writeJson("intake", body, root).then((data) => {
          if (!mountedRef.current || intakeRequestRef.current !== token) return;
          setIntake({ loading: false, error: null, data });
        }).catch((caught) => {
          if (mountedRef.current && intakeRequestRef.current === token) setIntake({ loading: false, error: caught.message, data: null });
        });
      };
      const readImageFile = (file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(new Error("\u8BFB\u53D6\u56FE\u7247\u5931\u8D25"));
        reader.readAsDataURL(file);
      });
      const uniqueImageName = (name, existing) => {
        const base = String(name || "screenshot.png").replace(/[^A-Za-z0-9._-]/g, "_") || "screenshot.png";
        const dot = base.lastIndexOf(".");
        const stem = dot > 0 ? base.slice(0, dot) : base;
        const ext = dot > 0 ? base.slice(dot) : "";
        let candidate = base;
        let index = 2;
        while (existing.some((image) => image.name === candidate)) {
          candidate = `${stem}-${index}${ext}`;
          index += 1;
        }
        return candidate;
      };
      const addImages = async (files) => {
        const generation = imageGenerationRef.current;
        const list = Array.from(files ?? []).filter(Boolean);
        if (list.length === 0) {
          setNotice("\u53EA\u652F\u6301\u56FE\u7247\u6587\u4EF6\uFF08PNG / JPEG / WebP\uFF09\u3002");
          return;
        }
        const accepted = [];
        const rejected = [];
        let skippedForCapacity = 0;
        imageReadEpochRef.current += 1;
        imageReadsRef.current += 1;
        pendingImageFilesRef.current.add(list);
        try {
          for (const file of list) {
            if (!["image/png", "image/jpeg", "image/webp"].includes(String(file.type).toLowerCase())) {
              rejected.push(`${file.name || "\u6587\u4EF6"} \u683C\u5F0F\u4E0D\u652F\u6301\uFF08\u4EC5 PNG / JPEG / WebP\uFF09`);
              continue;
            }
            if (file.size > INTENT_IMAGE_MAX_BYTES) {
              rejected.push(`${file.name || "\u56FE\u7247"} \u8D85\u8FC7 8MB`);
              continue;
            }
            if (accepted.length >= INTENT_MAX_IMAGES) {
              skippedForCapacity += 1;
              continue;
            }
            try {
              const dataUrl = await readImageFile(file);
              const base64 = dataUrl.split(",")[1] ?? "";
              if (!base64) {
                rejected.push(`${file.name || "\u56FE\u7247"} \u8BFB\u53D6\u5931\u8D25`);
                continue;
              }
              const previewObjectUrl = typeof URL !== "undefined" && typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null;
              accepted.push({ name: file.name || "screenshot.png", size: Number(file.size) || 0, mimeType: String(file.type).toLowerCase(), dataUrl, base64, previewObjectUrl });
            } catch {
              rejected.push(`${file.name || "\u56FE\u7247"} \u8BFB\u53D6\u5931\u8D25`);
            }
          }
        } finally {
          imageReadsRef.current -= 1;
          pendingImageFilesRef.current.delete(list);
        }
        if (!mountedRef.current || generation !== imageGenerationRef.current) {
          for (const item of accepted) {
            if (item.previewObjectUrl && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(item.previewObjectUrl);
          }
          return;
        }
        const current = imagesRef.current;
        const capacity = Math.max(0, INTENT_MAX_IMAGES - current.length);
        const toAdd = accepted.slice(0, capacity);
        const overflow = skippedForCapacity + accepted.length - toAdd.length;
        if (toAdd.length > 0) {
          const stamp = Date.now().toString(36);
          const next = [...current];
          toAdd.forEach((item, index) => {
            next.push({
              id: `img-${stamp}-${index}-${Math.random().toString(36).slice(2, 6)}`,
              name: uniqueImageName(item.name, next),
              size: item.size,
              mimeType: item.mimeType,
              kind: "screenshot",
              previewUrl: item.previewObjectUrl || item.dataUrl,
              previewObjectUrl: item.previewObjectUrl,
              dataBase64: item.base64,
              status: "pending",
              data: null,
              error: null
            });
          });
          imagesRef.current = next;
          setImages(next);
        }
        for (const item of accepted.slice(toAdd.length)) {
          if (item.previewObjectUrl && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(item.previewObjectUrl);
        }
        const problems = [];
        if (overflow > 0) problems.push(`\u6700\u591A ${INTENT_MAX_IMAGES} \u5F20\u56FE\u7247\uFF0C\u8D85\u51FA\u7684\u672A\u52A0\u5165\u3002`);
        if (rejected.length > 0) problems.push(rejected.slice(0, 2).join("\uFF1B"));
        setNotice(problems.length > 0 ? problems.join(" ") : null);
      };
      useEffect(() => {
        if (recoveredInput?.pendingFiles?.length) addImages(recoveredInput.pendingFiles);
      }, []);
      const removeImage = (id) => {
        const removed = imagesRef.current.find((image) => image.id === id);
        if (removed?.previewObjectUrl && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(removed.previewObjectUrl);
        imagesRef.current = imagesRef.current.filter((image) => image.id !== id);
        setImages(imagesRef.current);
        setExpandedImageId((current) => current === id ? null : current);
      };
      const onFile = (event) => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = "";
        if (files.length > 0) addImages(files);
      };
      const onPaste = (event) => {
        const items = Array.from(event.clipboardData?.items ?? []);
        const files = items.filter((item) => item.kind === "file" && String(item.type).startsWith("image/")).map((item) => item.getAsFile()).filter(Boolean);
        if (files.length === 0) return;
        event.preventDefault();
        addImages(files);
      };
      const onDragOver = (event) => {
        if (!Array.from(event.dataTransfer?.types ?? []).includes("Files")) return;
        event.preventDefault();
        setDragging(true);
      };
      const onDragLeave = (event) => {
        if (event.currentTarget && event.relatedTarget && event.currentTarget.contains(event.relatedTarget)) return;
        setDragging(false);
      };
      const onDrop = (event) => {
        if (Array.from(event.dataTransfer?.types ?? []).includes("Files")) event.preventDefault();
        setDragging(false);
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length === 0) {
          setNotice("\u53EA\u652F\u6301\u56FE\u7247\u6587\u4EF6\uFF08PNG / JPEG / WebP\uFF09\u3002");
          return;
        }
        addImages(files);
      };
      const patchImage = (id, patch) => {
        setImages((current) => current.map((image) => image.id === id ? { ...image, ...patch } : image));
      };
      const imageLines = (image) => Array.isArray(image?.data?.lines) ? image.data.lines : [];
      const prepareOcrImages = async (list, { signal, isCurrent: isCurrent2, onProgress } = {}) => {
        const prepared = [];
        for (let index = 0; index < list.length; index += 1) {
          const image = list[index];
          if (image.data?.schema === "alm.ocr/v1") {
            prepared.push(image);
            continue;
          }
          if (typeof onProgress === "function") onProgress(index, list.length);
          patchImage(image.id, { status: "recognizing", error: null });
          let data;
          try {
            data = await writeJson("intake", { mode: "ocr", filename: image.name, imageBase64: image.dataBase64 }, root, { signal });
            if (data?.schema !== "alm.ocr/v1" || typeof data.text !== "string" || !Array.isArray(data.lines) || data.lines.some((line) => typeof line?.text !== "string" || typeof line?.ref !== "string") || data.text !== data.lines.map((line) => line.text).join("\n")) {
              throw new Error("\u8BC6\u522B\u670D\u52A1\u8FD4\u56DE\u7684\u6570\u636E\u4E0D\u5B8C\u6574");
            }
          } catch (caught) {
            if (caught?.name === "AbortError") throw caught;
            patchImage(image.id, { status: "failed", error: caught?.message ?? "\u8BC6\u522B\u5931\u8D25" });
            const failure = new Error(`\u56FE\u7247\u300C${image.name}\u300D\u8BC6\u522B\u5931\u8D25\uFF1A${caught?.message ?? "\u672A\u77E5\u9519\u8BEF"}`);
            failure.code = caught?.code ?? "ocr-failed";
            throw failure;
          }
          if (typeof isCurrent2 === "function" && !isCurrent2()) return prepared;
          patchImage(image.id, { status: "recognized", data, error: null });
          prepared.push({ ...image, status: "recognized", data });
        }
        return prepared;
      };
      const imageStatusLabel = (image) => {
        if (image.status === "recognizing") return "\u6B63\u5728\u8BC6\u522B\u2026";
        if (image.status === "failed") return "\u8BC6\u522B\u5931\u8D25\uFF0C\u53EF\u91CD\u8BD5";
        const lines = imageLines(image);
        if (image.data?.schema === "alm.ocr/v1" || image.status === "recognized") return `\u5DF2\u8BC6\u522B ${lines.length} \u884C`;
        return "\u5F85\u5206\u6790\u65F6\u8BC6\u522B";
      };
      const renderImageTray = () => {
        if (images.length === 0) return null;
        const expanded = images.find((image) => image.id === expandedImageId) ?? null;
        return h(
          "div",
          { style: { marginTop: "2px" } },
          h(
            "div",
            { style: { display: "flex", flexWrap: "wrap", gap: "8px" } },
            images.map((image, index) => {
              const statusColor = image.status === "failed" ? T.err : image.status === "recognizing" ? T.brand : image.data?.schema === "alm.ocr/v1" ? T.ok : T.text3;
              const canPreview = image.data?.schema === "alm.ocr/v1";
              return h(
                "div",
                {
                  key: image.id,
                  style: {
                    position: "relative",
                    width: "118px",
                    border: `1px solid ${expandedImageId === image.id ? T.brand : T.line}`,
                    borderRadius: "10px",
                    background: T.base,
                    overflow: "hidden"
                  }
                },
                h(
                  "button",
                  {
                    type: "button",
                    title: canPreview ? "\u67E5\u770B\u8BC6\u522B\u6587\u672C" : "\u8BC6\u522B\u4F1A\u5728\u70B9\u300C\u5206\u6790\u610F\u56FE\u300D\u540E\u8FDB\u884C",
                    "aria-label": `\u56FE\u7247 ${index + 1} ${image.name}`,
                    onClick: () => {
                      if (!canPreview) return;
                      setExpandedImageId((current) => current === image.id ? null : image.id);
                    },
                    style: { display: "block", width: "100%", padding: 0, border: 0, background: "transparent", cursor: canPreview ? "pointer" : "default" }
                  },
                  h("img", { src: image.previewUrl, alt: image.name, width: 118, height: 62, style: { display: "block", width: "100%", height: "62px", objectFit: "cover" } })
                ),
                h(
                  "div",
                  { style: { padding: "4px 22px 4px 6px" } },
                  h("div", { title: image.name, style: { fontSize: "10.5px", color: T.text2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, image.name),
                  h("div", { style: { fontSize: "10.5px", color: statusColor, whiteSpace: "nowrap" } }, imageStatusLabel(image))
                ),
                h(
                  "button",
                  {
                    type: "button",
                    onClick: () => removeImage(image.id),
                    title: "\u79FB\u9664\u8FD9\u5F20\u56FE\u7247",
                    "aria-label": `\u79FB\u9664\u56FE\u7247 ${image.name}`,
                    style: {
                      position: "absolute",
                      top: "3px",
                      right: "3px",
                      width: "24px",
                      height: "24px",
                      borderRadius: "50%",
                      border: "none",
                      background: "rgba(4,6,9,.72)",
                      color: "#fff",
                      fontSize: "12px",
                      lineHeight: "20px",
                      cursor: "pointer",
                      padding: 0
                    }
                  },
                  "\xD7"
                )
              );
            })
          ),
          expanded ? h(
            "div",
            { style: { marginTop: "8px", border: `1px solid ${T.line}`, borderRadius: "10px", background: T.base, padding: "10px 12px" } },
            h(
              "div",
              { style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } },
              h("b", { style: { fontSize: "12px", color: T.text } }, `\u8BC6\u522B\u6587\u672C \xB7 ${expanded.name}`),
              h("span", { style: muted }, `${imageLines(expanded).length} \u884C${expanded.data?.lowConfidence ? ` \xB7 ${expanded.data.lowConfidence} \u884C\u4F4E\u7F6E\u4FE1\u5EA6` : ""}`),
              h(
                "button",
                { type: "button", style: { ...button, marginLeft: "auto", padding: "2px 8px", fontSize: "11px" }, onClick: () => setExpandedImageId(null) },
                "\u6536\u8D77"
              )
            ),
            h(
              "pre",
              {
                style: {
                  margin: "8px 0 0",
                  padding: "8px",
                  maxHeight: "160px",
                  overflow: "auto",
                  background: T.layer,
                  border: `1px solid ${T.line}`,
                  borderRadius: "8px",
                  fontSize: "11.5px",
                  whiteSpace: "pre-wrap"
                }
              },
              imageLines(expanded).map((line) => `${line.ref}  ${line.text}  (${Math.round((Number(line.confidence) || 0) * 100)}%)`).join("\n")
            ),
            h("p", { style: { margin: "6px 0 0", ...muted } }, "\u8FD9\u4E9B\u6587\u5B57\u53EA\u4F5C\u4E3A\u5206\u6790\u6750\u6599\uFF0C\u4E0D\u4F1A\u6539\u5199\u4E0A\u9762\u7684\u539F\u8BDD\u3002")
          ) : null
        );
      };
      const useRecognizedText = (text) => {
        if (!text) return;
        setRawText((current) => current.trim() === "" ? text : `${current.trim()}
${text}`);
      };
      const renderSourcePanel = () => {
        if (source !== "chat") return null;
        const parsed = intake.data;
        return h(
          "div",
          { style: { border: `1px solid ${T.line}`, borderRadius: "10px", padding: "12px", marginTop: "8px" } },
          h("textarea", {
            "aria-label": "\u804A\u5929\u8BB0\u5F55",
            name: "intent-chat-record",
            autoComplete: "off",
            value: chatMarkdown,
            onChange: (event) => {
              intakeRequestRef.current += 1;
              setChatMarkdown(event.target.value);
              setIntake({ loading: false, error: null, data: null });
              setAttachment(null);
            },
            placeholder: "\u7C98\u8D34\u804A\u5929\u8BB0\u5F55\uFF0C\u4F8B\u5982\uFF1A10:12 \u5F20\u4E09\uFF1A\u9000\u6B3E\u8981\u5E42\u7B49",
            style: { ...input, minWidth: 0, minHeight: "80px", resize: "vertical", fontFamily: "inherit", width: "100%" }
          }),
          h(
            "button",
            {
              type: "button",
              style: { ...button, marginTop: "8px" },
              disabled: intake.loading || chatMarkdown.trim() === "",
              onClick: () => {
                if (chatMarkdown.trim() === "") return;
                setAttachment({ name: "chat.md", kind: "chat", text: chatMarkdown });
                runIntake({ mode: "chat", markdown: chatMarkdown });
              }
            },
            "\u89E3\u6790\u804A\u5929"
          ),
          intake.loading ? h("p", { role: "status", "aria-live": "polite", style: { margin: "6px 0 0", ...muted } }, "\u6B63\u5728\u89E3\u6790\u804A\u5929\u8BB0\u5F55\u2026") : null,
          intake.error ? h("p", { role: "alert", "aria-live": "assertive", style: { margin: "6px 0 0", color: T.err, fontSize: "12.5px" } }, intake.error) : null,
          parsed?.schema === "alm.intake.chat/v1" ? h(
            "div",
            null,
            h("p", { style: { margin: "8px 0 4px", fontSize: "12px", color: T.text2 } }, `\u89E3\u6790 ${parsed.messages.length} \u6761\u6D88\u606F`),
            h(
              "div",
              { style: { maxHeight: "140px", overflow: "auto", border: `1px solid ${T.line}`, borderRadius: "8px", padding: "6px 10px" } },
              parsed.messages.map(
                (message) => h(
                  "div",
                  { key: message.id, style: { padding: "3px 0", fontSize: "12px", color: T.text2, borderBottom: `1px solid ${T.line}` } },
                  h("span", { style: { color: T.text3, marginRight: "6px" } }, message.ref),
                  h("b", { style: { color: T.text, fontWeight: 500 } }, message.speaker || "\u2014"),
                  ` ${message.text}`
                )
              )
            ),
            h("button", { type: "button", style: { ...button, marginTop: "8px" }, disabled: intake.added === true || !parsed.text, onClick: () => {
              useRecognizedText(parsed.text);
              setIntake((current) => ({ ...current, added: true }));
            } }, intake.added ? "\u5DF2\u52A0\u5165\u539F\u8BDD" : "\u628A\u804A\u5929\u5185\u5BB9\u52A0\u5165\u539F\u8BDD")
          ) : null
        );
      };
      const quietAction = {
        border: 0,
        background: "transparent",
        color: T.text2,
        padding: "4px 6px",
        borderRadius: "7px",
        fontSize: "12.5px",
        fontFamily: "inherit",
        cursor: "pointer"
      };
      const refreshRequirementMatch = (value) => {
        const text = String(value ?? "").trim();
        const request = ++matchRequestRef.current;
        if (text.length < 4) {
          setRequirementMatch(null);
          return;
        }
        writeJson("convergence", { action: "match", text }, root).then((payload) => {
          if (request !== matchRequestRef.current) return;
          const match = payload?.match;
          if (!match || !["high", "medium"].includes(match.confidence) || !match.matchedReqId) {
            setRequirementMatch(null);
            return;
          }
          setRequirementMatch(match);
          setAttachMatchedFeedback(true);
        }).catch(() => {
          if (request === matchRequestRef.current) setRequirementMatch(null);
        });
      };
      const submitMatchedFeedback = async () => {
        const match = requirementMatch;
        const feedbackText = rawText.trim();
        if (!match?.matchedReqId || !feedbackText) return runAnalyze();
        setBusy(true);
        setError(null);
        try {
          const proposed = await writeJson("convergence", { action: "feedback", reqId: match.matchedReqId, feedbackText }, root);
          const patch = proposed?.pendingPatch;
          if (!patch?.patchId || !patch?.patchHash || !patch?.baseRequirementHash) throw new Error("\u670D\u52A1\u7AEF\u672A\u8FD4\u56DE\u53EF\u786E\u8BA4\u7684\u9700\u6C42\u6536\u655B\u8865\u4E01");
          const resolved = await writeJson("convergence", { action: "resolve", reqId: match.matchedReqId, resolution: "confirm_converge", patchId: patch.patchId, patchHash: patch.patchHash, baseRequirementHash: patch.baseRequirementHash }, root);
          const revision = resolved?.applied?.result?.revision ?? resolved?.applied?.revision ?? null;
          setReceipt({ receipt: { id: `\u{1F9F2} ${match.matchedReqId}${revision ? ` v${revision}` : ""}` }, artifacts: [], replayed: false });
          setNotice(`\u{1F9F2} \u5DF2\u5C06\u8DE8\u7A97\u53E3\u53CD\u9988\u5438\u9644\u5230 ${match.matchedReqId}${revision ? `\uFF0C\u5DF2\u5347\u7EA7\u81F3 v${revision}` : ""}\u3002`);
          onOpenRequirement?.(match.matchedReqId);
        } catch (caught) {
          setError(errorOf(caught));
        } finally {
          setBusy(false);
        }
      };
      const renderInput = () => h(
        "div",
        { style: { marginTop: "4px" } },
        renderHistory(),
        requirementMatch ? h(
          "section",
          { role: "status", "data-testid": "requirement-match", style: { border: `1px solid ${T.brand}`, borderRadius: "8px", background: T.layer2, padding: "10px 12px", marginBottom: "10px" } },
          h("div", { style: { fontSize: "13px", color: T.text, fontWeight: 600, lineHeight: 1.6 } }, `\u{1F9F2} \u68C0\u6D4B\u5230\u4E0E\u5DF2\u6709\u9700\u6C42 [${requirementMatch.matchedReqId}: ${requirementMatch.matchedTitle}] \u9AD8\u5EA6\u76F8\u5173`),
          h("div", { style: { marginTop: "3px", fontSize: "11.5px", color: T.text2, lineHeight: 1.6 } }, requirementMatch.reason),
          h(
            "label",
            { style: { display: "flex", alignItems: "flex-start", gap: "7px", marginTop: "8px", color: T.text2, fontSize: "12px", cursor: "pointer" } },
            h("input", { type: "checkbox", checked: attachMatchedFeedback, onChange: (event) => setAttachMatchedFeedback(event.target.checked) }),
            h("span", null, attachMatchedFeedback ? "\u4F5C\u4E3A\u8BE5\u9700\u6C42\u7684\u8FED\u4EE3\u53CD\u9988\u6536\u655B\uFF08\u5C06\u5347\u7EA7\u7248\u672C\uFF09" : "\u4ECD\u4F5C\u4E3A\u5168\u65B0\u72EC\u7ACB\u9700\u6C42\u521B\u5EFA")
          )
        ) : null,
        h(
          "div",
          {
            onDragOver,
            onDragLeave,
            onDrop,
            style: {
              border: `1px solid ${dragging || composerFocused ? T.brand : T.line}`,
              borderRadius: "8px",
              background: T.layer,
              padding: "14px 16px 10px",
              transition: "border-color .15s ease"
            }
          },
          renderImageTray(),
          h("textarea", {
            value: rawText,
            name: "intent-statement",
            autoComplete: "off",
            "data-modal-initial-focus": "true",
            "aria-label": "\u7528\u4F60\u81EA\u5DF1\u7684\u8BDD\u5199\u4E0B\u60F3\u6539\u53D8\u4EC0\u4E48",
            onFocus: () => setComposerFocused(true),
            onBlur: (event) => {
              setComposerFocused(false);
              refreshRequirementMatch(event.target.value);
            },
            onPaste,
            onChange: (event) => {
              const value = event.target.value;
              setRawText(value);
              setRequirementMatch(null);
              setError(null);
            },
            placeholder: "\u4F8B\u5982\uFF1A\u9000\u6B3E\u8FD9\u91CC\u8001\u662F\u91CD\u590D\u9000\uFF0C\u8D22\u52A1\u5BF9\u8D26\u5F88\u9EBB\u70E6\uFF1B\u8981\u4FDD\u8BC1\u540C\u4E00\u7B14\u8BA2\u5355\u53EA\u9000\u4E00\u6B21\uFF0C\u5E76\u53D1\u4E5F\u4E0D\u80FD\u91CD\u590D\u6263\u6B3E\u3002",
            style: {
              minWidth: 0,
              width: "100%",
              minHeight: "132px",
              resize: "vertical",
              fontFamily: "inherit",
              fontSize: "14px",
              lineHeight: 1.8,
              color: T.text,
              boxSizing: "border-box",
              border: 0,
              background: "transparent",
              padding: "0"
            }
          }),
          h(
            "div",
            { style: { display: "flex", alignItems: "center", gap: "2px", flexWrap: "wrap", marginTop: "6px" } },
            h(
              "button",
              { type: "button", onClick: () => fileInputRef.current?.click(), title: "\u9009\u62E9\u56FE\u7247", style: { ...quietAction, display: "inline-flex", alignItems: "center", gap: "4px", cursor: "pointer" } },
              "\uFF0B \u56FE\u7247"
            ),
            h("input", { ref: fileInputRef, type: "file", name: "intent-images", "aria-label": "\u9009\u62E9\u56FE\u7247", accept: "image/png,image/jpeg,image/webp", multiple: true, onChange: onFile, style: { display: "none" } }),
            h("span", { style: { color: T.text3, fontSize: "12px" } }, "\xB7"),
            h(
              "button",
              {
                type: "button",
                "aria-pressed": source === "chat",
                onClick: () => setSource(source === "chat" ? "text" : "chat"),
                style: { ...quietAction, color: source === "chat" ? T.text : T.text2 }
              },
              source === "chat" ? "\u6536\u8D77\u804A\u5929\u8BB0\u5F55" : "\u4ECE\u804A\u5929\u8BB0\u5F55\u8865\u5145"
            ),
            h(
              "span",
              { style: { marginLeft: "auto", fontSize: "11.5px", color: T.text3, textAlign: "right" } },
              images.length > 0 ? `\u53EF\u7C98\u8D34\u622A\u56FE\u6216\u62D6\u5165\u56FE\u7247 \xB7 \u56FE\u7247 ${images.length}/${INTENT_MAX_IMAGES}` : "\u53EF\u7C98\u8D34\u622A\u56FE\u3001\u62D6\u5165\u56FE\u7247\uFF0C\u70B9\u300C\u5206\u6790\u610F\u56FE\u300D\u540E\u624D\u8BC6\u522B"
            )
          )
        ),
        source === "chat" ? h("div", { style: { marginTop: "10px" } }, renderSourcePanel()) : null,
        notice ? h("p", { role: "status", "aria-live": "polite", style: { margin: "10px 0 0", color: T.text2, fontSize: "12px", lineHeight: 1.7 } }, notice) : null,
        error ? renderError(error) : null
      );
      const renderAnalyzing = () => {
        const recognizing = analyzePhase?.phase === "ocr";
        const total = analyzePhase?.total ?? images.length;
        const index = total > 0 ? Math.min(analyzePhase?.index ?? 0, total - 1) : 0;
        const imageRows = images.map((image) => {
          const lines = imageLines(image);
          const status = image.status === "recognizing" ? "\u6B63\u5728\u672C\u5730\u8BC6\u522B\u6587\u5B57\u2026" : image.status === "failed" ? `\u8BC6\u522B\u5931\u8D25\uFF1A${image.error ?? "\u672A\u77E5\u9519\u8BEF"}` : image.data?.schema === "alm.ocr/v1" || image.status === "recognized" ? `\u5DF2\u8BC6\u522B ${lines.length} \u884C` : "\u7B49\u5F85\u8BC6\u522B";
          const tone = image.status === "failed" ? "error" : image.status === "recognizing" ? "warn" : image.data?.schema === "alm.ocr/v1" || image.status === "recognized" ? "success" : "neutral";
          return h(
            "li",
            { key: image.id, style: { display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap", padding: "3px 0", borderBottom: `1px solid ${T.line}` } },
            h("span", { style: { fontSize: "12.5px", color: T.text } }, image.name),
            tonePill(tone, status)
          );
        });
        return h(
          "div",
          { style: { marginTop: "10px" } },
          h(
            "div",
            { style: { ...card, cursor: "default" } },
            h(
              "div",
              { style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } },
              tonePill(recognizing ? "warn" : "neutral", recognizing ? "\u8BC6\u522B\u56FE\u7247\u6587\u5B57" : "\u5206\u6790\u4E2D"),
              h("span", { style: muted }, "\u53EA\u663E\u793A\u771F\u5B9E\u9636\u6BB5\uFF0C\u4E0D\u4F2A\u9020\u8FDB\u5EA6\u767E\u5206\u6BD4")
            ),
            images.length > 0 ? h(
              "div",
              { style: { marginTop: "10px" } },
              h(
                "p",
                { style: { margin: "0 0 4px", fontSize: "12px", color: T.text2 } },
                recognizing ? `\u5148\u8BC6\u522B\u56FE\u7247\u91CC\u7684\u6587\u5B57\uFF08\u7B2C ${index + 1}/${total} \u5F20\uFF0C\u672C\u5730 OCR\uFF0C\u56FE\u7247\u4E0D\u4E0A\u4F20\uFF09\uFF1B\u8BC6\u522B\u5B8C\u518D\u63D0\u4EA4\u610F\u56FE\u5206\u6790\u3002` : `\u56FE\u7247\u6587\u5B57\u5DF2\u8BC6\u522B\uFF08${images.length} \u5F20\uFF09\uFF1B\u8FD9\u4E9B\u6587\u5B57\u53EA\u4F5C\u4E3A\u5206\u6790\u6750\u6599\uFF0C\u4E0D\u4F1A\u6539\u5199\u4F60\u7684\u539F\u8BDD\u3002`
              ),
              h("ul", { style: { margin: 0, padding: 0, listStyle: "none" } }, imageRows)
            ) : null,
            h(
              "ol",
              { style: { margin: "10px 0 0", paddingLeft: "20px", fontSize: "12.5px", lineHeight: 2, color: T.text2 } },
              INTENT_STAGES.map(
                (label, position) => h(
                  "li",
                  {
                    key: label,
                    style: {
                      color: recognizing ? T.text3 : position === 0 && String(analyzePhase?.phase ?? "") === "analyze" ? T.text : T.text2
                    }
                  },
                  label
                )
              )
            ),
            h("p", { style: { margin: "10px 0 0", ...muted } }, "\u53D6\u6D88\u540E\u65E7\u7ED3\u679C\u4E0D\u4F1A\u5199\u5165\u754C\u9762\uFF1B\u5DF2\u5B8C\u6210\u8BC6\u522B\u7684\u56FE\u7247\u5728\u91CD\u8BD5\u65F6\u4E0D\u4F1A\u91CD\u590D\u8BC6\u522B\u3002")
          )
        );
      };
      const renderQuestion = () => {
        const question = session?.nextQuestion;
        if (!question) return null;
        const options = (question.options ?? []).slice(0, 3);
        const selected = answerChoice;
        const canSubmit = selected !== null || questionText.trim() !== "";
        const select = (id) => {
          if (answerBusy) return;
          setAnswerFeedback(null);
          setAnswerChoice((current) => current === id ? null : id);
        };
        return h(
          "div",
          { style: { ...card, cursor: "default", marginTop: "12px", borderColor: T.line2 } },
          h(
            "div",
            { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
            tonePill("neutral", "\u9700\u8981\u4F60\u56DE\u7B54\u4E00\u4E2A\u95EE\u9898"),
            h("span", { style: muted }, "\u4E00\u6B21\u53EA\u95EE\u4E00\u4E2A\uFF1B\u5148\u9009\u62E9\uFF0C\u518D\u63D0\u4EA4")
          ),
          h("div", { style: { marginTop: "8px", fontSize: "13.5px", color: T.text, lineHeight: 1.8 } }, question.text),
          question.whyNow ? h("p", { style: { margin: "4px 0 0", ...muted, lineHeight: 1.7 } }, `\u4E3A\u4EC0\u4E48\u73B0\u5728\u95EE\uFF1A${question.whyNow}`) : null,
          h(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: "6px", marginTop: "10px" } },
            options.map((option) => {
              const active = selected === option.id;
              return h(
                "button",
                {
                  key: option.id,
                  type: "button",
                  "aria-pressed": active,
                  disabled: answerBusy,
                  onClick: () => select(option.id),
                  style: {
                    textAlign: "left",
                    ...button,
                    padding: "8px 10px",
                    display: "flex",
                    gap: "8px",
                    alignItems: "flex-start",
                    width: "100%",
                    borderColor: active ? T.brand : T.line,
                    background: active ? T.layer2 : T.layer,
                    boxShadow: active ? `inset 0 0 0 1px ${T.brand}` : "none",
                    cursor: answerBusy ? "default" : "pointer"
                  }
                },
                h("span", {
                  "aria-hidden": "true",
                  style: {
                    flex: "0 0 auto",
                    width: "14px",
                    height: "14px",
                    marginTop: "2px",
                    borderRadius: "50%",
                    border: `2px solid ${active ? T.brand : T.ln2 ?? T.line}`,
                    background: active ? T.brand : "transparent",
                    boxSizing: "border-box",
                    display: "inline-block"
                  }
                }),
                h(
                  "span",
                  { style: { display: "block", minWidth: 0, flex: "1 1 auto" } },
                  h("span", { style: { display: "block", fontSize: "12.5px", color: T.text, wordBreak: "break-word" } }, option.label),
                  option.impact ? h("span", { style: { display: "block", marginTop: "2px", fontSize: "11.5px", color: T.text3, lineHeight: 1.6 } }, `\u5F71\u54CD\uFF1A${option.impact}`) : null
                )
              );
            }),
            h(
              "button",
              {
                type: "button",
                "aria-pressed": selected === "unknown",
                disabled: answerBusy,
                onClick: () => select("unknown"),
                style: {
                  textAlign: "left",
                  ...button,
                  padding: "8px 10px",
                  borderColor: selected === "unknown" ? T.warn : T.line,
                  background: selected === "unknown" ? T.layer2 : T.layer,
                  color: T.text2,
                  cursor: answerBusy ? "default" : "pointer"
                }
              },
              h("span", { style: { display: "block", fontSize: "12.5px" } }, "\u4E0D\u77E5\u9053 / \u9700\u8981\u8C03\u67E5"),
              h("span", { style: { display: "block", marginTop: "2px", fontSize: "11.5px", color: T.text3 } }, "\u5F53\u524D\u8BC1\u636E\u4E0D\u8DB3\u65F6\u9009\u8FD9\u4E2A\uFF1B\u4E0D\u4F1A\u5047\u88C5\u5DF2\u7ECF\u56DE\u7B54\u3002")
            )
          ),
          h("input", {
            value: questionText,
            name: "intent-answer",
            autoComplete: "off",
            onChange: (event) => {
              setAnswerFeedback(null);
              setQuestionText(event.target.value);
            },
            onKeyDown: (event) => {
              if (event.key === "Enter" && canSubmit && !answerBusy) {
                event.preventDefault();
                submitAnswer();
              }
            },
            placeholder: "\u6216\u8005\u76F4\u63A5\u5199\u4E0B\u4F60\u7684\u56DE\u7B54",
            disabled: answerBusy,
            "aria-label": "\u81EA\u7531\u56DE\u7B54",
            style: { ...input, width: "100%", marginTop: "8px", boxSizing: "border-box", minWidth: 0 }
          }),
          h(
            "div",
            { style: { display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap", alignItems: "center" } },
            h(
              "button",
              {
                type: "button",
                style: primaryState(answerBusy || !canSubmit),
                disabled: answerBusy || !canSubmit,
                onClick: () => submitAnswer()
              },
              answerBusy ? `\u63D0\u4EA4\u4E2D\u2026\uFF08\u5DF2\u7528 ${answerElapsed}s\uFF09` : "\u63D0\u4EA4\u56DE\u7B54"
            ),
            answerBusy ? h("button", { type: "button", style: button, onClick: () => cancelAnswer() }, "\u53D6\u6D88\u63D0\u4EA4") : h(
              "button",
              {
                type: "button",
                style: button,
                onClick: () => startInvestigation(question.text),
                disabled: !session?.sessionId || investigation.busy
              },
              "\u8C03\u67E5\u8FD9\u4E2A\u95EE\u9898\uFF08\u53EA\u8BFB\uFF09"
            )
          ),
          h("p", { style: { margin: "4px 0 0", ...muted, lineHeight: 1.6 } }, "\u201C\u8C03\u67E5\u201D\u53EA\u8BFB\u53D6\u5F53\u524D\u9879\u76EE\u4EE3\u7801\uFF0C\u4E0D\u4FEE\u6539\u6587\u4EF6\uFF1B\u8BC1\u636E\u9700\u8981\u4F60\u6838\u5BF9\u3002"),
          answerFeedback ? h(
            "div",
            { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", marginTop: "8px" } },
            tonePill(answerFeedback.kind === "success" || answerFeedback.kind === "uncertain" ? "warn" : "error", answerFeedback.kind === "success" ? "\u5DF2\u8BB0\u5F55\u56DE\u7B54" : answerFeedback.kind === "analysis-error" ? "\u56DE\u7B54\u5DF2\u8BB0\u5F55" : answerFeedback.kind === "uncertain" ? "\u7ED3\u679C\u672A\u77E5" : "\u63D0\u4EA4\u5931\u8D25"),
            h("span", { role: "status", style: { fontSize: "12px", color: T.text2, flex: "1 1 220px", minWidth: 0, wordBreak: "break-word", lineHeight: 1.7 } }, answerFeedback.message),
            answerFeedback.retry ? h("button", { type: "button", style: button, disabled: answerBusy, onClick: () => submitAnswer() }, "\u91CD\u8BD5") : null,
            answerFeedback.kind === "uncertain" ? renderAnswerCheck() : null
          ) : null
        );
      };
      const renderTimingLine = () => {
        const text = groupTimingText(null);
        if (!text) return null;
        return h("span", { "data-testid": "intent-timing", style: muted }, text);
      };
      const renderDraftSummary = () => {
        const items = activeItems();
        const first = items[0];
        if (!first) return null;
        const candidate = candidateOf(first);
        const title2 = candidate.title || first.title || "\uFF08\u672A\u547D\u540D\u8349\u7A3F\uFF09";
        const goal = candidate.goal || first.desiredOutcome || first.userProblem || "\uFF08\u8FD8\u6CA1\u6709\u4E00\u53E5\u8BDD\u76EE\u6807\uFF09";
        const readiness = confirmationGate();
        const pending = analysisPending();
        const ready = readiness.ready;
        const reasons = readiness.reasons;
        const phase = draftPhase();
        return h(
          "div",
          {
            "data-testid": "intent-draft-bar",
            style: { position: "sticky", top: 0, zIndex: 3, borderBottom: `1px solid ${T.line2}`, background: T.base, padding: "8px 0", marginBottom: "10px" }
          },
          h(
            "div",
            { style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } },
            tonePill(phase.tone, phase.label),
            h("span", { style: { flex: "1 1 200px", minWidth: 0, fontSize: "13px", fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, title2),
            h(
              "button",
              {
                type: "button",
                style: button,
                "aria-expanded": draftBarExpanded,
                "aria-label": "\u5C55\u5F00\u6216\u6536\u8D77\u8349\u7A3F\u6458\u8981",
                onClick: () => toggleDraftBar()
              },
              draftBarExpanded ? "\u6536\u8D77\u8349\u7A3F\u6458\u8981" : "\u5C55\u5F00\u8349\u7A3F\u6458\u8981"
            )
          ),
          h("div", { "data-testid": "intent-draft-goal", style: { marginTop: "2px", fontSize: "12px", color: T.text2, lineHeight: 1.7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, goal),
          draftBarExpanded ? h(
            "div",
            { style: { marginTop: "6px", borderTop: `1px solid ${T.line}`, paddingTop: "6px" } },
            h(
              "div",
              { style: { fontSize: "12px", color: T.text2, lineHeight: 1.8, whiteSpace: "pre-wrap", wordBreak: "break-word" } },
              [`\u76EE\u6807\uFF1A${goal}`, candidate.problem ? `\u95EE\u9898\uFF1A${candidate.problem}` : null, reasons.length ? `\u672A\u5C31\u7EEA\u539F\u56E0\uFF1A${reasons.map((reason) => reason?.message ?? reason?.code ?? String(reason)).join("\uFF1B")}` : null].filter(Boolean).join("\n")
            ),
            h(
              "div",
              { style: { display: "flex", gap: "8px", marginTop: "6px", flexWrap: "wrap", alignItems: "center" } },
              h("button", { type: "button", style: button, onClick: () => jumpToCandidate() }, "\u8DF3\u5230\u5019\u9009\u533A"),
              renderTimingLine()
            )
          ) : null
        );
      };
      const renderGroupQuestionCard = (question, index) => {
        const questionId = question.questionId;
        const answered = question.status === "answered";
        const stale = question.status === "stale";
        const interactionLocked = groupInteractionLocked();
        const editing = editingQuestionId === questionId;
        const answer = activeAnswerOf(questionId);
        if (answered && !editing) {
          const label = answer?.optionLabel ?? (answer?.optionId ? answer.optionId : null);
          const extra = typeof answer?.text === "string" && answer.text.trim() !== "" ? answer.text.trim() : null;
          return h(
            "div",
            {
              key: questionId,
              "data-question-id": questionId,
              "data-status": "answered",
              style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", borderBottom: `1px solid ${T.line}`, padding: "8px 0", marginBottom: "6px" }
            },
            tonePill("success", "\u5DF2\u56DE\u7B54"),
            h("span", { style: { flex: "1 1 220px", minWidth: 0, fontSize: "12.5px", color: T.text, lineHeight: 1.7, wordBreak: "break-word" } }, answer?.questionText ?? question.text),
            label ? h("span", { style: { fontSize: "12px", color: T.text2 } }, `\u9009\u62E9\uFF1A${label}`) : null,
            extra ? h("span", { style: { fontSize: "11.5px", color: T.text3, wordBreak: "break-word" } }, `\u8865\u5145\uFF1A${extra}`) : null,
            h(
              "button",
              { type: "button", style: button, onClick: () => startEditingQuestion(questionId), "aria-label": `\u4FEE\u6539\u7B2C ${index + 1} \u4E2A\u95EE\u9898\u7684\u56DE\u7B54` },
              "\u4FEE\u6539"
            )
          );
        }
        const draft = groupDraftFor(question);
        const options = (Array.isArray(question.options) ? question.options : []).filter((option) => option && option.id).slice(0, 3);
        const whyExpanded = expandedWhy[questionId] === true;
        const selectOption = (optionId) => {
          if (groupInteractionLocked()) return;
          setGroupDraft(questionId, { optionId: draft.optionId === optionId ? null : optionId, undecided: false });
        };
        const selectUndecided = () => {
          if (groupInteractionLocked()) return;
          setGroupDraft(questionId, { undecided: draft.undecided !== true, optionId: null });
        };
        return h(
          "div",
          {
            key: questionId,
            "data-question-id": questionId,
            "data-status": question.status ?? "open",
            "data-materiality": question.materiality ?? "blocking",
            ...question.recommendedOptionId ? { "data-recommended-option-id": question.recommendedOptionId } : {},
            style: { ...card, cursor: "default", padding: "12px 14px", marginBottom: "8px", borderColor: stale ? T.warn : T.line2 }
          },
          h(
            "div",
            { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
            tonePill(stale ? "warn" : "neutral", `\u7B2C ${index + 1} \u4E2A\u95EE\u9898`),
            h("span", { style: muted }, stale ? "\u4F9D\u636E\u5DF2\u53D8\u5316\uFF0C\u786E\u8BA4\u540E\u91CD\u65B0\u63D0\u4EA4" : "\u53EF\u4EE5\u53EA\u56DE\u7B54\u5176\u4E2D\u4E00\u90E8\u5206")
          ),
          stale ? h(
            "div",
            {
              "data-testid": "intent-stale-badge",
              role: "status",
              style: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap", marginTop: "6px", fontSize: "12px", color: T.warn, lineHeight: 1.7 }
            },
            tonePill("warn", "\u5F85\u91CD\u65B0\u6838\u5BF9"),
            h("span", { style: { flex: "1 1 220px", minWidth: 0, wordBreak: "break-word" } }, question.staleReason ?? "\u4F9D\u636E\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u6838\u5BF9")
          ) : null,
          h("div", { style: { marginTop: "8px", fontSize: "13.5px", color: T.text, lineHeight: 1.8, wordBreak: "break-word" } }, question.text),
          question.impact ? h("div", { style: { marginTop: "4px", fontSize: "12px", color: T.text2, lineHeight: 1.7, wordBreak: "break-word" } }, `\u5F71\u54CD\uFF1A${question.impact}`) : null,
          question.whyNow ? h(
            "div",
            { style: { marginTop: "4px" } },
            h(
              "button",
              {
                type: "button",
                style: { ...button, padding: "2px 8px" },
                "aria-expanded": whyExpanded,
                onClick: () => setExpandedWhy((current) => ({ ...current, [questionId]: !whyExpanded }))
              },
              whyExpanded ? "\u6536\u8D77\u201C\u4E3A\u4EC0\u4E48\u73B0\u5728\u95EE\u201D" : "\u4E3A\u4EC0\u4E48\u73B0\u5728\u95EE"
            ),
            whyExpanded ? h("p", { style: { margin: "4px 0 0", fontSize: "12px", color: T.text2, lineHeight: 1.8, whiteSpace: "pre-wrap", wordBreak: "break-word" } }, question.whyNow) : null
          ) : null,
          h(
            "div",
            { role: "group", "aria-label": `\u7B2C ${index + 1} \u4E2A\u95EE\u9898\u7684\u9009\u9879`, style: { display: "flex", flexDirection: "column", gap: "6px", marginTop: "10px" } },
            options.map((option) => {
              const active = draft.undecided !== true && draft.optionId === option.id;
              const recommended = question.recommendedOptionId != null && question.recommendedOptionId === option.id;
              return h(
                "button",
                {
                  key: option.id,
                  type: "button",
                  "data-option-id": option.id,
                  ...recommended ? { "data-testid": `intent-recommended-option-${questionId}` } : {},
                  "aria-pressed": active,
                  disabled: interactionLocked,
                  onClick: () => selectOption(option.id),
                  style: {
                    ...button,
                    textAlign: "left",
                    padding: "8px 10px",
                    display: "flex",
                    gap: "8px",
                    alignItems: "flex-start",
                    width: "100%",
                    borderColor: active ? T.brand : T.line,
                    background: active ? T.layer2 : T.layer,
                    boxShadow: active ? `inset 0 0 0 1px ${T.brand}` : "none",
                    cursor: groupBusy ? "default" : "pointer",
                    opacity: groupBusy ? 0.75 : 1
                  }
                },
                h("span", {
                  "aria-hidden": "true",
                  style: { width: "12px", height: "12px", borderRadius: "999px", border: `1px solid ${active ? T.brand : T.line}`, background: active ? T.brand : "transparent", flex: "0 0 auto", marginTop: "3px" }
                }),
                h(
                  "span",
                  { style: { display: "block", minWidth: 0, flex: "1 1 auto" } },
                  h(
                    "span",
                    { style: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap", fontSize: "12.5px", color: T.text, lineHeight: 1.7, wordBreak: "break-word" } },
                    h("span", null, option.label ?? option.id),
                    recommended ? tonePill("neutral", "\u63A8\u8350\u9ED8\u8BA4") : null
                  ),
                  option.impact ? h("span", { style: { display: "block", marginTop: "2px", fontSize: "11.5px", color: T.text3, lineHeight: 1.6, wordBreak: "break-word" } }, `\u5F71\u54CD\uFF1A${option.impact}`) : null
                )
              );
            }),
            h(
              "button",
              {
                type: "button",
                "aria-pressed": draft.undecided === true,
                disabled: interactionLocked,
                onClick: selectUndecided,
                style: {
                  ...button,
                  textAlign: "left",
                  padding: "8px 10px",
                  borderColor: draft.undecided === true ? T.warn : T.line,
                  background: draft.undecided === true ? T.layer2 : T.layer,
                  color: T.text2,
                  cursor: groupBusy ? "default" : "pointer",
                  opacity: groupBusy ? 0.75 : 1
                }
              },
              h("span", { style: { display: "block", fontSize: "12.5px" } }, "\u5C1A\u4E0D\u80FD\u51B3\u5B9A"),
              h("span", { style: { display: "block", marginTop: "2px", fontSize: "11.5px", color: T.text3, lineHeight: 1.6 } }, "\u63D0\u4EA4\u201C\u5C1A\u4E0D\u80FD\u51B3\u5B9A\uFF0C\u9700\u8981\u8C03\u67E5\u201D\uFF0C\u4E0D\u4F1A\u5047\u88C5\u5DF2\u51B3\u5B9A\u3002")
            )
          ),
          h("textarea", {
            "data-role": "free-text",
            name: `intent-question-${questionId}`,
            autoComplete: "off",
            value: draft.text ?? "",
            onChange: (event) => setGroupDraft(questionId, { text: event.target.value }),
            placeholder: question.allowFreeText === false ? "\u8865\u5145\u8BF4\u660E\uFF08\u53EF\u9009\uFF09" : "\u6216\u8005\u76F4\u63A5\u5199\u4E0B\u4F60\u7684\u56DE\u7B54",
            disabled: interactionLocked,
            "aria-label": `\u7B2C ${index + 1} \u4E2A\u95EE\u9898\u7684\u56DE\u7B54`,
            rows: 2,
            style: { ...input, width: "100%", minWidth: 0, boxSizing: "border-box", marginTop: "8px", resize: "vertical", fontFamily: "inherit", lineHeight: 1.7 }
          }),
          editing ? h(
            "div",
            { style: { display: "flex", gap: "8px", marginTop: "6px", flexWrap: "wrap" } },
            h(
              "button",
              {
                type: "button",
                style: button,
                onClick: () => {
                  setEditingQuestionId(null);
                  setGroupDrafts((current) => {
                    const next = { ...current };
                    delete next[questionId];
                    return next;
                  });
                }
              },
              "\u53D6\u6D88\u4FEE\u6539"
            )
          ) : null
        );
      };
      const renderRecommendationCard = (question, index) => {
        const questionId = question.questionId;
        const recommendedOption = (question.options ?? []).find((option) => option?.id === question.recommendedOptionId) ?? null;
        const draft = groupDraftFor(question);
        const persisted = question.status === "answered";
        const interactionLocked = groupInteractionLocked();
        const adopted = Boolean(recommendedOption && draft.optionId === recommendedOption.id && draft.undecided !== true);
        return h(
          "div",
          {
            key: questionId,
            "data-testid": "intent-recommendation-card",
            "data-question-id": questionId,
            "data-status": question.status ?? "suggested",
            "data-materiality": question.materiality ?? "reversible",
            ...question.recommendedOptionId ? { "data-recommended-option-id": question.recommendedOptionId } : {},
            style: { ...card, cursor: "default", padding: "12px 14px", marginBottom: "8px", borderColor: T.line2 }
          },
          h(
            "div",
            { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
            tonePill("neutral", `\u5EFA\u8BAE ${index + 1}`),
            tonePill("neutral", question.materiality === "reversible" ? "\u53EF\u9006\u5EFA\u8BAE" : "\u5EFA\u8BAE"),
            h("span", { style: muted }, "\u4EC5\u5728\u4F60\u660E\u786E\u91C7\u7528\u540E\u624D\u4F1A\u63D0\u4EA4")
          ),
          h("div", { style: { marginTop: "8px", fontSize: "13.5px", color: T.text, lineHeight: 1.8, wordBreak: "break-word" } }, question.text),
          question.impact ? h("div", { style: { marginTop: "4px", fontSize: "12px", color: T.text2, lineHeight: 1.7, wordBreak: "break-word" } }, `\u5F71\u54CD\uFF1A${question.impact}`) : null,
          recommendedOption ? h(
            "div",
            {
              "data-testid": `intent-recommended-option-${questionId}`,
              "data-option-id": recommendedOption.id,
              style: { marginTop: "8px", border: `1px solid ${adopted ? T.brand : T.line}`, borderRadius: "9px", padding: "8px 10px", background: adopted ? T.layer2 : T.layer }
            },
            h("div", { style: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap", fontSize: "12.5px", color: T.text } }, tonePill("neutral", "\u63A8\u8350\u9ED8\u8BA4"), h("span", null, recommendedOption.label ?? recommendedOption.id)),
            recommendedOption.impact ? h("div", { style: { marginTop: "2px", fontSize: "11.5px", color: T.text3, lineHeight: 1.6 } }, `\u5F71\u54CD\uFF1A${recommendedOption.impact}`) : null
          ) : h("p", { style: { margin: "8px 0 0", color: T.warn, fontSize: "12px" } }, "\u63A8\u8350\u9009\u9879\u65E0\u6548\uFF0C\u4E0D\u80FD\u91C7\u7528\u3002"),
          h(
            "div",
            { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", marginTop: "8px" } },
            h(
              "button",
              {
                type: "button",
                "data-testid": `intent-adopt-recommendation-${questionId}`,
                "data-action": "adopt-recommendation",
                style: adopted ? button : primary,
                disabled: interactionLocked || persisted || !recommendedOption,
                "aria-pressed": adopted,
                onClick: () => {
                  if (!recommendedOption || interactionLocked || persisted) return;
                  setGroupDraft(questionId, { optionId: adopted ? null : recommendedOption.id, text: "", undecided: false });
                }
              },
              persisted ? "\u5DF2\u91C7\u7528\u5E76\u63D0\u4EA4" : adopted ? "\u53D6\u6D88\u5F85\u63D0\u4EA4\u91C7\u7528" : "\u91C7\u7528\u63A8\u8350"
            ),
            persisted ? h("span", { role: "status", style: muted }, "\u63A8\u8350\u5DF2\u4F5C\u4E3A\u660E\u786E\u56DE\u7B54\u4FDD\u5B58\uFF1B\u5982\u9700\u66F4\u6539\uFF0C\u8BF7\u5728\u201C\u5DF2\u786E\u8BA4\u51B3\u5B9A\u201D\u4E2D\u4FEE\u6539\u5BF9\u5E94\u95EE\u9898\u3002") : adopted ? h("span", { role: "status", style: muted }, "\u5DF2\u9009\u62E9\uFF0C\u5C1A\u672A\u63D0\u4EA4\uFF1B\u8BF7\u70B9\u51FB\u201C\u63D0\u4EA4\u672C\u7EC4\u56DE\u7B54\u201D\u3002") : null
          )
        );
      };
      const renderGroupFeedback = () => {
        if (!groupFeedback) {
          const timing = groupTimingText(null);
          return timing ? h("p", { style: { margin: "8px 0 0", ...muted, lineHeight: 1.7 } }, timing) : null;
        }
        const saved = typeof groupFeedback.saveMs === "number" ? `\u5DF2\u4FDD\u5B58 ${groupFeedback.count ?? 0} \u6761\u56DE\u7B54\uFF08${Math.max(0, Math.round(groupFeedback.saveMs))}ms\uFF09` : null;
        const running = groupFeedback.kind === "running" ? `\u6B63\u5728\u6839\u636E\u56DE\u7B54\u91CD\u65B0\u5206\u6790\u2026 \u5DF2\u7528 ${groupFeedback.elapsed ?? 0}s` : null;
        const stillWorking = groupFeedback.kind === "running" && (groupFeedback.elapsed ?? 0) > 20 ? "\u6A21\u578B\u4ECD\u5728\u5904\u7406\uFF0C\u56DE\u7B54\u5DF2\u4FDD\u5B58" : null;
        const done = groupFeedback.kind === "done" ? ["\u91CD\u65B0\u5206\u6790\u5B8C\u6210", groupFeedback.timing].filter(Boolean).join("\uFF1B") : null;
        const problem = ["save-error", "analysis-error", "error", "timeout", "uncertain"].includes(groupFeedback.kind) ? groupFeedback.message : null;
        const line = [saved, running, stillWorking, done, problem].filter(Boolean).join(" \xB7 ");
        return h(
          "div",
          {
            ref: groupFeedbackRef,
            tabIndex: -1,
            "data-testid": "intent-group-feedback",
            style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", marginTop: "8px", border: `1px solid ${T.line2}`, borderRadius: "10px", padding: "8px 10px", background: T.layer }
          },
          groupFeedback.kind === "done" ? tonePill("success", "\u5B8C\u6210") : groupFeedback.kind === "running" ? tonePill("neutral", "\u5206\u6790\u4E2D") : groupFeedback.kind === "uncertain" ? tonePill("warn", "\u7ED3\u679C\u672A\u77E5") : groupFeedback.kind === "save-error" || groupFeedback.kind === "error" ? tonePill("error", "\u63D0\u4EA4\u5931\u8D25") : groupFeedback.kind === "analysis-error" ? tonePill("error", "\u5206\u6790\u5931\u8D25") : tonePill("warn", "\u5206\u6790\u8D85\u65F6"),
          h("span", { role: "status", style: { flex: "1 1 240px", minWidth: 0, fontSize: "12px", color: T.text2, lineHeight: 1.7, wordBreak: "break-word" } }, line || "\u5DF2\u5904\u7406\u3002"),
          groupFeedback.retry ? h("button", { type: "button", style: button, disabled: groupInteractionLocked() || !session?.sessionId, onClick: () => submitGroupAnswers() }, "\u91CD\u8BD5\u63D0\u4EA4") : null,
          groupFeedback.retryAnalysis ? h("button", { type: "button", style: button, disabled: busy || groupInteractionLocked(), onClick: () => runAnalyze() }, "\u91CD\u65B0\u5206\u6790") : null,
          groupFeedback.kind === "uncertain" ? renderAnswerCheck() : null
        );
      };
      const renderQuestionGroup = () => {
        const group = questionGroupOf();
        if (!group) return null;
        const progress = groupProgressOf(group);
        const dirtyCount = groupAnswersPayload(group).length;
        const manualSession = Boolean(session?.manual) && !session?.sessionId;
        const interactionLocked = groupInteractionLocked();
        return h(
          "div",
          { ref: groupPanelRef, "data-testid": "intent-question-group", style: { marginTop: "12px", borderTop: `1px solid ${T.line2}`, padding: "12px 0 0" } },
          h(
            "div",
            { style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } },
            tonePill("neutral", "\u95EE\u9898\u7EC4"),
            h("span", { style: muted }, "\u4E00\u6B21\u53EF\u63D0\u4EA4 1\u20133 \u4E2A\u56DE\u7B54\uFF1B\u63D0\u4EA4\u540E\u4E00\u8D77\u4FDD\u5B58"),
            h("span", { "data-testid": "intent-progress", style: { marginLeft: "auto", ...muted } }, groupProgressText(progress))
          ),
          manualSession ? h("p", { style: { margin: "6px 0 0", ...muted, lineHeight: 1.7 } }, "\u624B\u52A8\u4F1A\u8BDD\u8FD8\u6CA1\u6709\u670D\u52A1\u7AEF\u4F1A\u8BDD\uFF1A\u5148\u201C\u91CD\u65B0\u5206\u6790\u201D\u62FF\u5230\u4F1A\u8BDD\uFF0C\u518D\u63D0\u4EA4\u56DE\u7B54\u3002") : null,
          group.questions.length ? h("div", { style: { display: "flex", flexDirection: "column", gap: "0", marginTop: "10px" } }, group.questions.map((question, index) => renderGroupQuestionCard(question, index))) : null,
          group.recommendations.length ? h(
            "div",
            { "data-testid": "intent-recommendations", style: { marginTop: "10px", borderTop: `1px solid ${T.line}`, paddingTop: "10px" } },
            h("div", { style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "8px" } }, tonePill("neutral", "\u53EF\u9006\u5EFA\u8BAE"), h("span", { style: muted }, "\u63A8\u8350\u4E0D\u4F1A\u81EA\u52A8\u91C7\u7528\uFF1B\u70B9\u51FB\u91C7\u7528\u540E\u4ECD\u9700\u7EDF\u4E00\u63D0\u4EA4")),
            group.recommendations.map((question, index) => renderRecommendationCard(question, index))
          ) : null,
          h(
            "div",
            { style: { position: "sticky", bottom: 0, display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginTop: "10px", padding: "8px 0 2px", background: T.base } },
            h(
              "button",
              {
                type: "button",
                "data-testid": "intent-submit-group",
                style: primaryState(interactionLocked || dirtyCount === 0 || manualSession),
                disabled: interactionLocked || dirtyCount === 0 || manualSession,
                onClick: () => submitGroupAnswers()
              },
              groupBusy ? `\u4FDD\u5B58\u4E2D\u2026\uFF08\u5DF2\u7528 ${groupElapsed}s\uFF09` : interactionLocked ? "\u91CD\u65B0\u5206\u6790\u4E2D\u2026" : "\u63D0\u4EA4\u672C\u7EC4\u56DE\u7B54"
            ),
            groupBusy ? h("button", { type: "button", style: button, onClick: () => cancelGroupSubmit() }, "\u53D6\u6D88\u63D0\u4EA4") : null,
            dirtyCount === 0 ? h("span", { style: muted }, "\u9009\u62E9\u9009\u9879\u6216\u5199\u56DE\u7B54\u540E\u53EF\u63D0\u4EA4") : h("span", { style: muted }, `\u5F85\u63D0\u4EA4 ${dirtyCount} \u6761`)
          ),
          renderGroupFeedback()
        );
      };
      const renderConfirmedDecisions = () => {
        const answers = (session?.answers ?? []).filter((answer) => answer && !answer.supersededBy);
        if (answers.length === 0) return null;
        return h(
          "div",
          { style: { marginTop: "10px", border: `1px solid ${T.line}`, borderRadius: "8px", background: T.layer } },
          h(
            "button",
            {
              type: "button",
              "aria-expanded": decisionsOpen,
              onClick: () => setDecisionsOpen((current) => !current),
              style: { width: "100%", textAlign: "left", ...button, border: "none", background: "transparent", borderRadius: "8px", padding: "10px 12px", display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }
            },
            tonePill("neutral", "\u5DF2\u786E\u8BA4\u51B3\u5B9A"),
            h("span", { style: { fontSize: "12.5px", color: T.text2 } }, `${answers.length} \u6761`),
            h("span", { style: { marginLeft: "auto", fontSize: "12px", color: T.text3 } }, decisionsOpen ? "\u6536\u8D77" : "\u5C55\u5F00")
          ),
          decisionsOpen ? h(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: "6px", padding: "0 12px 10px" } },
            answers.map((answer, index) => {
              const questionText2 = typeof answer.questionText === "string" && answer.questionText.trim() !== "" ? answer.questionText : "\uFF08\u65E7\u4F1A\u8BDD\u672A\u4FDD\u5B58\u95EE\u9898\u539F\u6587\uFF09";
              const choice = answer.optionLabel ?? (answer.optionId ? answer.optionId : "\u81EA\u7531\u56DE\u7B54");
              const extra = typeof answer.text === "string" && answer.text.trim() !== "" ? answer.text.trim() : null;
              return h(
                "div",
                { key: answer.answerId ?? `${answer.questionId ?? answer.itemId ?? "answer"}-${index}`, style: { display: "flex", gap: "8px", alignItems: "flex-start", flexWrap: "wrap", border: `1px solid ${T.line}`, borderRadius: "9px", padding: "8px 10px", background: T.base } },
                h(
                  "div",
                  { style: { flex: "1 1 240px", minWidth: 0 } },
                  h("div", { style: { fontSize: "12.5px", color: T.text, lineHeight: 1.7, wordBreak: "break-word" } }, questionText2),
                  h("div", { style: { marginTop: "2px", fontSize: "12px", color: T.text2, lineHeight: 1.7, wordBreak: "break-word" } }, `\u9009\u62E9\uFF1A${choice}${extra ? ` \xB7 \u8865\u5145\uFF1A${extra}` : ""}`),
                  h("div", { style: { marginTop: "2px", fontSize: "11px", color: T.text3 } }, answer.at ? intentTime(answer.at) : "")
                ),
                answer.questionId ? h("button", { type: "button", style: button, onClick: () => startEditingQuestion(answer.questionId), "aria-label": `\u4FEE\u6539\u56DE\u7B54\uFF1A${questionText2}` }, "\u4FEE\u6539") : null
              );
            })
          ) : null
        );
      };
      const renderHistoricalAnswers = () => {
        const page = answerHistoryPage?.key === answerHistoryKey ? answerHistoryPage : null;
        const answers = [...Array.isArray(session?.historicalAnswers) ? session.historicalAnswers : [], ...page?.answers ?? []];
        if (!answers.length) return null;
        const next = page ? page.next : session.historicalAnswersNext;
        const loadMore = async () => {
          if (page?.loading || !Number.isSafeInteger(next)) return;
          const controller = new AbortController();
          answerHistoryAbort.current?.abort();
          answerHistoryAbort.current = controller;
          const key = answerHistoryKey, prior = page?.answers ?? [], snapshot = session.historicalAnswersSnapshot;
          let timeout;
          setAnswerHistoryPage({ key, answers: prior, next, loading: true, error: null });
          try {
            const query = new URLSearchParams({ root: root ?? "", project: explicitProject, action: "answer-history", session: session.sessionId, offset: String(next), snapshot });
            const data = await Promise.race([
              fetch(`/api/alm/requirements/intent?${query}`, { signal: controller.signal }).then(async (response) => {
                const body = await response.json();
                if (!response.ok || body?.ok === false) throw new Error(body?.error?.message ?? "\u8BFB\u53D6\u5931\u8D25");
                return body;
              }),
              new Promise((_, reject) => {
                timeout = setTimeout(() => {
                  controller.abort();
                  reject(new Error("\u8BFB\u53D6\u8D85\u65F6"));
                }, 1e4);
              })
            ]);
            if (answerHistoryKeyRef.current !== key || answerHistoryAbort.current !== controller) return;
            const validAnswer = (answer) => answer && typeof answer === "object" && !Array.isArray(answer) && ["answerId", "questionText", "optionId", "optionLabel", "text", "at"].every((field) => answer[field] == null || typeof answer[field] === "string") && (answer.inputRevision == null || Number.isSafeInteger(answer.inputRevision)) && typeof answer.superseded === "boolean";
            const validTotal = Number.isSafeInteger(data.total) && data.total > next;
            if (data.sessionId !== session.sessionId || data.snapshot !== snapshot || data.offset !== next || !validTotal || !Array.isArray(data.answers) || data.answers.length !== Math.min(20, data.total - next) || !data.answers.every(validAnswer) || data.next !== (next + 20 < data.total ? next + 20 : null)) throw new Error("\u56DE\u7B54\u5386\u53F2\u54CD\u5E94\u65E0\u6548\uFF0C\u8BF7\u91CD\u65B0\u52A0\u8F7D\u4F1A\u8BDD");
            setAnswerHistoryPage({ key, answers: [...prior, ...data.answers], next: data.next, loading: false, error: null });
          } catch (caught) {
            if (answerHistoryKeyRef.current === key && answerHistoryAbort.current === controller) setAnswerHistoryPage({ key, answers: prior, next, loading: false, error: caught?.message ?? "\u8BFB\u53D6\u5931\u8D25" });
          } finally {
            clearTimeout(timeout);
            if (answerHistoryAbort.current === controller) answerHistoryAbort.current = null;
          }
        };
        return h(
          "details",
          { style: { marginTop: "10px", color: T.text2, fontSize: "12px" } },
          h("summary", null, `\u5386\u53F2\u56DE\u7B54\uFF08${answers.length} \u6761\uFF09`),
          h("p", null, "\u4EE5\u4E0B\u56DE\u7B54\u4EC5\u4F9B\u8FFD\u6EAF\uFF0C\u4E0D\u4F5C\u4E3A\u5F53\u524D\u8F93\u5165\u7684\u5DF2\u786E\u8BA4\u51B3\u5B9A\u3002"),
          h("ul", { style: { paddingLeft: "20px", lineHeight: 1.7 } }, answers.map((answer, index) => h(
            "li",
            { key: answer.answerId ?? index, style: { overflowWrap: "anywhere", marginBottom: "8px" } },
            h("div", null, answer.questionText || "\u95EE\u9898\u539F\u6587\u672A\u8BB0\u5F55"),
            h("div", null, `\u56DE\u7B54\uFF1A${answer.optionLabel ?? answer.optionId ?? answer.text ?? "\u672A\u8BB0\u5F55"}${answer.text && (answer.optionLabel || answer.optionId) && answer.text !== answer.optionLabel ? `\uFF1B\u8865\u5145\uFF1A${answer.text}` : ""}`),
            h("div", null, `\u8F93\u5165\u7248\u672C\uFF1A${Number.isInteger(answer.inputRevision) ? answer.inputRevision : "\u672A\u77E5"}${answer.superseded ? "\uFF1B\u5DF2\u88AB\u540E\u7EED\u56DE\u7B54\u66FF\u4EE3" : ""}${answer.at ? `\uFF1B${intentTime(answer.at)}` : ""}`)
          ))),
          page?.error ? h("p", { role: "alert" }, `\u8BFB\u53D6\u8F83\u65E9\u56DE\u7B54\u5931\u8D25\uFF1A${page.error}`) : null,
          next != null ? h("button", { type: "button", style: button, disabled: page?.loading, onClick: loadMore }, page?.loading ? "\u8BFB\u53D6\u4E2D\u2026" : "\u52A0\u8F7D\u8F83\u65E9\u56DE\u7B54") : null,
          next == null && !page && session.historicalAnswersOmitted > 0 ? h("p", null, `\u53E6\u6709 ${session.historicalAnswersOmitted} \u6761\u8F83\u65E9\u8BB0\u5F55\u672A\u663E\u793A\uFF0C\u8BF7\u91CD\u65B0\u52A0\u8F7D\u4F1A\u8BDD\u3002`) : null
        );
      };
      const renderClarificationStatus = () => {
        const pending = (session?.items ?? []).filter((item) => !item.excluded && (item.unknowns ?? []).some((unknown) => (unknown.resolution ?? "pending") === "pending")).length;
        const total = investigations.length;
        const gateQuestion = session?.nextQuestion ? 1 : 0;
        const allCovered = gateQuestion === 0 && pending === 0 && session?.state === "ready_for_confirmation";
        return h(
          "div",
          {
            style: {
              display: "flex",
              gap: "8px",
              flexWrap: "wrap",
              alignItems: "center",
              marginTop: "10px",
              padding: "8px 10px",
              border: `1px solid ${T.line}`,
              borderRadius: "10px",
              background: T.layer
            }
          },
          h("span", { style: { fontSize: "12.5px", color: T.text2 } }, `\u5F85\u6F84\u6E05\u95EE\u9898 ${pending + gateQuestion} \xB7 \u5DF2\u6709\u8C03\u67E5\u8BC1\u636E ${total}`),
          allCovered ? tonePill("neutral", "\u6F84\u6E05\u53EF\u4EE5\u6536\u53E3\uFF1A\u6240\u6709\u963B\u585E\u95EE\u9898\u90FD\u6709\u8BC1\u636E\u6216\u660E\u786E\u7559\u7ED9\u4F60\u51B3\u5B9A") : total > 0 ? tonePill("warn", "\u8FD8\u6709\u5F85\u6F84\u6E05\u9879\uFF1B\u8BC1\u636E\u53EA\u662F\u65C1\u8BC1") : tonePill("neutral", "\u5C1A\u672A\u4F7F\u7528\u8C03\u67E5\u8BC1\u636E")
        );
      };
      const renderInvestigationPanel = () => {
        if (!investigation.open) return null;
        const data = investigation.data;
        const verdict = data?.verdict ?? null;
        const findings = Array.isArray(data?.findings) ? data.findings : [];
        const unknowns = Array.isArray(data?.unknowns) ? data.unknowns : [];
        return h(
          "div",
          { style: { ...card, cursor: "default", marginTop: "12px", borderColor: T.line2 } },
          h(
            "div",
            { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
            tonePill("neutral", "\u53EA\u8BFB\u8C03\u67E5"),
            h("span", { style: { fontSize: "12px", color: T.text2, flex: "1 1 220px", minWidth: 0, wordBreak: "break-word" } }, investigation.question?.text ?? ""),
            investigation.busy ? h("span", { style: { fontSize: "12px", color: T.warn } }, `\u5DF2\u7528 ${investigation.elapsed}s`) : null
          ),
          investigation.busy ? h(
            "div",
            null,
            h(
              "div",
              { style: { display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "8px" } },
              INTENT_INVESTIGATION_STAGES.map(
                (stage) => h(
                  "span",
                  { key: stage, style: { fontSize: "11.5px", color: T.text3, padding: "2px 8px", border: `1px solid ${T.line}`, borderRadius: "999px" } },
                  stage
                )
              )
            ),
            h("p", { style: { margin: "8px 0 0", ...muted, lineHeight: 1.7 } }, "\u8FD9\u6B21\u8C03\u67E5\u4F1A\u4F9D\u6B21\u8BFB\u53D6\u5F53\u524D\u9879\u76EE\u6587\u4EF6\u3001\u751F\u6210\u8BC1\u636E\u5E76\u6838\u5BF9\u5F15\u7528\uFF1B\u5B8C\u6210\u524D\u6CA1\u6709\u4F2A\u9020\u7684\u8FDB\u5EA6\u767E\u5206\u6BD4\u3002\u8FD9\u4E00\u6B65\u53EA\u8BFB\uFF0C\u4E0D\u4F1A\u6539\u4EFB\u4F55\u6587\u4EF6\u3002"),
            h(
              "div",
              { style: { display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" } },
              h("button", { type: "button", style: button, onClick: () => cancelInvestigation() }, "\u53D6\u6D88\u8C03\u67E5")
            )
          ) : investigation.error ? h(
            "div",
            { style: { marginTop: "8px" } },
            h(
              "div",
              { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
              tonePill("error", `\u8C03\u67E5\u5931\u8D25\uFF1A${investigation.error.code ?? "error"}`),
              h(
                "span",
                { style: { fontSize: "12px", color: T.text2, flex: "1 1 220px", minWidth: 0, wordBreak: "break-word", lineHeight: 1.7 } },
                investigation.error.message
              ),
              h("button", { type: "button", style: button, onClick: () => startInvestigation(investigation.question?.text ?? "") }, "\u91CD\u8BD5"),
              h("button", { type: "button", style: button, onClick: () => setInvestigation((state) => ({ ...state, open: false })) }, "\u5173\u95ED")
            ),
            investigation.error.hint ? h("p", { style: { margin: "6px 0 0", ...muted, lineHeight: 1.7 } }, investigation.error.hint) : null
          ) : data ? h(
            "div",
            { style: { marginTop: "8px" } },
            h(
              "div",
              { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
              tonePill(
                verdict === "partially-answered" ? "warn" : "neutral",
                `\u8C03\u67E5\u7ED3\u8BBA\uFF1A${INTENT_VERDICT_LABELS[verdict] ?? (verdict || "\u672A\u786E\u5B9A")}`
              ),
              data?.investigationId ? h("span", { style: { fontSize: "11px", color: T.text3 } }, `INV ${data.investigationId}`) : null,
              investigation.elapsed > 0 ? h("span", { style: { fontSize: "11px", color: T.text3 } }, `\u7528\u65F6\u7EA6 ${investigation.elapsed}s`) : null
            ),
            h("p", { style: { margin: "6px 0 0", fontSize: "12.5px", color: T.text2, lineHeight: 1.7 } }, "\u8C03\u67E5\u7ED3\u679C\u9700\u8981\u6838\u5BF9\uFF1B\u5F15\u7528\u5728\u8C03\u67E5\u65F6\u6821\u9A8C\uFF0C\u4E0D\u662F\u5DF2\u786E\u8BA4\u51B3\u5B9A\u3002"),
            data.summary ? h("p", { style: { margin: "6px 0 0", fontSize: "12.5px", color: T.text, lineHeight: 1.8 } }, data.summary) : null,
            verdict === "not-determined" ? h("p", { style: { margin: "6px 0 0", color: T.warn, fontSize: "12px", lineHeight: 1.7 } }, "\u6A21\u578B\u6CA1\u6709\u4ECE\u4EE3\u7801\u91CC\u5F97\u5230\u786E\u5B9A\u7B54\u6848\u3002\u53EF\u4EE5\u6362\u4E2A\u95EE\u9898\u3001\u7F29\u5C0F\u8303\u56F4\uFF0C\u6216\u628A\u7ED3\u8BBA\u7559\u7ED9\u4F60\u51B3\u5B9A\u3002") : null,
            findings.length === 0 ? null : h(
              "div",
              { style: { display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" } },
              findings.map(
                (finding, index) => h(
                  "div",
                  { key: typeof finding?.claim === "string" ? `${index}-${finding.claim.slice(0, 24)}` : index, style: { border: `1px solid ${T.line}`, borderRadius: "8px", padding: "8px 10px", background: T.base } },
                  h("div", { style: { fontSize: "12.5px", color: T.text, lineHeight: 1.7, wordBreak: "break-word" } }, finding?.claim ?? "\uFF08\u65E0\u63CF\u8FF0\uFF09"),
                  (finding?.refs ?? []).map(
                    (ref) => h(
                      "div",
                      { key: `${ref.path}-${ref.line}-${ref.endLine ?? ""}`, style: { marginTop: "4px" } },
                      h(
                        "div",
                        { style: { display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" } },
                        h("span", { style: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "11.5px", color: T.text2, wordBreak: "break-all" } }, intentRefLabel(ref)),
                        tonePill(ref?.verified === true ? "success" : "warn", ref?.verified === true ? "\u8C03\u67E5\u65F6\u5DF2\u6838\u5BF9" : "\u5F15\u7528\u672A\u6838\u5BF9")
                      ),
                      ref?.quote ? h(
                        "pre",
                        { style: { margin: "4px 0 0", padding: "6px 8px", background: T.layer2, borderRadius: "6px", fontSize: "11px", lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word", color: T.text2, maxHeight: "7.5em", overflow: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" } },
                        String(ref.quote).split("\n").slice(0, 6).join("\n")
                      ) : null
                    )
                  )
                )
              )
            ),
            unknowns.length > 0 ? h(
              "div",
              { style: { marginTop: "8px" } },
              h("div", { style: fieldLabelStyle }, "\u4ECD\u9700\u786E\u8BA4"),
              unknowns.map(
                (unknown, index) => h(
                  "p",
                  { key: index, style: { margin: "2px 0 0", fontSize: "12px", color: T.text2, lineHeight: 1.7 } },
                  typeof unknown === "string" ? unknown : `${unknown?.description ?? unknown?.text ?? "\u672A\u77E5\u9879"}${unknown?.blocking === true ? "\uFF08\u9700\u8981\u4F60\u51B3\u5B9A\uFF09" : unknown?.resolution === "investigate" ? "\uFF08\u9700\u8FDB\u4E00\u6B65\u8C03\u67E5\uFF09" : ""}`
                )
              )
            ) : null,
            (data?.warnings ?? []).length > 0 ? h("p", { style: { margin: "6px 0 0", ...muted, lineHeight: 1.7 } }, `\u63D0\u9192\uFF1A${data.warnings.join("\uFF1B")}`) : null,
            h(
              "div",
              { style: { display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "10px" } },
              h("button", { type: "button", style: primary, disabled: busy, onClick: () => reanalyzeWithEvidence(data) }, "\u7528\u6B64\u8C03\u67E5\u91CD\u65B0\u5224\u65AD"),
              h("button", { type: "button", style: button, onClick: () => startInvestigation(investigation.question?.text ?? "") }, "\u518D\u8C03\u67E5\u4E00\u6B21"),
              h("button", { type: "button", style: button, onClick: () => setInvestigation((state) => ({ ...state, open: false })) }, "\u6536\u8D77")
            ),
            h("p", { style: { margin: "6px 0 0", ...muted, lineHeight: 1.6 } }, "\u91CD\u65B0\u5224\u65AD\u4F1A\u4F7F\u7528\u8FD9\u6761\u8C03\u67E5\uFF1B\u8C03\u67E5\u4E0D\u662F\u5DF2\u786E\u8BA4\u51B3\u5B9A\u3002")
          ) : null
        );
      };
      const renderInvestigations = () => {
        if (investigations.length === 0) return null;
        return h(
          "div",
          { style: { ...card, cursor: "default", marginTop: "12px" } },
          h("div", { style: fieldLabelStyle }, `\u8C03\u67E5\u8BB0\u5F55\uFF08${investigations.length}\uFF09`),
          h(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: "6px", marginTop: "6px" } },
            investigations.map((entry, index) => {
              const id = intentInvestigationId(entry);
              const outerId = investigation.expandedId;
              const expanded = outerId === id;
              const verdict = entry?.verdict ?? null;
              const findings = Array.isArray(entry?.findings) ? entry.findings : [];
              return h(
                "div",
                { key: id ?? `${index}`, style: { border: `1px solid ${T.line}`, borderRadius: "8px", padding: "8px 10px", background: T.layer } },
                h(
                  "button",
                  {
                    type: "button",
                    onClick: () => setInvestigation((state) => ({ ...state, expandedId: expanded ? null : id })),
                    style: {
                      textAlign: "left",
                      border: `1px solid ${T.line}`,
                      borderRadius: "8px",
                      background: T.base,
                      padding: "6px 8px",
                      display: "flex",
                      gap: "8px",
                      flexWrap: "wrap",
                      alignItems: "baseline",
                      width: "100%",
                      cursor: "pointer",
                      color: T.text
                    }
                  },
                  h("span", { style: { fontSize: "12px", color: T.text2, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" } }, id ?? "INV-?"),
                  h("span", { style: { fontSize: "12px", color: T.text, flex: "1 1 220px", minWidth: 0, wordBreak: "break-word" } }, entry?.question ?? ""),
                  tonePill(verdict === "partially-answered" ? "warn" : "neutral", INTENT_VERDICT_LABELS[verdict] ?? "\u672A\u786E\u5B9A"),
                  entry?.inputRevision !== session?.input?.inputRevision ? tonePill("warn", Number.isSafeInteger(entry?.inputRevision) ? `\u5386\u53F2\u8F93\u5165\u7248\u672C ${entry.inputRevision}` : "\u8F93\u5165\u7248\u672C\u672A\u77E5") : null,
                  h("span", { style: { fontSize: "11px", color: T.text3 } }, intentInvestigationTime(entry))
                ),
                expanded ? h(
                  "div",
                  { style: { marginTop: "6px" } },
                  findings.length === 0 ? h("p", { style: { margin: 0, ...muted } }, "\u8FD9\u6B21\u8C03\u67E5\u6CA1\u6709\u53EF\u6821\u9A8C\u7684\u53D1\u73B0\u3002") : findings.map(
                    (finding, findingIndex) => h(
                      "p",
                      { key: findingIndex, style: { margin: "3px 0 0", fontSize: "12px", color: T.text2, lineHeight: 1.7 } },
                      typeof finding === "string" ? finding : `${finding?.claim ?? ""}${(finding?.refs ?? []).length ? ` \u2014 ${(finding.refs ?? []).map(intentRefLabel).join("\uFF1B")}` : ""}`
                    )
                  ),
                  Number.isSafeInteger(entry?.inputRevision) && entry.inputRevision === session?.input?.inputRevision && entry?.sessionId === session?.sessionId ? h("button", { type: "button", style: button, disabled: busy, onClick: () => reanalyzeWithEvidence(entry) }, "\u7528\u6B64\u8C03\u67E5\u91CD\u65B0\u5224\u65AD") : null
                ) : null
              );
            })
          )
        );
      };
      const renderRelated = (item) => {
        const related = item.related ?? [];
        const contextFailed = session?.context?.queryStatus === "error";
        return h(
          "div",
          { style: { marginTop: "10px" } },
          h(
            "div",
            { style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } },
            h("span", { style: fieldLabelStyle }, "\u76F8\u5173\u627F\u8BFA"),
            contextFailed ? tonePill("warn", "\u76F8\u5173\u9700\u6C42\u5C1A\u672A\u6838\u5BF9") : tonePill("neutral", `${related.length} \u6761\u5019\u9009`)
          ),
          contextFailed ? h("p", { style: { margin: "4px 0 0", color: T.warn, fontSize: "12px", lineHeight: 1.7 } }, "\u68C0\u7D22\u5931\u8D25\uFF1A\u76F8\u5173\u9700\u6C42\u5C1A\u672A\u6838\u5BF9\uFF0C\u4E0D\u80FD\u636E\u6B64\u8BA4\u4E3A\u201C\u5168\u65B0\u201D\u6216\u201C\u6CA1\u6709\u91CD\u590D\u201D\u3002") : null,
          related.length === 0 ? h("p", { style: { margin: "4px 0 0", ...muted } }, "\u6CA1\u6709\u5339\u914D\u5230\u76F8\u5173\u627F\u8BFA\uFF1B\u8FD9\u4E0D\u7B49\u4E8E\u6CA1\u6709\u5F71\u54CD\u3002") : h(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: "6px", marginTop: "6px" } },
            related.map(
              (entry, index) => h(
                "button",
                {
                  key: `${entry.uid}-${index}`,
                  type: "button",
                  disabled: !onOpenRequirement,
                  onClick: () => onOpenRequirement && onOpenRequirement(entry.uid),
                  style: {
                    textAlign: "left",
                    border: `1px solid ${T.line}`,
                    borderRadius: "10px",
                    background: T.layer,
                    padding: "8px 10px",
                    cursor: onOpenRequirement ? "pointer" : "default",
                    color: T.text
                  }
                },
                h(
                  "span",
                  { style: { display: "flex", gap: "8px", alignItems: "baseline", flexWrap: "wrap" } },
                  h("span", { style: { fontSize: "12.5px", fontWeight: 500, wordBreak: "break-word" } }, entry.uid),
                  entry.revision === void 0 || entry.revision === null ? null : h("span", { style: { fontSize: "11px", color: T.text3 } }, `rev ${entry.revision}`),
                  h("span", { style: { fontSize: "11px", color: T.warn } }, INTENT_MATCH_LABELS[entry.match] ?? entry.match ?? "\u76F8\u5173")
                ),
                relatedTitleOf(entry) ? h("span", { style: { display: "block", marginTop: "2px", fontSize: "12px", color: T.text2, wordBreak: "break-word" } }, relatedTitleOf(entry)) : null,
                h("span", { style: { display: "block", marginTop: "2px", fontSize: "11.5px", color: T.text3, lineHeight: 1.6 } }, entry.reason ?? "")
              )
            )
          )
        );
      };
      const renderRoutes = (item) => {
        const chosen = routeOf(item);
        const edited = routeChoices[item.itemId] !== void 0;
        return h(
          "details",
          { style: { marginTop: "8px" } },
          h(
            "summary",
            { style: { cursor: "pointer", fontSize: "13px", color: T.text, lineHeight: 1.7 } },
            edited ? `\u5DF2\u9009\u53BB\u5411\uFF1A${INTENT_ROUTE_LABELS[chosen] ?? chosen} \xB7 \u4FEE\u6539` : session?.manual ? `\u5F53\u524D\u53BB\u5411\uFF1A${INTENT_ROUTE_LABELS[chosen] ?? chosen} \xB7 \u67E5\u770B\u6216\u4FEE\u6539` : `AI \u5EFA\u8BAE\u53BB\u5411\uFF1A${INTENT_ROUTE_LABELS[chosen] ?? chosen} \xB7 \u67E5\u770B\u6216\u4FEE\u6539`
          ),
          h(
            "div",
            { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "8px", marginTop: "6px" } },
            INTENT_ROUTE_LIST.map(
              ([id, label, hint]) => h(
                "button",
                {
                  key: id,
                  type: "button",
                  "aria-pressed": chosen === id,
                  disabled: busy,
                  onClick: () => chooseRoute(item, id),
                  style: {
                    textAlign: "left",
                    cursor: "pointer",
                    border: `1px solid ${chosen === id ? T.brand : T.line}`,
                    borderLeftWidth: chosen === id ? "3px" : "1px",
                    borderRadius: "10px",
                    padding: "8px 10px",
                    background: chosen === id ? T.layer2 : T.layer,
                    color: chosen === id ? T.text : T.text2
                  }
                },
                h("span", { style: { display: "block", fontSize: "12.5px", fontWeight: 500 } }, label),
                h("span", { style: { display: "block", marginTop: "2px", fontSize: "11px", color: T.text3, lineHeight: 1.6 } }, hint)
              )
            )
          ),
          item.routeRationale ? h("p", { style: { margin: "6px 0 0", ...muted, lineHeight: 1.7 } }, `\u4E3A\u4EC0\u4E48\u8FD9\u4E48\u5EFA\u8BAE\uFF1A${item.routeRationale}`) : null
        );
      };
      const renderCandidate = (item, itemIndex, total) => {
        const candidate = candidateOf(item);
        const prefix = total > 1 ? `\u610F\u56FE ${itemIndex + 1} ` : "";
        return h(
          "div",
          { style: { marginTop: "10px" } },
          h(
            "div",
            { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" } },
            h("span", { style: fieldLabelStyle }, routeOf(item) === "change" ? "\u53D8\u66F4\u540E\u7684\u5185\u5BB9\uFF08\u8349\u6848\uFF09" : "\u9700\u6C42\u5019\u9009\uFF08\u8349\u6848\uFF09"),
            h("span", { style: { fontSize: "11px", color: T.text3 } }, "AI \u53EA\u7ED9\u5019\u9009\uFF1B\u4F60\u6539\u8FC7\u7684\u5B57\u6BB5\u4E0D\u4F1A\u88AB\u81EA\u52A8\u8986\u76D6")
          ),
          fieldBlock(
            "\u6807\u9898",
            sourceTag(fieldWasEdited(item, "title")),
            h("input", {
              "aria-label": `${prefix}\u6807\u9898`,
              name: `${item.itemId}-title`,
              autoComplete: "off",
              value: candidate.title,
              onChange: (event) => setManualField(item.itemId, "title", event.target.value),
              placeholder: "\u4E00\u53E5\u8BDD\u8BF4\u6E05\u8981\u6539\u53D8\u4EC0\u4E48",
              style: { ...input, width: "100%", minWidth: 0 }
            })
          ),
          fieldBlock(
            "\u95EE\u9898",
            sourceTag(fieldWasEdited(item, "problem")),
            h("textarea", {
              "aria-label": `${prefix}\u95EE\u9898`,
              name: `${item.itemId}-problem`,
              autoComplete: "off",
              value: candidate.problem,
              onChange: (event) => setManualField(item.itemId, "problem", event.target.value),
              placeholder: "\u73B0\u5728\u54EA\u91CC\u4E0D\u5BF9\u3001\u8C01\u53D7\u5F71\u54CD",
              style: { ...input, width: "100%", minWidth: 0, minHeight: "64px", resize: "vertical", fontFamily: "inherit", lineHeight: 1.7 }
            })
          ),
          fieldBlock(
            "\u76EE\u6807",
            sourceTag(fieldWasEdited(item, "goal")),
            h("textarea", {
              "aria-label": `${prefix}\u76EE\u6807`,
              name: `${item.itemId}-goal`,
              autoComplete: "off",
              value: candidate.goal,
              onChange: (event) => setManualField(item.itemId, "goal", event.target.value),
              placeholder: "\u6539\u6210\u4EC0\u4E48\u6837\u5C31\u7B97\u5BF9\u4E86",
              style: { ...input, width: "100%", minWidth: 0, minHeight: "56px", resize: "vertical", fontFamily: "inherit", lineHeight: 1.7 }
            })
          ),
          linesField("\u8303\u56F4\u5185", candidate.inScope, (values) => setManualField(item.itemId, "inScope", values), prefix),
          linesField("\u8303\u56F4\u5916", candidate.outOfScope, (values) => setManualField(item.itemId, "outOfScope", values), prefix),
          renderAcceptance(item, candidate.acceptance, prefix)
        );
      };
      const renderUnknowns = (item) => {
        const unknowns = item.unknowns ?? [];
        if (unknowns.length === 0) return null;
        return h(
          "div",
          { style: { marginTop: "10px" } },
          h("div", { style: fieldLabelStyle }, `\u672A\u77E5\u9879\uFF08${unknowns.length}\uFF09`),
          unknowns.map((unknown, index) => {
            const key = `${item.itemId}:${index}`;
            const unknownLabelId = `intent-unknown-${encodeURIComponent(item.itemId)}-${index}`;
            const resolution = unknownChoices[key] ?? unknown.resolution ?? "pending";
            const adoption = (session?.readiness?.investigationAdoptions ?? []).find((entry) => entry.itemId === item.itemId && entry.unknownDescription === unknown.description && entry.inputRevision === session?.input?.inputRevision);
            const availableInvestigations = investigations.filter((entry) => entry?.sessionId === session?.sessionId && entry?.inputRevision === session?.input?.inputRevision && entry?.verdict === "answered" && entry?.source === "observed_evidence");
            return h(
              "div",
              { key, style: { border: `1px solid ${T.line}`, borderRadius: "9px", padding: "8px 10px", marginTop: "6px", background: T.layer } },
              h(
                "div",
                { id: unknownLabelId, style: { fontSize: "12px", color: T.text2, lineHeight: 1.7, overflowWrap: "anywhere" } },
                unknown.blocking ? h("span", { style: { color: T.warn, fontWeight: 500 } }, "[\u963B\u585E] ") : null,
                unknown.description,
                h("span", { style: { color: T.text3, marginLeft: "6px" } }, `\u5F53\u524D\uFF1A${INTENT_UNKNOWN_LABELS[resolution] ?? resolution}`)
              ),
              h(
                "div",
                { role: "group", "aria-labelledby": unknownLabelId, style: { display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "4px" } },
                [
                  ["clarify", "\u6F84\u6E05"],
                  ["investigate", "\u8F6C\u8C03\u67E5"],
                  ["exclude", "\u6392\u9664"]
                ].map(
                  ([id, label]) => h(
                    "button",
                    {
                      key: id,
                      type: "button",
                      "aria-pressed": resolution === id,
                      style: {
                        ...button,
                        padding: "2px 8px",
                        fontSize: "11px",
                        borderColor: resolution === id ? T.brand : T.line,
                        background: resolution === id ? T.layer2 : T.layer
                      },
                      onClick: () => chooseUnknown(item, index, id)
                    },
                    label
                  )
                )
              ),
              adoption && resolution === "investigate" ? h("p", { role: "status", style: { margin: "4px 0", color: adoption.referencesCurrent ? T.text2 : T.warn, fontSize: "12px", overflowWrap: "anywhere" } }, adoption.referencesCurrent ? `\u5DF2\u91C7\u7EB3\u8C03\u67E5 ${adoption.investigationId}\uFF1B\u5F15\u7528\u672C\u6B21\u8BFB\u53D6\u65F6\u6709\u6548\u3002` : `\u5DF2\u91C7\u7EB3\u8C03\u67E5 ${adoption.investigationId} \u7684\u5F15\u7528\u5DF2\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u8C03\u67E5\u6216\u91C7\u7EB3\u5176\u4ED6\u8BC1\u636E\u3002`) : null,
              unknown.blocking ? h(
                "details",
                { style: { marginTop: "6px" } },
                h("summary", { style: { cursor: "pointer", color: T.text2, fontSize: "12px" } }, "\u91C7\u7EB3\u8C03\u67E5\u8BC1\u636E"),
                availableInvestigations.length === 0 ? h("p", { style: { margin: "6px 0", ...muted } }, "\u5F53\u524D\u8F93\u5165\u5C1A\u65E0\u53EF\u91C7\u7EB3\u7684\u8C03\u67E5\u3002") : null,
                availableInvestigations.map((entry, investigationIndex) => h(
                  "div",
                  { key: intentInvestigationId(entry), style: { marginTop: "6px", color: T.text2, fontSize: "12px" } },
                  h("div", { id: `${unknownLabelId}-investigation-${investigationIndex}`, style: { overflowWrap: "anywhere" } }, entry.question),
                  entry.summary ? h("p", { style: { margin: "4px 0" } }, entry.summary) : null,
                  (entry.findings ?? []).map((finding, findingIndex) => h(
                    "div",
                    { key: findingIndex, style: { margin: "4px 0", overflowWrap: "anywhere" } },
                    h("div", null, finding.claim ?? ""),
                    (finding.refs ?? []).map((ref, refIndex) => h(
                      "div",
                      { key: refIndex, style: { marginTop: "4px" } },
                      h("span", null, intentRefLabel(ref)),
                      ref?.quote ? h("blockquote", { style: { margin: "2px 0 4px 8px", paddingLeft: "8px", borderLeft: `2px solid ${T.line2}`, whiteSpace: "pre-wrap" } }, ref.quote) : null
                    ))
                  )),
                  h("button", { type: "button", style: button, disabled: busy || editBusy, "aria-describedby": `${unknownLabelId} ${unknownLabelId}-investigation-${investigationIndex}`, onClick: () => adoptInvestigation(item, unknown, entry) }, "\u91C7\u7EB3\u7528\u4E8E\u6B64\u672A\u77E5\u9879")
                ))
              ) : null
            );
          })
        );
      };
      const renderDetails = (item) => {
        const runs = session?.runs ?? [];
        const lastRun = runs[runs.length - 1] ?? null;
        const references = item.sourceRefs ?? [];
        return h(
          "details",
          { style: { marginTop: "10px", borderTop: `1px solid ${T.line}`, paddingTop: "8px" } },
          h("summary", { style: { cursor: "pointer", fontSize: "12px", color: T.text2 } }, "\u4F9D\u636E\u3001\u53CD\u4F8B\u4E0E\u6A21\u578B\u4FE1\u606F\uFF08\u5C55\u5F00\uFF09"),
          (item.assumptions ?? []).length ? h(
            "div",
            { style: { marginTop: "8px" } },
            h("div", { style: fieldLabelStyle }, `\u5047\u8BBE\uFF08${item.assumptions.length} \u6761\uFF0C\u672A\u8BC1\u5B9E\uFF09`),
            h(
              "ul",
              { style: { margin: "4px 0 0", paddingLeft: "18px", fontSize: "12px", color: T.text2, lineHeight: 1.8 } },
              item.assumptions.map((line, index) => h("li", { key: index }, line))
            )
          ) : null,
          item.counterexample ? h(
            "div",
            { style: { marginTop: "8px" } },
            h("div", { style: fieldLabelStyle }, "\u53CD\u4F8B\uFF08\u5F85\u8BC1\u573A\u666F\uFF0C\u4E0D\u662F\u5DF2\u53D1\u751F\u7F3A\u9677\uFF09"),
            h("p", { style: { margin: "4px 0 0", fontSize: "12px", color: T.text2, lineHeight: 1.8 } }, item.counterexample.scenario ?? "\u2014")
          ) : null,
          h(
            "div",
            { style: { marginTop: "8px" } },
            h("div", { style: fieldLabelStyle }, "\u6765\u6E90\u5F15\u7528"),
            references.length === 0 ? h("p", { style: { margin: "4px 0 0", ...muted } }, "\u6CA1\u6709\u53EF\u663E\u793A\u7684\u6765\u6E90\u5F15\u7528\u3002") : references.map((reference, index) => {
              const resolved = reference?.resolved !== false && reference?.ref !== void 0;
              return h(
                "div",
                { key: index, style: { fontSize: "11.5px", color: resolved ? T.text2 : T.warn, lineHeight: 1.7, wordBreak: "break-word" } },
                resolved ? `${reference.ref}${reference.line ? `:${reference.line}` : ""}${reference.endLine ? `-${reference.endLine}` : ""} \xB7 ${reference.quote ?? ""}` : `${reference.ref ?? "\u672A\u77E5\u6765\u6E90"} \xB7 \u6765\u6E90\u65E0\u6CD5\u89E3\u6790`
              );
            })
          ),
          h(
            "div",
            { style: { marginTop: "8px" } },
            h("div", { style: fieldLabelStyle }, "\u6A21\u578B\u4FE1\u606F"),
            h(
              "p",
              { style: { margin: "4px 0 0", ...muted, lineHeight: 1.8 } },
              lastRun ? `${lastRun.provider ?? "\u2014"} / ${lastRun.model ?? "\u2014"} \xB7 ${INTENT_STATE_LABELS[lastRun.status] ?? lastRun.status ?? "\u2014"} \xB7 ${intentTime(lastRun.finishedAt ?? lastRun.startedAt)}` : "\u8FD9\u6B21\u6CA1\u6709\u6A21\u578B\u8FD0\u884C\u8BB0\u5F55\uFF08\u624B\u52A8\u586B\u5199\u6216\u6A21\u578B\u4E0D\u53EF\u7528\uFF09\u3002"
            )
          )
        );
      };
      const VALUE_CHECK_STATUS_LABELS = { pending: "\u5F85\u786E\u8BA4", unknown: "\u5F85\u786E\u8BA4", unverified: "\u672A\u9A8C\u8BC1", verified: "\u5DF2\u9A8C\u8BC1", failed: "\u672A\u901A\u8FC7", blocked: "\u5DF2\u963B\u585E" };
      const valueCheckText = (value) => {
        if (typeof value === "string") return value;
        if (value !== null && typeof value === "object") {
          try {
            return JSON.stringify(value);
          } catch (caught) {
            return String(value);
          }
        }
        return String(value);
      };
      const valueCheckOf = (value) => {
        if (value === null || value === void 0) return null;
        if (typeof value === "string") {
          const text = value.trim();
          return text ? { kind: "text", text } : null;
        }
        if (typeof value === "object" && !Array.isArray(value)) {
          const rows = [
            ["\u65AD\u8A00", value.claim],
            ["\u6700\u5C0F\u9A8C\u8BC1", value.smallestCheck],
            ["\u505C\u6B62\u6216\u64A4\u56DE\u6761\u4EF6", value.stopCondition]
          ].filter(([, current]) => current !== null && current !== void 0 && String(current).trim() !== "").map(([label, current]) => [label, valueCheckText(current)]);
          const statusRaw = value.status === null || value.status === void 0 ? "" : valueCheckText(value.status).trim();
          if (rows.length === 0 && statusRaw === "") return null;
          return {
            kind: "object",
            rows,
            status: statusRaw === "" ? null : { raw: statusRaw, label: VALUE_CHECK_STATUS_LABELS[statusRaw] ?? statusRaw }
          };
        }
        return { kind: "text", text: String(value) };
      };
      const valueCheckTone = (status) => {
        if (!status) return "neutral";
        if (status.raw === "verified") return "success";
        if (status.raw === "unverified" || status.raw === "failed" || status.raw === "blocked") return status.raw === "unverified" ? "warn" : "error";
        return "neutral";
      };
      const renderValueCheck = (item) => {
        const valueCheck = valueCheckOf(item?.valueCheck);
        if (!valueCheck) return null;
        if (valueCheck.kind === "text") return tonePill("neutral", `\u4EF7\u503C\u68C0\u67E5\uFF1A${valueCheck.text}`);
        return h(
          "div",
          { style: { marginTop: "8px", border: `1px solid ${T.line}`, borderLeft: `3px solid ${T.line2}`, borderRadius: "10px", padding: "8px 12px", background: T.layer } },
          h(
            "div",
            { style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } },
            h("span", { style: fieldLabelStyle }, "\u4EF7\u503C\u68C0\u67E5"),
            valueCheck.status ? tonePill(valueCheckTone(valueCheck.status), `\u72B6\u6001\uFF1A${valueCheck.status.label}`) : null
          ),
          valueCheck.rows.map(
            ([label, text]) => h(
              "div",
              { key: label, style: { marginTop: "4px", fontSize: "12px", color: T.text2, lineHeight: 1.8, wordBreak: "break-word" } },
              h("span", { style: { color: T.text3 } }, `${label}\uFF1A`),
              text
            )
          )
        );
      };
      const renderItemSection = (item, index, total) => h(
        "section",
        {
          key: item.itemId ?? index,
          style: { borderTop: index === 0 ? "none" : `1px solid ${T.line}`, paddingTop: index === 0 ? 0 : "12px", marginTop: "12px" }
        },
        h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } },
          h(
            "span",
            { style: { fontSize: "11px", color: T.text3, letterSpacing: ".06em", textTransform: "uppercase" } },
            total > 1 ? `\u610F\u56FE ${index + 1} / ${total}` : "\u8FD9\u6B21\u610F\u56FE"
          )
        ),
        h("p", { style: { margin: "6px 0 0", fontSize: "13px", color: T.text, lineHeight: 1.8 } }, item.userProblem || item.desiredOutcome || "\uFF08\u6CA1\u6709\u53EF\u663E\u793A\u7684\u7406\u89E3\uFF09"),
        item.desiredOutcome && item.userProblem ? h("p", { style: { margin: "2px 0 0", ...muted, lineHeight: 1.7 } }, `\u671F\u671B\uFF1A${item.desiredOutcome}`) : null,
        renderValueCheck(item),
        renderRoutes(item),
        renderRelated(item),
        h(
          "details",
          { "data-intent-candidate": "true", style: { marginTop: "12px" } },
          h("summary", { style: { color: T.text, fontSize: "13px", cursor: "pointer", lineHeight: 1.7 } }, "\u67E5\u770B\u548C\u7F16\u8F91\u9700\u6C42\u5019\u9009"),
          renderCandidate(item, index, total)
        ),
        renderUnknowns(item),
        renderDetails(item)
      );
      const renderConflicts = () => h(
        "div",
        { style: { border: `1px solid ${T.line2}`, borderLeft: `3px solid ${T.warn}`, borderRadius: "10px", padding: "8px 12px", marginBottom: "10px", background: T.layer } },
        h("div", { style: { color: T.warn, fontSize: "12px", fontWeight: 500 } }, "\u91CD\u65B0\u5206\u6790\u540E AI \u7ED9\u51FA\u4E86\u4E0D\u540C\u7684\u5EFA\u8BAE"),
        h("p", { style: { margin: "2px 0 6px", ...muted, lineHeight: 1.7 } }, "\u4F60\u7684\u624B\u6539\u4E0D\u4F1A\u88AB\u81EA\u52A8\u8986\u76D6\uFF1B\u8BF7\u9010\u9879\u9009\u62E9\u3002"),
        conflicts.map(
          (conflict, index) => h(
            "div",
            {
              key: `${conflict.itemId}-${conflict.field}-${index}`,
              style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", padding: "4px 0", borderTop: index === 0 ? "none" : `1px solid ${T.line}` }
            },
            h(
              "span",
              { style: { fontSize: "12px", color: T.text2, flex: "1 1 220px", minWidth: 0, wordBreak: "break-word" } },
              `${conflictLabel(conflict.field)}\uFF1A\u4F60\u7684\u300C${previewValue(conflict.manualValue)}\u300D \u2194 AI\u300C${previewValue(conflict.aiValue)}\u300D`
            ),
            h("button", { type: "button", style: button, onClick: () => resolveConflict(conflict, false) }, "\u4FDD\u7559\u6211\u7684\u624B\u6539"),
            h("button", { type: "button", style: button, onClick: () => resolveConflict(conflict, true) }, "\u4F7F\u7528\u65B0\u5EFA\u8BAE")
          )
        )
      );
      const conflictLabel = (field) => ({ title: "\u6807\u9898", problem: "\u95EE\u9898", goal: "\u76EE\u6807", inScope: "\u8303\u56F4\u5185", outOfScope: "\u8303\u56F4\u5916", acceptance: "\u9A8C\u6536\u6807\u51C6" })[field] ?? field;
      const previewValue = (value) => {
        if (Array.isArray(value)) {
          return value.slice(0, 2).map((entry) => typeof entry === "string" ? entry : entry?.expected ?? entry?.action ?? "").join(" / ") || "\uFF08\u7A7A\uFF09";
        }
        const text = String(value ?? "");
        return text.length > 60 ? `${text.slice(0, 60)}\u2026` : text || "\uFF08\u7A7A\uFF09";
      };
      const renderError = (info) => h(
        "div",
        { role: "alert", style: { border: `1px solid ${T.line2}`, borderLeft: `3px solid ${T.err}`, borderRadius: "10px", padding: "8px 12px", marginTop: "10px", background: EVIDENCE_TONE.error.bg } },
        h("div", { style: { color: T.err, fontSize: "12.5px", lineHeight: 1.7 } }, info.message ?? "\u51FA\u9519\u4E86"),
        info.code ? h("div", { style: { marginTop: "2px", fontSize: "11px", color: T.text3 } }, `\u9519\u8BEF\u7801\uFF1A${info.code}${info.status ? ` \xB7 HTTP ${info.status}` : ""}`) : null,
        (info.reasons ?? []).length ? h(
          "ul",
          { style: { margin: "6px 0 0", paddingLeft: "18px", fontSize: "11.5px", color: T.text2, lineHeight: 1.8 } },
          info.reasons.map((reason, index) => h("li", { key: index }, `${reason.message ?? reason.code}${reason.itemId ? `\uFF08${reason.itemId}\uFF09` : ""}`))
        ) : null,
        (info.appliedArtifacts ?? []).length ? h(
          "div",
          { style: { marginTop: "6px", fontSize: "11.5px", color: T.text2, lineHeight: 1.7 } },
          `\u5DF2\u5199\u5165\uFF1A${info.appliedArtifacts.map((artifact) => `${artifact.kind ?? "\u4EA7\u7269"} ${artifact.id ?? ""}`).join("\u3001")}`
        ) : null
      );
      const renderIntentDraft = () => h(IntentDraftPanel, {
        draft: draftOf(),
        open: draftOpen,
        onToggle: () => setDraftOpen((value) => !value),
        editingKey: draftEditing,
        editValue: draftEditValue,
        editBusy: draftBusy,
        notice: draftNotice,
        diff: draftDiff,
        onStartEdit: startDraftEdit,
        onChangeEdit: setDraftEditValue,
        onCancelEdit: cancelDraftEdit,
        onSaveEdit: submitDraftEdit
      });
      const confirmDochash = () => {
        const draft = draftOf();
        const hash = draft?.docHash ?? null;
        const short = hash ? shortHash(String(hash).replace(/^sha256:/, "")) : "";
        return h(
          "span",
          {
            key: "dochash",
            "data-confirm-dochash": hash ?? "none",
            title: hash ?? "\u8349\u7A3F\u54C8\u5E0C\u5C1A\u672A\u751F\u6210\uFF1B\u786E\u8BA4\u65F6\u7531\u670D\u52A1\u7AEF\u6821\u9A8C",
            style: {
              fontSize: "11px",
              color: T.text3,
              alignSelf: "center",
              maxWidth: "260px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontFamily: "ui-monospace, Cascadia Code, monospace"
            }
          },
          hash ? `\u5C06\u4FDD\u5B58 ${short}` : "\u5C06\u4FDD\u5B58\uFF08\u54C8\u5E0C\u5F85\u751F\u6210\uFF09"
        );
      };
      const simpleReview = () => activeItems().length === 1 && routeOf(activeItems()[0]) === "create" && !(activeItems()[0].unknowns ?? []).some((entry) => entry.blocking && (!entry.resolution || entry.resolution === "pending" || entry.resolution === "investigate")) && simpleDraft;
      const grillIsValue = /拷问|grill/i.test(`${simpleDraft?.title ?? ""} ${simpleDraft?.goal ?? ""}`);
      const selfHealingIntent = /(?:需求插件|插件)/.test(`${session?.input?.text ?? ""} ${simpleDraft?.title ?? ""}`) && /(?:报错|错误|bug)/i.test(`${session?.input?.text ?? ""}`) && /自动修复/.test(`${session?.input?.text ?? ""}`);
      const grillApplied = session?.grill?.outcome === "applied";
      const grillFallback = session?.grill?.outcome === "fallback";
      const grillAvailable = session?.grill?.status === "loaded";
      const titlePreservationRule = /(?:手动修改|自动提炼|覆盖)/.test(`${simpleDraft?.title ?? ""} ${simpleDraft?.problem ?? ""} ${simpleDraft?.goal ?? ""}`);
      const modelGrillQuestions = [
        ...Array.isArray(session?.questionGroup?.questions) ? session.questionGroup.questions : [],
        ...session?.nextQuestion ? [session.nextQuestion] : []
      ].filter((question, index, all) => question?.text && all.findIndex((other) => other?.questionId === question.questionId) === index).filter((question) => question.status !== "answered").slice(0, 3).map((question) => ({ id: `model-${question.questionId}`, question: question.text, options: (question.options ?? []).map((option) => option.label).filter(Boolean) }));
      const grillQuestions = modelGrillQuestions.length ? modelGrillQuestions : selfHealingIntent ? [
        { id: "repair-boundary", question: "\u81EA\u52A8\u4FEE\u590D\u53EF\u4FEE\u6539\u7684\u8303\u56F4\u662F\u4EC0\u4E48\uFF1F", options: ["\u4EC5\u4FEE\u6539\u9700\u6C42\u63D2\u4EF6\u5DE5\u4F5C\u533A\u5E76\u91CD\u542F\u8BE5\u63D2\u4EF6", "\u5141\u8BB8\u4FEE\u6539\u6240\u6709 DSH \u63D2\u4EF6", "\u6BCF\u6B21\u4FEE\u590D\u524D\u8981\u6C42\u4EBA\u5DE5\u786E\u8BA4"] },
        { id: "repair-failure", question: "\u81EA\u52A8\u4FEE\u590D\u6216\u9A8C\u8BC1\u5931\u8D25\u65F6\u5982\u4F55\u5904\u7406\uFF1F", options: ["\u505C\u6B62\u81EA\u52A8\u4FEE\u590D\uFF0C\u4FDD\u7559\u6545\u969C\u8BC1\u636E\u5E76\u8F6C\u4EBA\u5DE5\u5904\u7406", "\u5728\u76F8\u540C\u7B56\u7565\u4E0B\u989D\u5916\u91CD\u8BD5\u4E00\u6B21", "\u6301\u7EED\u91CD\u8BD5\u76F4\u5230\u6062\u590D"] },
        { id: "restart-proof", question: "\u63D2\u4EF6\u91CD\u542F\u540E\u4EE5\u4EC0\u4E48\u7ED3\u679C\u8BC1\u660E\u6062\u590D\uFF1F", options: ["\u91CD\u653E\u89E6\u53D1\u6545\u969C\u7684\u5B9A\u5411\u7528\u4F8B\u5E76\u8BB0\u5F55\u7ED3\u679C", "\u4EC5\u786E\u8BA4\u63D2\u4EF6\u8FDB\u7A0B\u5DF2\u542F\u52A8", "\u7531\u7528\u6237\u624B\u52A8\u786E\u8BA4\u529F\u80FD\u6062\u590D"] }
      ] : grillIsValue ? [
        { id: "value", question: "\u9700\u6C42\u4EF7\u503C\u62F7\u95EE\u4E3B\u8981\u5E2E\u52A9\u89E3\u51B3\u4EC0\u4E48\u95EE\u9898\uFF1F", options: ["\u8BC6\u522B\u7F3A\u5C11\u4E1A\u52A1\u4EF7\u503C\u7684\u9700\u6C42\uFF0C\u907F\u514D\u76F2\u76EE\u5F00\u53D1", "\u660E\u786E\u9700\u6C42\u7684\u53D7\u76CA\u4EBA\u548C\u4F7F\u7528\u573A\u666F", "\u51CF\u5C11\u9700\u6C42\u4E0D\u6E05\u9020\u6210\u7684\u8FD4\u5DE5"] },
        { id: "boundary", question: "\u9700\u6C42\u4EF7\u503C\u4FE1\u606F\u4E0D\u8DB3\u65F6\u5982\u4F55\u5904\u7406\uFF1F", options: ["\u4EF7\u503C\u4F9D\u636E\u4E0D\u8DB3\u65F6\u7EE7\u7EED\u8FFD\u95EE\uFF0C\u5141\u8BB8\u7528\u6237\u8865\u5145", "\u65E0\u6CD5\u5224\u65AD\u4EF7\u503C\u65F6\u6807\u8BB0\u5F85\u786E\u8BA4\uFF0C\u4E0D\u76F4\u63A5\u4E0B\u7ED3\u8BBA", "\u5141\u8BB8\u7528\u6237\u8DF3\u8FC7\u8FFD\u95EE\u5E76\u4FDD\u7559\u672A\u51B3\u95EE\u9898"] },
        { id: "measure", question: "\u5982\u4F55\u68C0\u9A8C\u9700\u6C42\u4EF7\u503C\u62F7\u95EE\u6709\u6548\uFF1F", options: ["\u5C55\u793A\u4EF7\u503C\u5224\u65AD\u4F9D\u636E\u548C\u5F85\u786E\u8BA4\u95EE\u9898", "\u8BB0\u5F55\u53D7\u76CA\u4EBA\u3001\u89E6\u53D1\u573A\u666F\u548C\u9884\u671F\u6536\u76CA", "\u7528\u6237\u786E\u8BA4\u4EF7\u503C\u4E0E\u8FB9\u754C\u540E\u5F62\u6210\u9A8C\u6536\u6807\u51C6"] }
      ] : titlePreservationRule ? [
        { id: "value", question: "\u4F55\u65F6\u5141\u8BB8\u91CD\u65B0\u89E6\u53D1 AI \u63D0\u70BC\uFF1F", options: ["\u6C38\u4E0D\u81EA\u52A8\u8986\u76D6", "\u63D0\u4F9B\u624B\u52A8\u91CD\u65B0\u63D0\u70BC\u6309\u94AE", "\u4EC5\u6E05\u7A7A\u6807\u9898\u65F6\u91CD\u65B0\u63D0\u70BC"] },
        { id: "boundary", question: "\u5982\u4F55\u4FDD\u62A4\u624B\u52A8\u6807\u9898\uFF1F", options: ["\u4FDD\u7559\u7528\u6237\u8F93\u5165", "\u63D0\u793A\u8986\u76D6\u98CE\u9669", "\u5141\u8BB8\u6062\u590D\u539F\u59CB\u6807\u9898"] },
        { id: "measure", question: "\u5982\u4F55\u9A8C\u8BC1\u4FDD\u62A4\u751F\u6548\uFF1F", options: ["\u7F16\u8F91\u540E\u4FDD\u6301\u4E0D\u53D8", "\u91CD\u65B0\u6253\u5F00\u540E\u4ECD\u4FDD\u7559", "\u8BB0\u5F55\u624B\u52A8\u4FEE\u6539\u6765\u6E90"] }
      ] : [
        { id: "value", question: "\u8FD9\u9879\u6539\u52A8\u4F18\u5148\u89E3\u51B3\u4EC0\u4E48\u95EE\u9898\uFF1F", options: ["\u51CF\u5C11\u91CD\u590D\u64CD\u4F5C", "\u907F\u514D\u4FE1\u606F\u9057\u6F0F", "\u63D0\u9AD8\u5B8C\u6210\u6548\u7387"] },
        { id: "boundary", question: "\u5F02\u5E38\u65F6\u5E94\u5982\u4F55\u5904\u7406\uFF1F", options: ["\u8BF4\u660E\u5931\u8D25\u539F\u56E0", "\u4FDD\u7559\u5DF2\u6709\u5185\u5BB9", "\u5141\u8BB8\u7528\u6237\u91CD\u8BD5"] },
        { id: "measure", question: "\u5982\u4F55\u9A8C\u8BC1\u7ED3\u679C\u6709\u6548\uFF1F", options: ["\u4F7F\u7528\u771F\u5B9E\u573A\u666F\u9A8C\u8BC1", "\u7528\u6237\u53EF\u67E5\u770B\u7ED3\u679C", "\u9A8C\u6536\u540E\u8BB0\u5F55\u7ED3\u8BBA"] }
      ];
      const updateGrill = (id, value) => {
        const previous = grillAnswers[id] ?? "";
        setGrillAnswers((current) => ({ ...current, [id]: value }));
        setSimpleDraft((d) => {
          if (id === "value") {
            let problem = d.problem;
            if (previous && problem.includes(previous)) problem = problem.replace(previous, value).replace(/\n+$/, "");
            else if (value) problem = [problem.trim(), value].filter(Boolean).join("\n");
            return { ...d, problem };
          }
          const key = `grill-${id}`;
          const index = d.acceptance.findIndex((entry) => entry.grillKey === key);
          const acceptance = [...d.acceptance];
          if (index >= 0 && value) acceptance[index] = { ...acceptance[index], text: value, provenance: "human-edit" };
          else if (index >= 0) acceptance.splice(index, 1);
          else if (value) acceptance.push({ text: value, provenance: "human-edit", grillKey: key });
          return { ...d, acceptance };
        });
      };
      const continueGrilling = () => {
        const answers = grillQuestions.map((question) => grillAnswers[question.id] ? { question: question.question, answer: grillAnswers[question.id] } : null).filter(Boolean);
        if (!answers.length) {
          setError({ code: "grill-answer-required", message: "\u8BF7\u81F3\u5C11\u9009\u62E9\u6216\u8865\u5145\u4E00\u4E2A\u56DE\u7B54\u540E\u518D\u7EE7\u7EED\u8FFD\u95EE\u3002" });
          return;
        }
        runAnalyze({ grillAnswers: answers });
      };
      const copyGrillCommand = async () => {
        const text = `/grilling

\u8BF7\u56F4\u7ED5\u4EE5\u4E0B\u9700\u6C42\u7EE7\u7EED\u8FDB\u884C\u591A\u8F6E\u4EF7\u503C\u4E0E\u8FB9\u754C\u62F7\u95EE\uFF1B\u8FBE\u6210\u5171\u8BC6\u540E\u6574\u7406\u6807\u9898\u3001\u76EE\u6807\u3001\u95EE\u9898\u548C\u9A8C\u6536\u6807\u51C6\uFF0C\u5E76\u901A\u8FC7 requirements crystallize \u547D\u4EE4\u5165\u5E93\u3002

${session?.input?.text ?? simpleDraft?.goal ?? ""}`;
        try {
          await navigator.clipboard?.writeText(text);
          setNotice("\u5DF2\u590D\u5236\u5B8C\u6574 /grilling \u6307\u4EE4\u3002\u7C98\u8D34\u5230 DSH \u4E3B\u5BF9\u8BDD\u5373\u53EF\u7EE7\u7EED\u591A\u8F6E\u62F7\u95EE\u3002");
        } catch {
          setNotice("\u65E0\u6CD5\u81EA\u52A8\u590D\u5236\u3002\u8BF7\u5728 DSH \u4E3B\u5BF9\u8BDD\u8F93\u5165 /grilling \u540E\u7C98\u8D34\u5F53\u524D\u9700\u6C42\u539F\u8BDD\u3002");
        }
      };
      const simpleConfirm = async () => {
        if (!priorityChoice || !simpleDraft?.title.trim() || !simpleDraft.goal.trim() || !simpleDraft.acceptance.some((entry) => entry.text.trim()) || confirmState.loading || editBusy || analysisPending()) return;
        const item = activeItems()[0], current = sessionRef.current;
        setConfirmState({ loading: true, error: null, result: null });
        setError(null);
        try {
          const goal = simpleDraft.goal.trim();
          const ac = simpleDraft.acceptance.filter((entry) => entry.text.trim()).map((entry) => ({ text: entry.text.trim(), provenance: "human-edit" }));
          const saved = await writeJson("intent", { action: "set-doc-draft", sessionId: current.sessionId, expectedSessionRevision: current.sessionRevision, expectedDraftRevision: current.draftRevision, docDraft: { goal, problem: simpleDraft.problem.trim(), acceptance: ac, pending: (current.docDraft?.pending ?? []).filter((entry) => !/^\[验收建议·AI 建议\]/.test(entry.text ?? "")) } }, root);
          if (saved.session) applySession(saved.session);
          const acceptance = ac.map((entry) => ({ expected: entry.text, judgement: entry.text }));
          const edited = await sendEdit({ title: simpleDraft.title.trim(), goal, problem: simpleDraft.problem.trim(), acceptance, priority: priorityChoice, route: "create" }, item.itemId, true);
          const latest = edited ?? sessionRef.current;
          if (!latest?.sessionId) throw new Error("\u4F1A\u8BDD\u4FDD\u5B58\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002");
          if (!idemRef.current) idemRef.current = intentIdemKey();
          const payload = await writeJson("intent", { action: "confirm", sessionId: latest.sessionId, expectedInputRevision: latest.input?.inputRevision ?? 0, expectedSessionRevision: latest.sessionRevision, docHash: latest.docDraft?.docHash, draftRevision: latest.draftRevision ?? latest.docDraft?.draftRevision, contextSnapshotId: latest.context?.contextSnapshotId ?? null, confirmation: { contentHash: latest.confirmation?.contentHash ?? latest.contentHash ?? null, route: "create", priority: priorityChoice, owner: ownerChoice.trim() || null, items: [{ itemId: item.itemId, route: "create", candidate: { ...cleanCandidate(candidateOf(item)), title: simpleDraft.title.trim(), goal, problem: simpleDraft.problem.trim(), acceptance }, unknowns: item.unknowns ?? [] }] }, idempotencyKey: idemRef.current, actor: "human:local" }, root);
          setReceipt({ receipt: payload.receipt ?? null, artifacts: payload.artifacts ?? [], replayed: payload.replayed === true });
          setConfirmState({ loading: false, error: null, result: payload });
          setScreen("receipt");
        } catch (caught) {
          setConfirmState({ loading: false, error: errorOf(caught), result: null });
        }
      };
      const renderSimpleReview = () => {
        const field = (label, value, onChange, multiline = false) => h("label", { style: { display: "grid", gap: "6px", color: T.text2, fontSize: "13px" } }, label, h(multiline ? "textarea" : "input", { value, onChange: (event) => onChange(event.target.value), style: { ...input, width: "100%", boxSizing: "border-box" }, ...multiline ? { rows: 2 } : {} }));
        return h(
          "div",
          { style: { display: "grid", gap: "18px", marginTop: "12px" } },
          renderRequirementMatchCard(),
          error ? renderError(error) : null,
          confirmState.error ? renderError(confirmState.error) : null,
          h(
            "div",
            { role: "status", style: { display: "flex", alignItems: "center", gap: "8px", color: T.text2, fontSize: "12px" } },
            h("span", { style: { border: `1px solid ${grillApplied ? T.brand : T.line2}`, color: grillApplied ? T.brand : T.text2, borderRadius: "999px", padding: "3px 8px" } }, grillApplied ? "Grill Skill \u5DF2\u53C2\u4E0E\u672C\u8F6E" : grillFallback ? "Grill \u672A\u5B8C\u6210\uFF0C\u672C\u5730\u6F84\u6E05" : "\u672C\u5730\u6F84\u6E05"),
            grillApplied ? `\u7B2C ${session.grill.round || 1} \u8F6E` : grillFallback ? "\u6A21\u578B\u8C03\u7528\u672A\u5B8C\u6210\uFF1B\u4EE5\u4E0B\u95EE\u9898\u662F\u672C\u5730\u5EFA\u8BAE\uFF0C\u5E76\u975E Grill \u7ED3\u679C" : "\u6A21\u578B\u4E0D\u53EF\u7528\u65F6\u4F7F\u7528\u672C\u5730\u52A8\u6001\u5EFA\u8BAE"
          ),
          h(
            "div",
            { style: { display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "14px", alignItems: "end" } },
            field("\u9700\u6C42\u6807\u9898", simpleDraft.title, (value) => setSimpleDraft((d) => ({ ...d, title: value }))),
            h("fieldset", { style: { border: 0, padding: 0, margin: 0 } }, h("legend", { style: { color: T.text2, fontSize: "13px", marginBottom: "6px" } }, "\u4F18\u5148\u7EA7"), ...["P0", "P1", "P2"].map((value) => h("button", { key: value, type: "button", "aria-pressed": priorityChoice === value, onClick: () => setPriorityChoice(value), style: { ...button, marginRight: "5px", borderColor: priorityChoice === value ? T.brand : T.line2, color: priorityChoice === value ? T.text : T.text2 } }, value)))
          ),
          h("section", null, h("h3", { style: { fontSize: "15px", margin: "0 0 10px" } }, "\u9700\u6C42\u4EF7\u503C\u4E0E\u8FB9\u754C\u62F7\u95EE"), ...grillQuestions.map((q) => h("div", { key: q.id, style: { marginBottom: "12px" } }, h("div", { style: { fontSize: "13px", marginBottom: "6px" } }, q.question), h("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" } }, ...q.options.map((option) => h("button", { key: option, type: "button", "aria-pressed": grillAnswers[q.id] === option, onClick: () => updateGrill(q.id, option), style: { ...button, borderColor: grillAnswers[q.id] === option ? T.brand : T.line2 } }, option)), h("button", { type: "button", style: button, onClick: () => setGrillCustom((current) => ({ ...current, [q.id]: !current[q.id] })) }, "\u81EA\u5B9A\u4E49\u2026"), grillCustom[q.id] ? h("input", { "aria-label": `${q.question} \u81EA\u5B9A\u4E49\u56DE\u7B54`, value: grillAnswers[q.id] ?? "", placeholder: "\u8F93\u5165\u8865\u5145\u56DE\u7B54", onChange: (event) => updateGrill(q.id, event.target.value), style: { ...input, flex: "1 1 160px", minWidth: 0 } }) : null)))),
          grillAvailable ? h("div", { style: { display: "flex", flexWrap: "wrap", gap: "8px" } }, h("button", { type: "button", style: button, disabled: busy || analysisPending(), onClick: continueGrilling }, grillApplied ? "\u7EE7\u7EED\u8FFD\u95EE" : "\u4F7F\u7528 Grill \u91CD\u8BD5"), h("button", { type: "button", style: button, onClick: copyGrillCommand }, "\u8F6C\u5165\u4E3B\u5BF9\u8BDD /grilling")) : null,
          h(
            "section",
            { style: { display: "grid", gap: "10px" } },
            h("h3", { style: { fontSize: "15px", margin: 0 } }, "\u9700\u6C42\u8349\u7A3F"),
            field("\u9884\u671F\u53D8\u5316", simpleDraft.goal, (value) => setSimpleDraft((d) => ({ ...d, goal: value })), true),
            field("\u4EF7\u503C", simpleDraft.problem, (value) => setSimpleDraft((d) => ({ ...d, problem: value })), true),
            h("div", null, h("div", { style: { fontSize: "13px", color: T.text2, marginBottom: "6px" } }, "\u9A8C\u6536\u6807\u51C6\uFF08\u5EFA\u8BAE\u8349\u7A3F\uFF0C\u8BF7\u6838\u5BF9\uFF09"), ...simpleDraft.acceptance.map((entry, index) => h("div", { key: entry.id ?? index, style: { display: "flex", gap: "6px", marginBottom: "6px" } }, h("input", { "aria-label": `\u9A8C\u6536\u6807\u51C6 ${index + 1}`, value: entry.text, onChange: (event) => setSimpleDraft((d) => ({ ...d, acceptance: d.acceptance.map((v, i) => i === index ? { ...v, text: event.target.value, provenance: "human-edit" } : v) })), style: { ...input, flex: 1, minWidth: 0 } }), h("button", { type: "button", "aria-label": `\u5220\u9664\u9A8C\u6536\u6807\u51C6 ${index + 1}`, style: button, onClick: () => setSimpleDraft((d) => ({ ...d, acceptance: d.acceptance.filter((_, i) => i !== index) })) }, "\u5220\u9664"))), h("button", { type: "button", style: button, onClick: () => setSimpleDraft((d) => ({ ...d, acceptance: [...d.acceptance, { text: "", provenance: "human-edit" }] })) }, "\u65B0\u589E\u9A8C\u6536\u6807\u51C6"))
          )
        );
      };
      const renderRequirementMatchCard = () => {
        const match = requirementMatch;
        const target = match?.matchedReq;
        if (!target || !["high", "medium"].includes(match.confidence)) return null;
        return h(
          "section",
          { role: "status", "data-testid": "requirement-match-card", style: { border: `1px solid ${T.brand}`, borderLeft: `4px solid ${T.brand}`, borderRadius: "8px", background: T.layer2, padding: "12px 14px", marginBottom: "2px" } },
          h("div", { style: { fontSize: "12px", color: T.brand, fontWeight: 600 } }, "\u{1F9F2} \u68C0\u6D4B\u5230\u5173\u8054\u9700\u6C42"),
          h("div", { style: { marginTop: "3px", color: T.text, fontSize: "14px", fontWeight: 600, lineHeight: 1.6 } }, `${target.id} \xB7 v${target.revision ?? 1} \xB7 ${target.title}`),
          h("div", { style: { marginTop: "3px", color: T.text2, fontSize: "12px", lineHeight: 1.6 } }, match.reason),
          h(
            "div",
            { style: { display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "10px" } },
            h("button", { type: "button", style: primaryState(busy), disabled: busy, onClick: submitMatchedFeedback }, `\u4F5C\u4E3A ${target.id} \u7684\u8FED\u4EE3\u53CD\u9988\u6536\u655B`),
            h("button", { type: "button", style: button, disabled: busy, onClick: () => {
              setAttachMatchedFeedback(false);
              setRequirementMatch(null);
            } }, "\u4ECD\u4F5C\u4E3A\u5168\u65B0\u9700\u6C42\u521B\u5EFA")
          )
        );
      };
      const renderReview = () => {
        if (simpleReview()) return renderSimpleReview();
        const gate = confirmationGate();
        const items = activeItems();
        const first = items[0];
        return h(
          "div",
          { style: { marginTop: "8px" } },
          renderRequirementMatchCard(),
          renderDraftSummary(),
          h("div", { role: "status", "data-testid": "intent-review-notice", style: notice ? { border: `1px solid ${T.line2}`, borderRadius: "10px", padding: "8px 12px", marginBottom: "10px", color: T.text2, fontSize: "12px", lineHeight: 1.7, background: T.layer } : void 0 }, notice ?? ""),
          history.error ? h("p", { role: "alert", style: { color: T.warn } }, `\u91CD\u65B0\u52A0\u8F7D\u5931\u8D25\uFF1A${history.error.message}`) : null,
          error ? renderError(error) : null,
          conflicts.length ? renderConflicts() : null,
          h(
            "p",
            { style: { margin: "8px 0 0", fontSize: "13.5px", color: T.text, lineHeight: 1.8 } },
            items.length === 0 ? "\u6CA1\u6709\u53EF\u786E\u8BA4\u7684\u610F\u56FE\u9879\u3002" : items.length === 1 ? `\u6211\u7684\u7406\u89E3\uFF1A${first.userProblem || first.desiredOutcome || "\uFF08\u89C1\u4E0B\u65B9\u5019\u9009\uFF09"}` : `\u6211\u7684\u7406\u89E3\uFF1A\u8FD9\u91CC\u5176\u5B9E\u662F ${items.length} \u4E2A\u610F\u56FE\uFF0C\u4E0B\u9762\u9010\u4E2A\u786E\u8BA4\u3002`
          ),
          renderConfirmedDecisions(),
          renderHistoricalAnswers(),
          renderQuestionGroup() ?? renderQuestion(),
          tonePill(draftPhase().tone, draftPhase().label),
          renderIntentDraft(),
          h(
            "details",
            { style: { marginTop: "12px", color: T.text2, fontSize: "12px" } },
            h("summary", { style: { cursor: "pointer" } }, "\u5206\u6790\u4E0E\u8349\u6848\u4FE1\u606F"),
            h(
              "div",
              { style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginTop: "8px" } },
              h("span", { style: muted }, "\u5F53\u524D\u8349\u6848\u7248\u672C"),
              confirmDochash(),
              session?.input?.inputRevision === void 0 ? null : h("span", { style: muted }, `\u8F93\u5165\u7248\u672C ${session.input.inputRevision}`),
              session?.context?.generatedAt ? h("span", { style: muted }, `\u4E0A\u4E0B\u6587 ${intentTime(session.context.generatedAt)}`) : null,
              renderTimingLine(),
              h("button", { type: "button", style: { ...button, padding: "4px 8px", fontSize: "12px" }, disabled: busy || analysisPending(), onClick: () => runAnalyze() }, analysisPending() ? "\u5206\u6790\u4E2D\u2026" : "\u91CD\u65B0\u5206\u6790"),
              session?.sessionId ? h("button", { type: "button", style: { ...button, padding: "4px 8px", fontSize: "12px" }, disabled: busy || history.loading || !historyAllowed, onClick: () => readHistory(session.sessionId) }, history.loading ? "\u91CD\u65B0\u52A0\u8F7D\u4E2D\u2026" : "\u91CD\u65B0\u52A0\u8F7D\u4F1A\u8BDD") : null
            ),
            renderClarificationStatus()
          ),
          session?.manual ? tonePill("warn", "\u624B\u52A8\u6A21\u5F0F\uFF08\u672A\u8C03\u7528\u6A21\u578B\uFF09") : null,
          editBusy ? h("span", { style: muted }, "\u6B63\u5728\u4FDD\u5B58\u4F60\u7684\u4FEE\u6539\u2026") : null,
          renderInvestigationPanel(),
          renderInvestigations(),
          h("div", { ref: candidateRef }, items.map((item, index) => renderItemSection(item, index, items.length))),
          gate.ready ? null : h(
            "div",
            { ref: blockerRef, id: "intent-confirm-blocker", tabIndex: -1, "data-testid": "intent-confirm-blocker", role: "status", style: { marginTop: "12px" } },
            h("div", { style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } }, tonePill("neutral", "\u8FD8\u4E0D\u80FD\u786E\u8BA4"), h("span", { style: muted }, "\u5148\u5904\u7406\u4E0B\u9762\u7684\u539F\u56E0")),
            h(
              "ul",
              { style: { margin: "6px 0 0", paddingLeft: "18px", fontSize: "12px", color: T.text2, lineHeight: 1.8 } },
              gate.reasons.map((reason, index) => h("li", { key: `${reason.code ?? "reason"}-${index}` }, reason.message ?? reason.code))
            )
          )
        );
      };
      const renderRehearsal = () => {
        if (rehearsal.loading) return h("p", { style: { margin: "6px 0 0", ...muted } }, "\u6B63\u5728\u8BFB\u53D6\u65E7/\u65B0\u5DEE\u5F02\u4E0E\u5F71\u54CD\uFF08\u53EA\u8BFB\u8BF7\u6C42\uFF09\u2026");
        if (rehearsal.error) return h("p", { style: { margin: "6px 0 0", color: T.warn, fontSize: "12px" } }, `\u5F71\u54CD\u9884\u89C8\u5931\u8D25\uFF1A${rehearsal.error}`);
        const preview = rehearsal.data;
        if (!preview) {
          const noBase = !rehearsal.base?.uid;
          return h(
            "p",
            { style: { margin: "6px 0 0", color: T.warn, fontSize: "12px", lineHeight: 1.7 } },
            noBase ? "\u6CA1\u6709\u5339\u914D\u5230\u53EF\u53D8\u66F4\u7684\u65E2\u6709\u627F\u8BFA\uFF1A\u8BF7\u8FD4\u56DE\u539F\u8BDD\u8865\u5145\u9700\u6C42 ID\uFF0C\u6216\u628A\u53BB\u5411\u6539\u4E3A\u201C\u65B0\u5EFA\u9700\u6C42\u201D\u3002\u672A\u767B\u8BB0\u5F71\u54CD\uFF08\u4E0D\u7B49\u4E8E\u65E0\u5F71\u54CD\uFF09\u3002" : "\u672A\u767B\u8BB0\u5F71\u54CD\uFF08\u4E0D\u7B49\u4E8E\u65E0\u5F71\u54CD\uFF09\uFF1B\u672A\u53D6\u5F97\u53D8\u66F4\u9884\u89C8\u3002"
          );
        }
        const before = preview.requirementBefore ?? {};
        const after = preview.requirementAfter ?? {};
        const changes = preview.changes ?? [];
        const impact = preview.impact ?? {};
        return h(
          "div",
          { style: { marginTop: "6px" } },
          h(
            "div",
            { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "8px" } },
            h(
              "div",
              { style: { border: `1px solid ${T.line}`, borderRadius: "9px", padding: "8px 10px", background: T.layer } },
              h("div", { style: { fontSize: "10.5px", color: T.text3 } }, "\u53D8\u66F4\u524D"),
              h(
                "div",
                { style: { fontSize: "12px", color: T.text2, whiteSpace: "pre-wrap", wordBreak: "break-word", marginTop: "2px" } },
                `\u6807\u9898\uFF1A${before.title ?? "\u2014"}
\u4F18\u5148\u7EA7\uFF1A${before.priority ?? "\u2014"}`
              )
            ),
            h(
              "div",
              { style: { border: `1px solid ${T.line}`, borderLeft: `3px solid ${T.brand}`, borderRadius: "9px", padding: "8px 10px" } },
              h("div", { style: { fontSize: "10.5px", color: T.text3 } }, "\u53D8\u66F4\u540E"),
              h(
                "div",
                { style: { fontSize: "12px", color: T.text, whiteSpace: "pre-wrap", wordBreak: "break-word", marginTop: "2px" } },
                `\u6807\u9898\uFF1A${after.title ?? "\u2014"}
\u4F18\u5148\u7EA7\uFF1A${after.priority ?? "\u2014"}`
              )
            )
          ),
          h(
            "div",
            { style: { marginTop: "6px", fontSize: "11.5px", color: T.text2, lineHeight: 1.8 } },
            changes.map((entry) => `${entry.field}\uFF1A${entry.before || "\uFF08\u7A7A\uFF09"} \u2192 ${entry.after || "\uFF08\u7A7A\uFF09"}`).join("\n")
          ),
          impact.coverage ? h(
            "div",
            { style: { marginTop: "4px", fontSize: "11px", color: T.text3 } },
            `\u5F71\u54CD\u626B\u63CF\uFF1A\u5173\u7CFB ${impact.coverage.relations ?? 0} \xB7 \u5DF2\u63A2\u7D22 ${impact.coverage.explored ?? 0} \xB7 \u8DEF\u5F84 ${(impact.paths ?? []).length}${impact.coverage.truncated ? " \xB7 \u5DF2\u622A\u65AD" : ""}`
          ) : null,
          (impact.paths ?? []).length ? h(
            "details",
            { style: { marginTop: "6px" } },
            h("summary", { style: { cursor: "pointer", fontSize: "11.5px", color: T.text2 } }, `\u5F71\u54CD\u8DEF\u5F84\uFF08${impact.paths.length}\uFF09`),
            h(
              "div",
              { style: { marginTop: "4px", fontSize: "11.5px", color: T.text2, lineHeight: 1.8 } },
              impact.paths.map((path, index) => h("div", { key: index }, `${path.to} \xB7 \u6DF1\u5EA6 ${path.depth}`))
            )
          ) : null,
          (impact.blindSpots ?? []).length ? h(
            "div",
            { style: { marginTop: "6px", border: `1px solid ${T.line}`, borderRadius: "9px", padding: "6px 10px" } },
            h("div", { style: { color: T.warn, fontSize: "11.5px" } }, "\u76F2\u533A\uFF1A\u672A\u767B\u8BB0\u5F71\u54CD\u4E0D\u7B49\u4E8E\u65E0\u5F71\u54CD"),
            impact.blindSpots.map(
              (spot, index) => h(
                "div",
                { key: index, style: { fontSize: "11.5px", color: T.text2, lineHeight: 1.8 } },
                `${spot.kind === "no-relations" ? "\u672A\u767B\u8BB0\u5173\u7CFB" : spot.kind === "unresolved-target" ? "\u76EE\u6807\u8D44\u4EA7\u7F3A\u5931" : "\u672A\u77E5\u5173\u7CFB\u7C7B\u578B"}\uFF1A${spot.detail}`
              )
            )
          ) : null,
          h("p", { style: { margin: "4px 0 0", fontSize: "11px", color: T.text3 } }, "\u5F71\u54CD\u53EA\u662F\u63D0\u793A\uFF0C\u4E0D\u662F\u963B\u585E\uFF1B\u6B63\u5F0F\u53D8\u66F4\u4ECD\u9700\u4EBA\u5DE5\u786E\u8BA4\u3002")
        );
      };
      const estimateArtifacts = (routes) => {
        const unique = new Set(routes);
        const lines = [];
        if (unique.has("create")) lines.push("1 \u4EFD\u9700\u6C42\u8349\u7A3F");
        if (unique.has("change")) lines.push("1 \u4EFD\u53D8\u66F4\u8349\u7A3F\uFF08\u4E0D\u6539\u6B63\u5F0F sdoc\uFF09");
        if (unique.has("investigate")) lines.push("1 \u4E2A\u6392\u67E5\u9879");
        lines.push("1 \u4EFD\u51B3\u7B56\u56DE\u6267");
        return lines;
      };
      const renderConfirm = () => {
        const items = activeItems();
        const gate = confirmationGate(true);
        const shownError = confirmState.error ?? error;
        const routes = items.map((item) => routeOf(item));
        const createNeedsPriority = routes.indexOf("create") !== -1;
        return h(
          "div",
          { style: { marginTop: "8px" } },
          shownError ? renderError(shownError) : null,
          h("div", { style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", margin: "4px 0 10px" } }, h("span", { style: muted }, "\u672C\u6B21\u4FDD\u5B58\u7248\u672C"), confirmDochash()),
          renderIntentDraft(),
          h(
            "section",
            { style: { ...card, cursor: "default", marginTop: "10px" } },
            h("div", { style: blockTitleStyle }, "\u2460 \u786E\u8BA4\u7684\u95EE\u9898\u4E0E\u671F\u671B\u884C\u4E3A\uFF08\u6700\u7EC8\u6587\u672C\u53EF\u76F4\u63A5\u7F16\u8F91\uFF09"),
            items.map(
              (item, index) => h(
                "div",
                { key: item.itemId, style: { marginTop: "8px" } },
                h("div", { style: fieldLabelStyle }, "\u95EE\u9898"),
                h("textarea", {
                  "aria-label": `${items.length > 1 ? `\u610F\u56FE ${index + 1} ` : ""}\u95EE\u9898`,
                  name: `intent-${item.itemId}-confirm-problem`,
                  autoComplete: "off",
                  value: candidateOf(item).problem,
                  onChange: (event) => setManualField(item.itemId, "problem", event.target.value),
                  style: { ...input, width: "100%", minWidth: 0, minHeight: "56px", resize: "vertical", fontFamily: "inherit", lineHeight: 1.7 }
                }),
                h("div", { style: { ...fieldLabelStyle, marginTop: "6px" } }, "\u671F\u671B\u884C\u4E3A"),
                h("textarea", {
                  "aria-label": `${items.length > 1 ? `\u610F\u56FE ${index + 1} ` : ""}\u671F\u671B\u884C\u4E3A`,
                  name: `intent-${item.itemId}-confirm-goal`,
                  autoComplete: "off",
                  value: candidateOf(item).goal,
                  onChange: (event) => setManualField(item.itemId, "goal", event.target.value),
                  style: { ...input, width: "100%", minWidth: 0, minHeight: "56px", resize: "vertical", fontFamily: "inherit", lineHeight: 1.7 }
                })
              )
            )
          ),
          h(
            "details",
            { style: { marginTop: "10px" } },
            h("summary", { style: { cursor: "pointer", color: T.text2, fontSize: "12px", padding: "8px 2px" } }, "\u2461 \u8303\u56F4\u4E0E\u672A\u8BC1\u5B9E\u90E8\u5206\uFF08\u53EF\u9009\u6838\u5BF9\uFF09"),
            h(
              "section",
              { style: { ...card, cursor: "default", marginTop: "6px" } },
              h("div", { style: blockTitleStyle }, "\u2461 \u505A\u4EC0\u4E48 / \u4E0D\u505A\u4EC0\u4E48\uFF0C\u4EE5\u53CA\u672A\u8BC1\u5B9E\u90E8\u5206"),
              items.map((item) => {
                const candidate = candidateOf(item);
                const unknowns = item.unknowns ?? [];
                return h(
                  "div",
                  { key: item.itemId, style: { marginTop: "6px", fontSize: "12px", color: T.text2, lineHeight: 1.8 } },
                  h("div", null, h("b", { style: { color: T.text, fontWeight: 500 } }, "\u505A\uFF1A"), (candidate.inScope ?? []).length ? candidate.inScope.join("\uFF1B") : "\uFF08\u672A\u586B\u5199\u8303\u56F4\u5185\uFF09"),
                  h("div", null, h("b", { style: { color: T.text, fontWeight: 500 } }, "\u4E0D\u505A\uFF1A"), (candidate.outOfScope ?? []).length ? candidate.outOfScope.join("\uFF1B") : "\uFF08\u672A\u586B\u5199\u8303\u56F4\u5916\uFF09"),
                  h(
                    "div",
                    { style: { color: T.text3 } },
                    `\u672A\u8BC1\u5B9E\uFF1A\u5047\u8BBE ${(item.assumptions ?? []).length} \u6761\u3001\u672A\u77E5\u9879 ${unknowns.length} \u6761\u3001\u53CD\u4F8B ${item.counterexample ? "1" : "0"} \u6761\uFF1B\u8FD9\u4E9B\u4E0D\u4F1A\u88AB\u5199\u6210\u5DF2\u8BC1\u5B9E\u4E8B\u5B9E\u3002`
                  )
                );
              })
            )
          ),
          h(
            "section",
            { style: { ...card, cursor: "default", marginTop: "10px" } },
            h("div", { style: blockTitleStyle }, "\u2462 \u53BB\u5411\u4E0E\u65E2\u6709\u627F\u8BFA"),
            items.map((item, index) => {
              const route = routeOf(item);
              const related = item.related ?? [];
              return h(
                "div",
                { key: item.itemId, style: { marginTop: index === 0 ? "6px" : "10px", borderTop: index === 0 ? "none" : `1px solid ${T.line}`, paddingTop: index === 0 ? 0 : "8px" } },
                h("div", { style: { fontSize: "12.5px", color: T.text } }, `${INTENT_ROUTE_LABELS[route] ?? route}${items.length > 1 ? `\uFF08\u610F\u56FE ${index + 1}\uFF09` : ""}`),
                related.length ? h(
                  "div",
                  { style: { marginTop: "4px", fontSize: "12px", color: T.text2, lineHeight: 1.8 } },
                  `\u65E2\u6709\u627F\u8BFA\uFF1A${related.map((entry) => `${entry.uid}\uFF08${INTENT_MATCH_LABELS[entry.match] ?? entry.match}\uFF09`).join("\u3001")}`
                ) : h(
                  "div",
                  { style: { marginTop: "4px", fontSize: "12px", color: T.text3 } },
                  route === "create" ? "\u5C06\u65B0\u5EFA\u9700\u6C42\uFF0C\u4E0D\u6539\u52A8\u65E2\u6709\u627F\u8BFA\u3002" : "\u672A\u767B\u8BB0\u5F71\u54CD\uFF08\u4E0D\u7B49\u4E8E\u65E0\u5F71\u54CD\uFF09\u3002"
                ),
                route === "change" ? renderRehearsal() : null
              );
            })
          ),
          h(
            "details",
            { open: createNeedsPriority, style: { marginTop: "10px" } },
            h("summary", { style: { cursor: "pointer", color: T.text2, fontSize: "12px", padding: "8px 2px" } }, "\u2463 \u5199\u5165\u5185\u5BB9\u4E0E\u6743\u9650\uFF08\u53EF\u9009\u6838\u5BF9\uFF09"),
            h(
              "section",
              { style: { ...card, cursor: "default", marginTop: "6px" } },
              h("div", { style: blockTitleStyle }, "\u2463 \u5C06\u5199\u5165\u4EC0\u4E48\uFF08\u4FDD\u5B58\u4E0D\u7B49\u4E8E\u91C7\u7EB3\uFF09"),
              h(
                "div",
                { style: { display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "4px" } },
                estimateArtifacts(routes).map(
                  (line, index) => h("span", { key: index, style: { fontSize: "12px", color: T.text2, border: `1px solid ${T.line}`, borderRadius: "7px", padding: "2px 8px", background: T.layer } }, line)
                )
              ),
              h(
                "div",
                { style: { marginTop: "8px", display: "flex", gap: "12px", flexWrap: "wrap" } },
                h(
                  "label",
                  { style: { display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: T.text2, flex: "1 1 180px", minWidth: 0 } },
                  "\u8D1F\u8D23\u4EBA",
                  h("input", { name: "intent-owner", autoComplete: "off", value: ownerChoice, onChange: (event) => changeOwner(event.target.value), placeholder: "\u672A\u6307\u5B9A\uFF08\u6CBF\u7528\u9879\u76EE\u9ED8\u8BA4\uFF09", style: { ...input, width: "100%", minWidth: 0 } })
                ),
                h(
                  "label",
                  { style: { display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: T.text2, flex: "0 1 160px", minWidth: 0 } },
                  createNeedsPriority ? "\u4F18\u5148\u7EA7\uFF08\u65B0\u5EFA\u5FC5\u9009\uFF0C\u4E0D\u731C\uFF09" : "\u4F18\u5148\u7EA7",
                  h(
                    "select",
                    { ref: priorityRef, name: "intent-priority", "data-testid": "intent-priority-select", value: priorityChoice, onChange: (event) => changePriority(event.target.value), style: { ...input, width: "100%", minWidth: 0 } },
                    h("option", { value: "" }, "\u672A\u6307\u5B9A\uFF08\u4E0D\u731C\uFF09"),
                    ["P0", "P1", "P2"].map((value) => h("option", { key: value, value }, value))
                  )
                )
              ),
              h(
                "p",
                { style: { margin: "6px 0 0", ...muted, lineHeight: 1.7 } },
                `\u8D1F\u8D23\u4EBA\u6765\u6E90\uFF1A${ownerChoice.trim() ? "\u4F60\u5728\u539F\u8BDD\u6216\u8868\u5355\u91CC\u660E\u786E\u6307\u5B9A" : "\u672A\u6307\u5B9A\uFF0C\u6CBF\u7528\u9879\u76EE\u9ED8\u8BA4"}\uFF1B\u4F18\u5148\u7EA7\u6765\u6E90\uFF1A${priorityChoice ? "\u4F60\u660E\u786E\u9009\u62E9" : "\u672A\u6307\u5B9A"}\u3002\u4E24\u8005\u90FD\u201C\u5F85\u6743\u9650\u786E\u8BA4\u201D\uFF0C\u4FDD\u5B58\u65F6\u4E0D\u4F1A\u81EA\u52A8\u6307\u6D3E\u6216\u901A\u77E5\u3002`
              )
            )
          ),
          gate.ready ? null : h(
            "div",
            { style: { marginTop: "10px", borderTop: `1px solid ${T.line}`, paddingTop: "8px" } },
            h("div", { style: { color: T.text3, fontSize: "11px", letterSpacing: ".06em", textTransform: "uppercase" } }, "\u8FD8\u4E0D\u80FD\u4FDD\u5B58"),
            h(
              "ul",
              { style: { margin: "4px 0 0", paddingLeft: "18px", fontSize: "12px", color: T.text2, lineHeight: 1.8 } },
              gate.reasons.map((reason, index) => h("li", { key: index }, reason.message ?? reason.code))
            ),
            gate.reasons.some((reason) => reason.code === "investigation-evidence-incomplete") ? h("p", { style: { margin: "6px 0 0", fontSize: "12px", color: T.text2, lineHeight: 1.7 } }, "\u8FD4\u56DE\u4FEE\u6539\uFF0C\u5728\u201C\u5206\u6790\u4E0E\u8349\u6848\u4FE1\u606F\u201D\u4E2D\u91CD\u65B0\u52A0\u8F7D\u4F1A\u8BDD\u5E76\u6838\u5BF9\u8C03\u67E5\uFF1B\u5982\u5F15\u7528\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u8C03\u67E5\u6216\u91C7\u7EB3\u5176\u4ED6\u8BC1\u636E\u3002") : null
          )
        );
      };
      const renderReceipt = () => {
        const artifacts = receipt?.artifacts ?? [];
        const kindLabel = { requirement: "\u9700\u6C42\u8349\u7A3F", change: "\u53D8\u66F4\u8349\u7A3F", "change-draft": "\u53D8\u66F4\u8349\u7A3F", investigation: "\u6392\u67E5\u9879", link: "\u5173\u8054\u8BB0\u5F55", receipt: "\u51B3\u7B56\u56DE\u6267" };
        return h(
          "div",
          { style: { marginTop: "10px" } },
          h(
            "div",
            { style: { ...card, cursor: "default" } },
            h(
              "div",
              { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
              tonePill("success", "\u5DF2\u4FDD\u5B58\u8349\u6848"),
              receipt?.replayed ? tonePill("neutral", "\u5E42\u7B49\u91CD\u653E") : null
            ),
            artifacts.length === 0 ? h("p", { style: { margin: "8px 0 0", ...muted } }, "\u6CA1\u6709\u8FD4\u56DE\u4EA7\u7269\uFF1B\u4FDD\u5B58\u53EF\u80FD\u53EA\u5199\u5165\u4E86\u56DE\u6267\u3002") : h(
              "div",
              { style: { display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px" } },
              artifacts.map((artifact, index) => {
                const artifactId = artifact.id ?? artifact.changeId ?? null;
                const artifactPath = artifact.path ?? artifact.file ?? null;
                const artifactLabel = kindLabel[artifact.kind] ?? artifact.kind ?? "\u4EA7\u7269";
                const artifactSummary = artifact.summary ?? artifact.draft?.summary ?? null;
                return h(
                  "div",
                  { key: `${artifact.kind ?? "artifact"}-${artifactId ?? index}`, style: { border: `1px solid ${T.line}`, borderRadius: "9px", padding: "8px 10px", background: T.layer } },
                  h(
                    "div",
                    { style: { display: "flex", gap: "8px", alignItems: "baseline", flexWrap: "wrap" } },
                    h("span", { style: { fontSize: "11px", color: T.text3 } }, artifactLabel),
                    h("span", { style: { fontSize: "12.5px", color: T.text, fontWeight: 500, wordBreak: "break-word" } }, artifactId ?? artifactLabel),
                    artifact.kind === "requirement" && onOpenRequirement && artifactId ? h(
                      "button",
                      {
                        type: "button",
                        style: { ...button, padding: "0 8px", fontSize: "11px" },
                        onClick: () => {
                          onOpenRequirement(artifactId);
                          finish();
                        }
                      },
                      "\u6253\u5F00\u9700\u6C42\u8BE6\u60C5"
                    ) : null
                  ),
                  artifactPath ? h("div", { style: { marginTop: "2px", fontSize: "11px", color: T.text3, wordBreak: "break-all" } }, artifactPath) : null,
                  artifactSummary ? h("div", { style: { marginTop: "2px", fontSize: "11.5px", color: T.text2, lineHeight: 1.7 } }, artifactSummary) : null,
                  artifactPath || artifactSummary || artifactId ? null : h("div", { style: { marginTop: "2px", ...muted } }, "\u6838\u5FC3\u672A\u8FD4\u56DE\u8BE5\u4EA7\u7269\u7684 ID\u3001\u8DEF\u5F84\u6216\u6458\u8981\u3002")
                );
              })
            ),
            h(
              "p",
              { style: { margin: "10px 0 0", color: T.text2, fontSize: "12px", lineHeight: 1.8 } },
              "\u4FDD\u5B58 \u2260 \u91C7\u7EB3 / \u5F00\u5DE5 / \u9A8C\u6536 / \u53D1\u5E03\u3002\u9700\u6C42\u4ECD\u662F\u8349\u7A3F\uFF1B\u53D8\u66F4\u8349\u7A3F\u5C1A\u4E0D\u6539\u6B63\u5F0F sdoc\uFF1B\u8D1F\u8D23\u4EBA / \u4F18\u5148\u7EA7\u5F85\u6743\u9650\u786E\u8BA4\u3002"
            ),
            receipt?.receipt?.id ? h("p", { style: { margin: "4px 0 0", ...muted } }, `\u56DE\u6267\uFF1A${receipt.receipt.id}`) : null
          )
        );
      };
      const footerFor = () => {
        const gate = confirmationGate(true);
        if (screen === "input") {
          const analyzeDisabled = rawText.trim() === "" && images.length === 0 || busy || history.loading || intake.loading;
          return [
            h("span", { key: "note", style: { marginRight: "auto", fontSize: "11.5px", color: T.text3, alignSelf: "center" } }, `${projectName ?? project ?? "\u2014"} \xB7 \u5148\u6F84\u6E05\uFF0C\u4E0D\u4F1A\u521B\u5EFA\u9700\u6C42\u3002`),
            h("button", { key: "manual", type: "button", style: button, disabled: history.loading || intake.loading, onClick: startManual }, "\u624B\u52A8\u586B\u5199\u5019\u9009"),
            h(
              "button",
              { key: "analyze", type: "button", style: primaryState(analyzeDisabled), disabled: analyzeDisabled, onClick: () => runAnalyze() },
              busy ? "\u5206\u6790\u4E2D\u2026" : "\u5206\u6790\u610F\u56FE"
            )
          ];
        }
        if (screen === "analyzing") {
          return [h("button", { key: "cancel", type: "button", style: button, onClick: cancelAnalyze }, "\u53D6\u6D88\u5206\u6790")];
        }
        if (screen === "review" && simpleReview()) return [
          h("button", { key: "back", type: "button", style: button, onClick: () => setScreen("input") }, "\u8FD4\u56DE\u539F\u8BDD"),
          !priorityChoice ? h("span", { key: "priority-hint", role: "status", style: { marginRight: "auto", alignSelf: "center", fontSize: "12px", color: T.text2 } }, "\u8BF7\u5148\u5728\u53F3\u4E0A\u89D2\u9009\u62E9\u4F18\u5148\u7EA7 (P0/P1/P2)") : null,
          h("button", { key: "confirm", type: "button", style: primaryState(!priorityChoice || confirmState.loading), disabled: !priorityChoice || confirmState.loading, onClick: simpleConfirm }, confirmState.loading ? "\u6B63\u5728\u521B\u5EFA\u2026" : "\u786E\u8BA4\u5E76\u521B\u5EFA\u9700\u6C42")
        ];
        if (screen === "review") {
          const formGate = confirmationFormGate();
          const blockerText = formGate.reasons[0]?.message ?? null;
          const confirmDisabled = busy || editBusy || analysisPending() || !sessionRef.current?.sessionId;
          return [
            h("button", { key: "later", type: "button", style: button, onClick: postpone }, "\u6682\u4E0D\u5904\u7406"),
            h("button", { key: "back", type: "button", style: button, onClick: () => setScreen("input") }, "\u8FD4\u56DE\u539F\u8BDD"),
            h(
              "button",
              { key: "confirm", type: "button", "data-testid": "intent-enter-confirm", style: primaryState(confirmDisabled), disabled: confirmDisabled, "aria-describedby": blockerText ? "intent-confirm-blocker" : void 0, onClick: enterConfirm },
              busy || editBusy ? "\u4FDD\u5B58\u5E76\u68C0\u67E5\u4E2D\u2026" : "\u4FDD\u5B58\u5E76\u68C0\u67E5\uFF0C\u8FDB\u5165\u6700\u7EC8\u786E\u8BA4"
            )
          ];
        }
        if (screen === "confirm") {
          const retry = confirmState.error?.code === "write-failed";
          return [
            h(
              "button",
              { key: "leave", type: "button", style: { ...button, borderColor: "transparent", background: "transparent", color: T.text2 }, onClick: saveAndLeave },
              "\u4FDD\u5B58\u4F1A\u8BDD\u79BB\u5F00"
            ),
            h("button", { key: "back", type: "button", style: button, onClick: () => setScreen("review") }, "\u8FD4\u56DE\u4FEE\u6539"),
            h(
              "button",
              { key: "save", type: "button", style: primaryState(confirmState.loading || !gate.ready), disabled: confirmState.loading || !gate.ready, onClick: submitConfirm },
              confirmState.loading ? "\u4FDD\u5B58\u4E2D\u2026" : retry ? "\u91CD\u8BD5\u4FDD\u5B58\uFF08\u540C\u5E42\u7B49\u952E\uFF09" : "\u786E\u8BA4\u5E76\u4FDD\u5B58\u8FD9\u4EFD\u8349\u6848"
            )
          ];
        }
        return [h("button", { key: "done", type: "button", style: primary, onClick: finish }, "\u5B8C\u6210")];
      };
      const title = screen === "input" ? "\u4F60\u60F3\u6539\u53D8\u4EC0\u4E48\uFF1F" : screen === "analyzing" ? "\u6B63\u5728\u7406\u89E3\u4F60\u7684\u610F\u56FE" : screen === "review" ? "\u8FD9\u4EFD\u7406\u89E3\u5BF9\u5417\uFF1F" : screen === "confirm" ? "\u786E\u8BA4\u5E76\u4FDD\u5B58\u8FD9\u4EFD\u8349\u6848" : "\u8349\u6848\u5DF2\u4FDD\u5B58";
      const lead = screen === "input" ? null : screen === "confirm" ? "\u4FDD\u5B58\u7684\u662F\u4E00\u4EFD\u5F85\u786E\u8BA4\u8349\u6848\uFF1B\u4FDD\u5B58\u4E0D\u7B49\u4E8E\u91C7\u7EB3\u3001\u5F00\u5DE5\u3001\u9A8C\u6536\u6216\u53D1\u5E03\u3002" : screen === "receipt" ? "\u771F\u5B9E\u5199\u5165\u7684\u4EA7\u7269\u5982\u4E0B\uFF1B\u5173\u95ED\u540E\u4F1A\u5237\u65B0\u5217\u8868\u3002" : null;
      return h(
        ModalShell,
        {
          title,
          lead,
          onClose: handleClose,
          width: "820px",
          footer: footerFor(),
          feedbackContext: { stage: "intent", intentSessionId: session?.sessionId ?? null },
          testId: "intent-modal",
          dataSessionId: session?.sessionId ?? "pending",
          dataScreen: screen
        },
        h(
          "div",
          { ref: screenHeadingRef, tabIndex: -1, "data-intent-screen-heading": "true" },
          screen === "input" ? renderInput() : screen === "analyzing" ? renderAnalyzing() : screen === "review" ? renderReview() : screen === "confirm" ? renderConfirm() : renderReceipt()
        )
      );
    }
    function AssociateModal({ workspace, onClose, onLinked }) {
      const [form, setForm] = useState({
        id: workspace.projectId ?? "",
        name: workspace.linked ? workspace.name : workspace.title,
        owner: workspace.github?.owner ?? "",
        repo: workspace.github?.repo ?? "",
        projectNumber: workspace.github?.project?.number ? String(workspace.github.project.number) : ""
      });
      const [state, setState] = useState({ loading: false, error: null, result: null });
      const field = (key) => ({
        name: `associate-${key}`,
        autoComplete: "off",
        value: form[key],
        onChange: (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
      });
      const submit = () => {
        setState({ loading: true, error: null, result: null });
        postJson(
          "projects/associate",
          {
            id: form.id.trim(),
            name: form.name.trim(),
            owner: form.owner.trim(),
            repo: form.repo.trim(),
            projectNumber: form.projectNumber.trim() === "" ? void 0 : Number(form.projectNumber)
          },
          workspace.root
        ).then((result) => {
          setState({ loading: false, error: null, result });
          onLinked?.(result);
        }).catch((error) => setState({ loading: false, error: error.message, result: null }));
      };
      const disabled = state.loading || ["id", "name", "owner", "repo"].some((key) => form[key].trim() === "");
      const remote = state.result?.remote;
      return h(
        ModalShell,
        {
          title: `\u5173\u8054 GitHub \u4ED3\u5E93 \xB7 ${workspace.title}`,
          lead: `\u5199\u5165 ${workspace.root}/.alm/project.json\uFF08\u7F3A\u5931\u65F6\u521B\u5EFA requirements/\uFF09\u3002\u5173\u8054\u540E\u8BE5\u5DE5\u4F5C\u533A\u5373\u4F5C\u4E3A\u9700\u6C42\u9879\u76EE\u7A7A\u95F4\u3002`,
          onClose,
          footer: [
            h("button", { key: "cancel", style: button, onClick: onClose }, state.result ? "\u5173\u95ED" : "\u53D6\u6D88"),
            state.result ? null : h("button", { key: "submit", style: primary, onClick: submit, disabled }, state.loading ? "\u5173\u8054\u4E2D\u2026" : "\u5173\u8054\u4ED3\u5E93")
          ]
        },
        h(
          "div",
          { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginTop: "14px" } },
          h("label", { style: { display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: T.text2 } }, "\u9879\u76EE ID", h("input", { ...field("id"), style: input, placeholder: "PAY" })),
          h("label", { style: { display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: T.text2 } }, "\u9879\u76EE\u540D\u79F0", h("input", { ...field("name"), style: input, placeholder: "\u652F\u4ED8\u5E73\u53F0" })),
          h("label", { style: { display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: T.text2 } }, "GitHub owner", h("input", { ...field("owner"), style: input, placeholder: "peterzhanghao" })),
          h("label", { style: { display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: T.text2 } }, "\u4ED3\u5E93\u540D", h("input", { ...field("repo"), style: input, placeholder: "AI_ALM" })),
          h("label", { style: { display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: T.text2 } }, "ProjectV2 \u7F16\u53F7\uFF08\u53EF\u9009\uFF09", h("input", { ...field("projectNumber"), style: input, placeholder: "1" }))
        ),
        state.loading ? h("p", { style: { margin: "12px 0 0", ...muted } }, "\u6B63\u5728\u5199\u5165\u2026") : null,
        state.error ? h("p", { style: { margin: "12px 0 0", color: T.err, fontSize: "13px" } }, state.error) : null,
        state.result ? h(
          "div",
          { style: { marginTop: "14px" } },
          h(PlanRows, {
            rows: [
              ["\u9879\u76EE", `${state.result.id} \xB7 ${state.result.name}`],
              ["\u4ED3\u5E93", `${state.result.github?.owner}/${state.result.github?.repo}`],
              ["\u6587\u4EF6", state.result.file]
            ]
          }),
          remote?.matches === false ? h("p", { style: { margin: "10px 0 0", color: T.warn, fontSize: "12px" } }, `\u5F53\u524D git remote \u662F ${remote.slug ?? "\u65E0"}\uFF0C\u4E0E\u5173\u8054\u4ED3\u5E93\u4E0D\u4E00\u81F4\uFF1B\u63A8\u9001\u524D\u8BF7\u786E\u8BA4\u3002`) : remote?.matches === true ? h("p", { style: { margin: "10px 0 0", color: T.ok, fontSize: "12px" } }, "git remote \u4E0E\u5173\u8054\u4ED3\u5E93\u4E00\u81F4\u3002") : h("p", { style: { margin: "10px 0 0", ...muted } }, "\u8BE5\u76EE\u5F55\u4E0D\u662F git \u4ED3\u5E93\uFF0C\u672A\u6821\u9A8C remote\u3002")
        ) : null
      );
    }
    function EmptyState({ root, onCreate, onOpenPanel }) {
      return h(
        "div",
        { style: { ...card, cursor: "default", padding: "34px 30px", textAlign: "center" } },
        h("h3", { style: { margin: "0 0 7px", fontSize: "15px" } }, "\u8FD8\u6CA1\u6709\u9700\u6C42"),
        h(
          "p",
          { style: { margin: "0 auto 18px", maxWidth: "440px", color: T.text2, fontSize: "12.5px", lineHeight: 1.7 } },
          "\u5DE5\u4F5C\u533A\u5DF2\u8BFB\u53D6\u6210\u529F\uFF0C\u4F46\u8FD9\u91CC\u8FD8\u6CA1\u6709\u9700\u6C42\u8BB0\u5F55\u3002\u4F60\u53EF\u4EE5\u5148\u5199\u4E00\u6761\u5F85\u8BC4\u5BA1\u8349\u7A3F\uFF0C\u6216\u6253\u5F00\u5DE5\u4F5C\u53F0\u67E5\u770B\u95E8\u7981\u4E0E\u8D44\u4EA7\u3002"
        ),
        h(
          "div",
          { style: { display: "flex", gap: "8px", justifyContent: "center", flexWrap: "wrap" } },
          onCreate ? h(ActionButton, { label: "\u65B0\u5EFA\u9700\u6C42", icon: "plus", variant: "primary", onClick: onCreate }) : null,
          onOpenPanel ? h(ActionButton, { label: "\u6253\u5F00\u5DE5\u4F5C\u53F0", icon: "eye", variant: "secondary", onClick: onOpenPanel }) : null
        ),
        root ? h("p", { style: { margin: "16px 0 0", ...muted } }, `\u5F53\u524D\u6839\uFF1A${root}`) : null
      );
    }
    const DEFECT_MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    const DEFECT_TIMELINE_TONE = {
      failure: T.err,
      regression: T.err,
      failed: T.err,
      analysis: T.text2,
      created: T.text2,
      confirmed: T.brand,
      run: T.brand,
      fixing: T.brand,
      verifying: T.brand,
      verified: T.ok,
      accepted: T.ok,
      closed: T.text3,
      ignored: T.text3,
      deferred: T.warn
    };
    const DEFECT_ITERATION_LABELS = { running: "\u8FD0\u884C\u4E2D", failed: "\u5931\u8D25", "awaiting-acceptance": "\u5F85\u9A8C\u6536", accepted: "\u5DF2\u63A5\u53D7" };
    const DEFECT_ITERATION_TONE = { running: T.brand, failed: T.err, "awaiting-acceptance": T.warn, accepted: T.ok };
    function defectMetaRows(defect) {
      const rows = [];
      if (!defect) return rows;
      if (defect.impact?.severity) rows.push(["\u4E25\u91CD\u5EA6", defect.impact.severity]);
      if (defect.impact?.stage) rows.push(["\u5931\u8D25\u9636\u6BB5", DEFECT_STAGE_LABELS[defect.impact.stage] ?? String(defect.impact.stage)]);
      if (defect.source?.kind) rows.push(["\u6765\u6E90", defect.source.kind === "failure-monitor" ? "\u5931\u8D25\u76D1\u63A7" : String(defect.source.kind)]);
      const occurrences = Number(defect.occurrenceCount ?? 0);
      if (occurrences > 0) rows.push(["\u51FA\u73B0\u6B21\u6570", `${occurrences} \u6B21`]);
      const occurrenceStamps = (defect.occurrences ?? []).map((entry) => entry?.at).filter(Boolean).sort();
      const firstFailure = occurrenceStamps[0] ?? null;
      const lastFailure = occurrenceStamps[occurrenceStamps.length - 1] ?? null;
      if (firstFailure) rows.push(["\u9996\u6B21\u5931\u8D25", formatLocalStamp(firstFailure)]);
      if (lastFailure) rows.push(["\u6700\u8FD1\u5931\u8D25", formatLocalStamp(lastFailure)]);
      if (defect.updatedAt) rows.push(["\u6700\u8FD1\u66F4\u65B0", formatLocalStamp(defect.updatedAt)]);
      if (defect.regressionSuspected) rows.push(["\u56DE\u5F52", "\u7591\u4F3C\u56DE\u5F52\uFF08\u5173\u95ED\u540E\u518D\u6B21\u5931\u8D25\uFF09"]);
      if (defect.ignore?.reason) rows.push(["\u5FFD\u7565\u539F\u56E0", defect.ignore.reason]);
      if (defect.ignore?.expiresAt) rows.push(["\u5FFD\u7565\u81F3", formatLocalStamp(defect.ignore.expiresAt)]);
      return rows;
    }
    function defectAnalysisGroups(defect) {
      const analysis = defect?.analysis ?? null;
      const facts = [];
      const hypotheses = [];
      if (analysis) {
        if (analysis.what) facts.push(`\u73B0\u8C61\uFF1A${analysis.what}`);
        if (analysis.actual) facts.push(`\u5B9E\u9645\uFF1A${analysis.actual}`);
        if (analysis.expected) facts.push(`\u9884\u671F\uFF1A${analysis.expected}`);
        if (Array.isArray(analysis.evidence)) {
          for (const line of analysis.evidence) if (line) facts.push(String(line));
        }
        if (analysis.directCause) facts.push(`\u76F4\u63A5\u539F\u56E0\uFF1A${analysis.directCause}`);
        if (analysis.rootCause) hypotheses.push(`\u6839\u56E0\u5047\u8BBE\uFF1A${analysis.rootCause}`);
        if (analysis.impact) hypotheses.push(`\u5F71\u54CD\u5224\u65AD\uFF1A${analysis.impact}`);
      }
      const missing = Array.isArray(analysis?.missing) ? analysis.missing.filter(Boolean).map(String) : [];
      return { analysis, facts, hypotheses, missing };
    }
    function defectEvidenceOf(defect) {
      const occurrences = Array.isArray(defect?.occurrences) ? defect.occurrences.filter(Boolean) : [];
      const latest = occurrences.find((entry) => entry?.evidence) ?? null;
      const evidence = latest?.evidence ?? {};
      return {
        occurrence: latest,
        logs: Array.isArray(evidence.logs) ? evidence.logs.filter(Boolean).map(String) : [],
        artifacts: Array.isArray(evidence.artifacts) ? evidence.artifacts.filter(Boolean).map(String) : [],
        snapshot: evidence.snapshot ?? null
      };
    }
    function defectFactList(lines, emptyText) {
      if (!lines || lines.length === 0) return h("p", { style: { margin: 0, ...DETAIL_SUB } }, emptyText);
      return h(
        "ul",
        { style: { margin: 0, paddingLeft: "16px", color: T.text2, fontSize: "12.5px", lineHeight: 1.7 } },
        lines.map((line, index) => h("li", { key: `${index}-${line.slice(0, 12)}`, style: { marginBottom: "3px", wordBreak: "break-word" } }, line))
      );
    }
    function DefectTimeline({ timeline }) {
      const entries = Array.isArray(timeline) ? timeline.filter((entry) => entry && (entry.summary || entry.type)) : [];
      if (entries.length === 0) return h("p", { style: { margin: 0, ...DETAIL_SUB } }, "\u8FD8\u6CA1\u6709\u65F6\u95F4\u7EBF\u8BB0\u5F55\u3002");
      const ordered = entries.slice().reverse();
      return h(
        "ol",
        { style: { listStyle: "none", margin: 0, padding: 0 } },
        ordered.map(
          (entry, index) => h(
            "li",
            {
              key: `${entry.at ?? "t"}-${index}`,
              style: { position: "relative", padding: "0 0 12px 18px", borderLeft: index === ordered.length - 1 ? "1px solid transparent" : `1px solid ${T.line}` }
            },
            h("span", {
              "aria-hidden": "true",
              style: { position: "absolute", left: "-4px", top: "5px", width: "7px", height: "7px", borderRadius: "50%", background: DEFECT_TIMELINE_TONE[entry.type] ?? T.text3 }
            }),
            h("div", { style: { fontSize: "11px", color: T.text3 } }, formatLocalStamp(entry.at)),
            h("div", { style: { fontSize: "12.5px", color: T.text2, lineHeight: 1.65, wordBreak: "break-word" } }, entry.summary ?? entry.type)
          )
        )
      );
    }
    function DefectIterations({ iterations }) {
      const entries = Array.isArray(iterations) ? iterations.filter(Boolean) : [];
      if (entries.length === 0) return h("p", { style: { margin: 0, ...DETAIL_SUB } }, "\u8FD8\u6CA1\u6709\u4FEE\u590D\u8FED\u4EE3\u3002");
      return h(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "8px" } },
        entries.slice().reverse().map(
          (entry, index) => h(
            "div",
            { key: entry.run ?? `iteration-${index}`, style: { border: `1px solid ${T.line}`, borderRadius: "9px", padding: "8px 10px" } },
            h(
              "div",
              { style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } },
              h("span", { style: { fontFamily: DEFECT_MONO, fontSize: "11.5px", color: T.text2 } }, entry.run ?? "\uFF08\u65E0 run \u6807\u8BC6\uFF09"),
              h("span", { style: { fontSize: "11.5px", color: DEFECT_ITERATION_TONE[entry.result] ?? T.text3 } }, DEFECT_ITERATION_LABELS[entry.result] ?? entry.result ?? "\u72B6\u6001\u672A\u77E5"),
              h("span", { style: { marginLeft: "auto", fontSize: "11px", color: T.text3 } }, formatLocalStamp(entry.at))
            ),
            entry.change ? h("div", { style: { marginTop: "4px", fontSize: "12px", color: T.text2, lineHeight: 1.6, wordBreak: "break-word" } }, entry.change) : null,
            entry.note ? h("div", { style: { marginTop: "2px", fontSize: "11.5px", color: T.text3, lineHeight: 1.6, wordBreak: "break-word" } }, entry.note) : null
          )
        )
      );
    }
    function defectSummaryCard(defect, extraRows) {
      const rows = [...defectMetaRows(defect), ...extraRows ?? []];
      return h(
        "section",
        { style: DETAIL_CARD },
        h("h4", { style: DETAIL_TITLE }, defect?.title ?? "\uFF08\u65E0\u6807\u9898\uFF09"),
        rows.length ? h("div", { style: { marginTop: "6px" } }, rows.map(([label, value]) => h(DetailRow, { key: label, label }, value))) : h("p", { style: { margin: "6px 0 0", ...DETAIL_SUB } }, "\u540E\u7AEF\u672A\u8FD4\u56DE\u7ED3\u6784\u5316\u6458\u8981\u3002")
      );
    }
    function DefectInbox({ root, initial, onClose, onOpen, onSettings }) {
      const [state, setState] = useState({ loading: true, error: null, defects: Array.isArray(initial) ? initial : [] });
      useEffect(() => {
        let live = true;
        setState((current) => ({ ...current, loading: true, error: null }));
        writeJson("defect", { mode: "list", status: "awaiting-confirmation" }, root).then((payload) => {
          if (!live) return;
          setState({ loading: false, error: null, defects: defectListOf(payload) });
        }).catch((error) => {
          if (!live) return;
          setState((current) => ({ loading: false, error: error.message, defects: current.defects }));
        });
        return () => {
          live = false;
        };
      }, [root]);
      const rows = state.defects.map((defect, index) => {
        const severity = defect?.impact?.severity ?? null;
        const occurrences = Number(defect?.occurrenceCount ?? 0);
        return h(
          "div",
          { key: defect?.id ?? `defect-${index}`, style: { border: `1px solid ${T.line}`, borderRadius: "10px", padding: "10px 12px", marginTop: index === 0 ? "12px" : "8px", background: T.layer } },
          h(
            "div",
            { style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } },
            h(DefectStatusPill, { defect }),
            h("span", { style: { fontFamily: DEFECT_MONO, fontSize: "11.5px", color: T.text2 } }, defect?.id ?? "\uFF08\u7F3A\u5C11 ID\uFF09"),
            severity ? h("span", { style: { fontSize: "11px", color: DEFECT_SEVERITY_TONE[severity] ?? T.text3 } }, `\u4E25\u91CD\u5EA6 ${severity}`) : null,
            occurrences > 1 ? h("span", { style: { fontSize: "11px", color: T.text2, fontVariantNumeric: "tabular-nums" } }, `\xD7${occurrences}`) : null,
            defect?.regressionSuspected ? h("span", { style: { fontSize: "11px", color: T.warn } }, "\u7591\u4F3C\u56DE\u5F52") : null
          ),
          h("div", { style: { marginTop: "5px", fontSize: "13px", color: T.text, lineHeight: 1.5, wordBreak: "break-word" } }, defect?.title ?? "\uFF08\u65E0\u6807\u9898\uFF09"),
          h(
            "div",
            { style: { marginTop: "6px", display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", fontSize: "11.5px", color: T.text3 } },
            h("span", null, `\u5931\u8D25\u9636\u6BB5\uFF1A${DEFECT_STAGE_LABELS[defect?.impact?.stage] ?? defect?.impact?.stage ?? "\u672A\u8BB0\u5F55"}`),
            defect?.source?.lastFailure ? h("span", null, `\u6700\u8FD1\u5931\u8D25\uFF1A${formatLocalStamp(defect.source.lastFailure)}`) : null,
            defect?.updatedAt ? h("span", null, `\u66F4\u65B0\uFF1A${formatLocalStamp(defect.updatedAt)}`) : null,
            h("span", { style: { marginLeft: "auto", display: "inline-flex" } }, h(ActionButton, { label: "\u5904\u7406", icon: "alert", variant: "accent", onClick: () => onOpen?.(defect) }))
          )
        );
      });
      return h(
        ModalShell,
        {
          title: "\u5F85\u786E\u8BA4\u7F3A\u9677",
          lead: "\u5931\u8D25\u76D1\u63A7\u628A\u53EF\u590D\u73B0\u7684\u5931\u8D25\u81EA\u52A8\u5EFA\u6210\u4E86\u7F3A\u9677\u9700\u6C42\u3002\u786E\u8BA4\u4E4B\u524D AI \u4E0D\u6539\u4EE3\u7801\uFF1B\u6682\u7F13\u6216\u5FFD\u7565\u4E5F\u8981\u7ED9\u51FA\u7406\u7531\u3002",
          onClose,
          width: "760px",
          footer: [
            h(ActionButton, { key: "settings", label: "\u76D1\u63A7\u8BBE\u7F6E", icon: "flask", variant: "ghost", onClick: () => onSettings?.() }),
            h(ActionButton, { key: "close", label: "\u5173\u95ED", variant: "secondary", onClick: onClose })
          ]
        },
        state.loading ? h("p", { style: { margin: "14px 0 0", ...DETAIL_SUB } }, "\u6B63\u5728\u8BFB\u53D6\u7F3A\u9677\u53F0\u8D26\u2026") : null,
        state.error ? h("p", { style: { margin: "14px 0 0", color: T.err, fontSize: "12.5px", lineHeight: 1.7 } }, `\u8BFB\u53D6\u7F3A\u9677\u53F0\u8D26\u5931\u8D25\uFF1A${state.error}`) : null,
        !state.loading && !state.error && rows.length === 0 ? h("p", { style: { margin: "16px 0 0", ...DETAIL_SUB } }, "\u6CA1\u6709\u5F85\u786E\u8BA4\u7684\u7F3A\u9677\u3002") : null,
        rows
      );
    }
    function DefectModal({ defect, item, root, onClose, onDone, onConfirm, onSettings }) {
      const [current, setCurrent] = useState(defect);
      const [state, setState] = useState({ busy: null, error: null, result: null });
      const [ignoreOpen, setIgnoreOpen] = useState(false);
      const [ignoreReason, setIgnoreReason] = useState("");
      const [ignoreExpires, setIgnoreExpires] = useState("");
      const [linkOpen, setLinkOpen] = useState(false);
      const [linkInput, setLinkInput] = useState("");
      useEffect(() => {
        setCurrent(defect);
      }, [defect]);
      const record = current ?? defect ?? null;
      const analysisGroups = defectAnalysisGroups(record);
      const evidence = defectEvidenceOf(record);
      const awaiting = record?.status === "awaiting-confirmation" || record?.status === "deferred";
      const linked = Array.isArray(record?.linkedRequirements) ? record.linkedRequirements.filter(Boolean) : [];
      const act = (mode, extra) => {
        if (state.busy) return;
        if (!record?.id) {
          setState({ busy: null, error: "\u7F3A\u9677\u8BB0\u5F55\u7F3A\u5C11 ID\uFF0C\u65E0\u6CD5\u63D0\u4EA4\u3002", result: null });
          return;
        }
        setState({ busy: mode, error: null, result: null });
        writeJson("defect", { defectId: record.id, actor: "human:local", ...extra, mode }, root).then((payload) => {
          const next = defectOfResponse(payload);
          if (next) setCurrent(next);
          setState({ busy: null, error: null, result: { mode, payload } });
          onDone?.(payload);
        }).catch((error) => setState({ busy: null, error: error.message, result: null }));
      };
      const resultLabel = (mode) => ({ defer: "\u5DF2\u6682\u7F13", ignore: "\u5DF2\u5FFD\u7565", link: "\u5DF2\u5173\u8054" })[mode] ?? "\u5DF2\u5B8C\u6210";
      const linkValue = linkInput.trim().toUpperCase();
      const linkValid = /^REQ-[A-Z0-9]{2,8}-\d{3}$/.test(linkValue);
      const footer = [h(ActionButton, { key: "close", label: "\u5173\u95ED", variant: "ghost", onClick: onClose })];
      if (onSettings) footer.push(h(ActionButton, { key: "settings", label: "\u76D1\u63A7\u8BBE\u7F6E", icon: "flask", variant: "ghost", onClick: () => onSettings() }));
      if (awaiting) {
        footer.push(
          h(ActionButton, { key: "link", label: "\u5173\u8054\u5DF2\u6709\u9700\u6C42", icon: "link", variant: "ghost", onClick: () => setLinkOpen((value) => !value) }),
          h(ActionButton, { key: "ignore", label: "\u5FFD\u7565", icon: "close", variant: "ghost", onClick: () => setIgnoreOpen((value) => !value) }),
          h(ActionButton, { key: "defer", label: state.busy === "defer" ? "\u6682\u7F13\u4E2D\u2026" : "\u6682\u7F13", icon: "refresh", variant: "secondary", disabled: Boolean(state.busy), onClick: () => act("defer", {}) }),
          h(ActionButton, { key: "confirm", label: "\u786E\u8BA4\u5E76\u5F00\u59CB\u8FED\u4EE3", icon: "play", variant: "primary", disabled: Boolean(state.busy), onClick: () => onConfirm?.(record) })
        );
      }
      return h(
        ModalShell,
        {
          title: `\u7F3A\u9677 ${record?.id ?? ""}`.trim(),
          lead: "\u6765\u6E90\u662F\u5931\u8D25\u76D1\u63A7\uFF0C\u4E0D\u662F\u4EBA\u7684\u9700\u6C42\u63CF\u8FF0\uFF1A\u5148\u786E\u8BA4\u4E8B\u5B9E\u4E0E\u6839\u56E0\uFF0C\u518D\u6388\u6743\u4E00\u6B21\u4FEE\u590D\u8FED\u4EE3\u3002",
          onClose,
          feedbackContext: feedbackContextFor(item, { failureIds: record?.id ? [record.id] : [] }),
          width: "820px",
          footer
        },
        h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginTop: "14px" } },
          h(DefectStatusPill, { defect: record }),
          record?.requirement ? h("span", { style: { fontFamily: DEFECT_MONO, fontSize: "11.5px", color: T.text2 } }, `\u9700\u6C42 ${record.requirement}`) : null,
          record?.fingerprint ? h("span", { style: { fontFamily: DEFECT_MONO, fontSize: "11px", color: T.text3 } }, `\u6307\u7EB9 ${String(record.fingerprint).slice(0, 18)}`) : null
        ),
        defectSummaryCard(record),
        h(
          "section",
          { style: DETAIL_CARD },
          h(
            "div",
            { style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" } },
            h("h4", { style: DETAIL_TITLE }, "\u539F\u56E0\u5206\u6790"),
            h("span", { style: { ...DETAIL_SUB, marginLeft: "auto" } }, analysisGroups.analysis ? `\u5206\u6790\u72B6\u6001 ${record.analysisStatus ?? "unknown"}` : "\u5C1A\u672A\u5206\u6790")
          ),
          h(SubBlock, { title: "\u5DF2\u8BC1\u5B9E\u4E8B\u5B9E", first: true }, defectFactList(analysisGroups.facts, "\u8FD8\u6CA1\u6709\u5DF2\u8BC1\u5B9E\u7684\u4E8B\u5B9E\u3002")),
          h(SubBlock, { title: "\u5F85\u9A8C\u8BC1\u5047\u8BBE" }, defectFactList(analysisGroups.hypotheses, "\u8FD8\u6CA1\u6709\u63D0\u51FA\u6839\u56E0\u5047\u8BBE\u3002")),
          h(SubBlock, { title: "\u7F3A\u5931\u4FE1\u606F" }, defectFactList(analysisGroups.missing, "\u6CA1\u6709\u6807\u8BB0\u7F3A\u5931\u4FE1\u606F\u3002")),
          analysisGroups.analysis?.confidence ? h("p", { style: { margin: "8px 0 0", ...DETAIL_SUB } }, `\u5206\u6790\u7F6E\u4FE1\u5EA6\uFF1A${analysisGroups.analysis.confidence}`) : null
        ),
        h(
          "section",
          { style: DETAIL_CARD },
          h("h4", { style: { ...DETAIL_TITLE, marginBottom: "8px" } }, "\u8BC1\u636E"),
          h(SubBlock, { title: "\u65E5\u5FD7", first: true }, defectFactList(evidence.logs, "\u6CA1\u6709\u65E5\u5FD7\u7247\u6BB5\u3002")),
          h(SubBlock, { title: "\u4EA7\u7269", first: false }, defectFactList(evidence.artifacts, "\u6CA1\u6709\u4EA7\u7269\u8DEF\u5F84\u3002")),
          h(
            "div",
            { style: { marginTop: "10px" } },
            evidence.snapshot ? h(
              "div",
              { style: { display: "flex", gap: "14px", flexWrap: "wrap", fontSize: "11.5px", color: T.text3 } },
              h("span", null, `HEAD ${shortHash(evidence.snapshot.headSha, 12)}`),
              evidence.snapshot.treeHash ? h("span", null, `tree ${shortHash(evidence.snapshot.treeHash, 12)}`) : null,
              evidence.occurrence?.run ? h("span", null, `\u5931\u8D25 run ${evidence.occurrence.run}`) : null
            ) : h("p", { style: { margin: 0, ...DETAIL_SUB } }, "\u6CA1\u6709\u5931\u8D25\u65F6\u7684\u5FEB\u7167\u3002")
          )
        ),
        h(
          "section",
          { style: DETAIL_CARD },
          h("h4", { style: { ...DETAIL_TITLE, marginBottom: "8px" } }, "\u5173\u8054\u9700\u6C42"),
          linked.length ? h("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap" } }, linked.map((id) => h(MetaChip, { key: id }, id))) : h("p", { style: { margin: 0, ...DETAIL_SUB } }, record?.requirement ? `\u5F53\u524D\u6302\u5728 ${record.requirement} \u4E0B\u3002` : "\u8FD8\u6CA1\u6709\u5173\u8054\u9700\u6C42\u3002"),
          linkOpen ? h(
            "div",
            { style: { marginTop: "10px" } },
            h(
              "div",
              { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
              h("input", {
                value: linkInput,
                onChange: (event) => setLinkInput(event.target.value),
                placeholder: "REQ-PRJ-001",
                "aria-label": "\u8981\u5173\u8054\u7684\u9700\u6C42 ID",
                style: { ...input, flex: "1 1 220px" }
              }),
              h(ActionButton, { label: state.busy === "link" ? "\u5173\u8054\u4E2D\u2026" : "\u5173\u8054", icon: "link", variant: "secondary", disabled: !linkValid || Boolean(state.busy), onClick: () => act("link", { requirementId: linkValue }) })
            ),
            linkInput && !linkValid ? h("p", { style: { margin: "6px 0 0", color: T.warn, fontSize: "11.5px" } }, "\u9700\u6C42 ID \u5F62\u5982 REQ-PRJ-001\u3002") : null
          ) : null
        ),
        h("section", { style: DETAIL_CARD }, h("h4", { style: { ...DETAIL_TITLE, marginBottom: "10px" } }, "\u65F6\u95F4\u7EBF"), h(DefectTimeline, { timeline: record?.timeline })),
        h("section", { style: DETAIL_CARD }, h("h4", { style: { ...DETAIL_TITLE, marginBottom: "10px" } }, "\u8FED\u4EE3\u8BB0\u5F55"), h(DefectIterations, { iterations: record?.iterations })),
        ignoreOpen ? h(
          "section",
          { style: { ...DETAIL_CARD, borderColor: "rgba(231,176,75,.3)" } },
          h("h4", { style: { ...DETAIL_TITLE, marginBottom: "8px" } }, "\u5FFD\u7565\u8FD9\u4E2A\u7F3A\u9677"),
          h("textarea", {
            value: ignoreReason,
            onChange: (event) => setIgnoreReason(event.target.value),
            placeholder: "\u5FC5\u586B\uFF1A\u4E3A\u4EC0\u4E48\u8FD9\u6B21\u5931\u8D25\u53EF\u4EE5\u4E0D\u4FEE\uFF08\u4F8B\u5982\u73AF\u5883\u566A\u58F0\u3001\u540C\u4E00\u6307\u7EB9\u5DF2\u7531\u522B\u7684\u9700\u6C42\u8986\u76D6\uFF09\u3002",
            "aria-label": "\u5FFD\u7565\u539F\u56E0",
            style: { ...input, width: "100%", minHeight: "72px", resize: "vertical", fontFamily: "inherit", lineHeight: 1.7 }
          }),
          h(
            "div",
            { style: { marginTop: "8px", display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } },
            h("label", { style: { fontSize: "11.5px", color: T.text3 } }, "\u5FFD\u7565\u5230\uFF08\u53EF\u9009\uFF09"),
            h("input", {
              type: "date",
              value: ignoreExpires,
              onChange: (event) => setIgnoreExpires(event.target.value),
              "aria-label": "\u5FFD\u7565\u5230\u671F\u65E5\u671F",
              style: { ...input, minWidth: 0, width: "160px" }
            }),
            h("span", { style: { marginLeft: "auto" } }, h(ActionButton, {
              label: state.busy === "ignore" ? "\u63D0\u4EA4\u4E2D\u2026" : "\u786E\u8BA4\u5FFD\u7565",
              icon: "close",
              variant: "secondary",
              disabled: ignoreReason.trim() === "" || Boolean(state.busy),
              onClick: () => {
                act("ignore", {
                  reason: ignoreReason.trim(),
                  expiresAt: ignoreExpires ? `${ignoreExpires}T00:00:00.000Z` : null
                });
                setIgnoreOpen(false);
              }
            }))
          )
        ) : null,
        state.error ? h("p", { style: { margin: "12px 0 0", color: T.err, fontSize: "12.5px", lineHeight: 1.7 } }, `\u64CD\u4F5C\u5931\u8D25\uFF1A${state.error}`) : null,
        state.result ? h(PlanRows, {
          rows: [
            ["\u7ED3\u679C", resultLabel(state.result.mode)],
            ["\u7F3A\u9677\u72B6\u6001", defectStatusLabel(null, defectOfResponse(state.result.payload))],
            ["\u8BF4\u660E", state.result.payload?.message ?? "\u5DF2\u5199\u5165\u7F3A\u9677\u53F0\u8D26"]
          ]
        }) : null,
        awaiting ? null : h("p", { style: { margin: "12px 0 0", ...DETAIL_SUB } }, `\u5F53\u524D\u72B6\u6001\u300C${defectStatusLabel(null, record)}\u300D\u4E0D\u63A5\u53D7\u786E\u8BA4\u64CD\u4F5C\uFF1B\u82E5\u9700\u91CD\u8BD5\uFF0C\u5148\u8BA9\u8FED\u4EE3\u5931\u8D25\u56DE\u5230\u5F85\u786E\u8BA4\u3002`)
      );
    }
    function ConfirmDefectModal({ defect, item, root, onClose, onDone }) {
      const record = defect ?? null;
      const analysis = record?.analysis ?? null;
      const fixes = Array.isArray(analysis?.fixes) ? analysis.fixes.filter(Boolean).map(String) : [];
      const tests = Array.isArray(analysis?.tests) ? analysis.tests.filter(Boolean).map(String) : [];
      const missing = Array.isArray(analysis?.missing) ? analysis.missing.filter(Boolean).map(String) : [];
      const evidence = defectEvidenceOf(record);
      const [scope, setScope] = useState(fixes.join("\n"));
      const [state, setState] = useState({ loading: false, error: null, result: null });
      const scopeValue = scope.trim();
      const submit = () => {
        if (state.loading || !record?.id || !scopeValue) return;
        setState({ loading: true, error: null, result: null });
        writeJson("defect", { mode: "confirm", defectId: record.id, actor: "human:local", scope: scopeValue }, root).then((payload) => {
          setState({ loading: false, error: null, result: payload });
        }).catch((error) => setState({ loading: false, error: error.message, result: null }));
      };
      const finish = () => {
        if (state.loading) return;
        if (state.result) onDone?.(state.result);
        onClose?.();
      };
      const execution = state.result ? defectExecutionOf(state.result) : null;
      let executionText = null;
      if (state.result) {
        if (execution?.scheduled === true) {
          const runRef = execution.run ?? execution.runId ?? execution.id ?? null;
          executionText = `AI \u5DF2\u63A5\u624B\u672C\u8F6E\u4FEE\u590D${runRef ? `\uFF08${runRef}\uFF09` : ""}`;
        } else if (execution?.scheduled === false) {
          executionText = execution.reason ?? execution.message ?? state.result.message ?? "\u5BBF\u4E3B\u672A\u542F\u52A8\u8FED\u4EE3\uFF08\u672A\u8FD4\u56DE\u539F\u56E0\uFF09";
        } else {
          executionText = "\u5DF2\u786E\u8BA4\uFF1B\u6267\u884C\u56DE\u6267\u672A\u8FD4\u56DE\uFF0C\u8BF7\u5237\u65B0\u67E5\u770B\u8FED\u4EE3\u8BB0\u5F55";
        }
      }
      return h(
        ModalShell,
        {
          title: `\u786E\u8BA4\u7F3A\u9677 ${record?.id ?? ""}`.trim(),
          lead: "\u786E\u8BA4\u7B49\u4E8E\u6388\u6743 AI \u6309\u4E0B\u9762\u7684\u8303\u56F4\u6539\u4E00\u6B21\u4EE3\u7801\uFF0C\u5E76\u81EA\u52A8\u8DD1\u9A8C\u6536\u3002\u8303\u56F4\u8D8A\u5177\u4F53\uFF0C\u8FD4\u5DE5\u8D8A\u5C11\u3002",
          onClose: finish,
          width: "780px",
          footer: [
            h(ActionButton, { key: "cancel", label: state.result ? "\u5173\u95ED" : "\u53D6\u6D88", variant: state.result ? "primary" : "ghost", onClick: finish }),
            state.result ? null : h(ActionButton, {
              key: "confirm",
              label: state.loading ? "\u786E\u8BA4\u4E2D\u2026" : "\u786E\u8BA4\u5E76\u5F00\u59CB\u8FED\u4EE3",
              icon: "play",
              variant: "primary",
              disabled: state.loading || !scopeValue,
              onClick: submit
            })
          ]
        },
        h(PlanRows, {
          rows: [
            ["\u7F3A\u9677", record?.title ?? "\uFF08\u65E0\u6807\u9898\uFF09"],
            ["\u5931\u8D25\u9636\u6BB5", DEFECT_STAGE_LABELS[record?.impact?.stage] ?? record?.impact?.stage ?? "\u672A\u8BB0\u5F55"],
            ["\u51FA\u73B0\u6B21\u6570", String(record?.occurrenceCount ?? 0)],
            ["\u8BC1\u636E", evidence.logs.length || evidence.artifacts.length ? `${evidence.logs.length} \u6761\u65E5\u5FD7 \xB7 ${evidence.artifacts.length} \u4E2A\u4EA7\u7269` : "\u540E\u7AEF\u672A\u8FD4\u56DE\u8BC1\u636E"],
            ["\u5931\u8D25\u5FEB\u7167", evidence.snapshot ? shortHash(evidence.snapshot.headSha, 12) : "\u672A\u8BB0\u5F55"]
          ]
        }),
        h(
          "div",
          { style: { marginTop: "16px" } },
          h("div", { style: { fontSize: "11px", letterSpacing: ".06em", textTransform: "uppercase", color: T.text3, marginBottom: "6px" } }, "\u4FEE\u590D\u8303\u56F4\uFF08\u53EF\u7F16\u8F91\uFF09"),
          h("textarea", {
            value: scope,
            onChange: (event) => setScope(event.target.value),
            placeholder: "\u5199\u6E05\u5141\u8BB8\u6539\u54EA\u4E9B\u6587\u4EF6/\u6A21\u5757\u3001\u4E0D\u8BB8\u52A8\u4EC0\u4E48\uFF0C\u4EE5\u53CA\u4FEE\u5B8C\u8981\u6EE1\u8DB3\u7684\u6761\u4EF6\u3002",
            "aria-label": "\u4FEE\u590D\u8303\u56F4",
            style: { ...input, width: "100%", minHeight: "110px", resize: "vertical", fontFamily: "inherit", lineHeight: 1.7 }
          })
        ),
        h(
          "div",
          { style: { marginTop: "14px" } },
          h("div", { style: { fontSize: "11px", letterSpacing: ".06em", textTransform: "uppercase", color: T.text3, marginBottom: "6px" } }, "\u9A8C\u6536\u6807\u51C6"),
          defectFactList(tests, "\u5206\u6790\u672A\u7ED9\u51FA\u9A8C\u6536\u6807\u51C6\uFF1A\u8BF7\u5728\u4FEE\u590D\u8303\u56F4\u91CC\u5199\u6E05\u600E\u4E48\u7B97\u4FEE\u597D\u3002")
        ),
        missing.length ? h("p", { style: { margin: "12px 0 0", color: T.warn, fontSize: "12px", lineHeight: 1.7 } }, `\u6CE8\u610F\uFF1A\u5206\u6790\u4ECD\u7F3A ${missing.length} \u9879\u4FE1\u606F\uFF0CAI \u53EF\u80FD\u9700\u8981\u56DE\u6765\u95EE\u4F60\u3002`) : null,
        state.error ? h("p", { style: { margin: "12px 0 0", color: T.err, fontSize: "12.5px", lineHeight: 1.7 } }, `\u786E\u8BA4\u5931\u8D25\uFF1A${state.error}`) : null,
        state.result ? h(PlanRows, {
          rows: [
            ["\u7ED3\u679C", state.result.message ?? "\u5DF2\u786E\u8BA4"],
            ["\u7F3A\u9677\u72B6\u6001", defectStatusLabel(null, defectOfResponse(state.result))],
            ["\u8FED\u4EE3", executionText]
          ]
        }) : null
      );
    }
    function FeedbackContextSummary({ context, keep, onToggle }) {
      const values = {
        requirement: context?.requirementId ?? null,
        run: context?.runId ?? null,
        intent: context?.intentSessionId ?? null,
        error: context?.recentError ?? null
      };
      return h(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: 6 } },
        h("div", { style: { fontSize: 12, color: T.text2 } }, "\u968F\u53CD\u9988\u4E00\u8D77\u53D1\u9001\u7684\u4E0A\u4E0B\u6587\uFF08\u53EF\u53D6\u6D88\u52FE\u9009\uFF09"),
        context?.overlay?.label ? h(
          "div",
          { "data-feedback-overlay": "true", style: { fontSize: 12, color: T.text2, border: `1px solid ${T.line}`, borderRadius: 7, padding: "5px 8px", background: T.layer } },
          `\u5F53\u65F6\u6240\u5728\u5C42\uFF1A${context.overlay.kind === "drawer" ? "\u8BE6\u60C5\u62BD\u5C49" : context.overlay.kind === "modal" ? "\u5F39\u7A97" : "\u5F39\u5C42"}${context.overlay.tab === "delivery" ? "\uFF08\u4EA4\u4ED8\u9875\u7B7E\uFF09" : context.overlay.tab === "record" ? "\uFF08\u8BB0\u5F55\u9875\u7B7E\uFF09" : context.overlay.tab === "requirement" ? "\uFF08\u9700\u6C42\u9875\u7B7E\uFF09" : ""} \xB7 ${context.overlay.label}`
        ) : null,
        FEEDBACK_KEEP_LABELS.map(([id, label]) => {
          const value = values[id];
          const checked = value ? keep?.[id] !== false : false;
          return h(
            "label",
            {
              key: id,
              "data-feedback-keep-row": id,
              style: { display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: value ? T.text : T.text3 }
            },
            h("input", {
              type: "checkbox",
              "data-feedback-keep": id,
              checked,
              disabled: !value,
              onChange: () => onToggle(id),
              style: { marginTop: 2 }
            }),
            h(
              "span",
              { style: { display: "flex", flexDirection: "column", gap: 1, minWidth: 0 } },
              h("span", null, label),
              h("span", { style: { color: T.text3, fontSize: 11, wordBreak: "break-all" } }, value ? String(value) : "\u672A\u8BB0\u5F55")
            )
          );
        })
      );
    }
    const FEEDBACK_INBOX_FILTERS = [
      ["all", "\u5168\u90E8"],
      ["open", "\u5F85\u5904\u7406"],
      ["deferred", "\u5DF2\u6682\u7F13"],
      ["declined", "\u4E0D\u91C7\u7EB3"],
      ["duplicate", "\u91CD\u590D"],
      ["resolved", "\u5DF2\u9A8C\u8BC1"]
    ];
    function feedbackInboxFilterQuery(filter) {
      if (filter === "all") return "";
      if (filter === "open") return "disposition=open";
      if (filter === "resolved") return "resolution=resolved";
      return `disposition=${filter}`;
    }
    function FeedbackInboxBadge({ label, tone = "neutral" }) {
      const color = tone === "ok" ? T.ok : tone === "warn" ? T.warn : tone === "err" ? T.err : T.text2;
      return h(
        "span",
        { style: { fontSize: 10.5, color, border: `1px solid ${T.line2}`, borderRadius: 999, padding: "1px 7px", whiteSpace: "nowrap" } },
        label
      );
    }
    const FEEDBACK_DISPOSITION_LABELS = { open: "\u5F85\u5904\u7406", linked: "\u5DF2\u5173\u8054\u9700\u6C42", deferred: "\u5DF2\u6682\u7F13", declined: "\u4E0D\u91C7\u7EB3", duplicate: "\u91CD\u590D\u53CD\u9988" };
    const FEEDBACK_RESOLUTION_LABELS = { pending: "\u672A\u9A8C\u8BC1", resolved: "\u5DF2\u9A8C\u8BC1\u89E3\u51B3", reopened: "\u5DF2\u91CD\u5F00" };
    const FEEDBACK_PROCESSING_LABELS = { queued: "\u5F85\u6574\u7406", analyzing: "\u6574\u7406\u4E2D", "draft-ready": "\u5019\u9009\u5DF2\u751F\u6210", failed: "\u6574\u7406\u5931\u8D25", skipped: "\u5DF2\u8DF3\u8FC7" };
    const FEEDBACK_PROPOSAL_LABELS = { "awaiting-confirmation": "\u5F85\u786E\u8BA4", confirmed: "\u5DF2\u786E\u8BA4", converted: "\u5DF2\u8F6C\u9700\u6C42", failed: "\u6574\u7406\u5931\u8D25" };
    function FeedbackInboxRow({ item, root, onOpenRequirement, onChanged }) {
      const [open, setOpen] = useState(false);
      const [detail, setDetail] = useState({ loading: false, record: null, error: null });
      const [busy, setBusy] = useState("");
      const [actionError, setActionError] = useState(null);
      const [actionNote, setActionNote] = useState(null);
      const [linkId, setLinkId] = useState("");
      const [supplementText, setSupplementText] = useState("");
      const [supplementOpen, setSupplementOpen] = useState(false);
      const requirementId = feedbackRequirementId(item.requirement);
      const disposition = item.disposition ?? "open";
      const resolution = item.resolution ?? "pending";
      const processing = item.processing ?? null;
      const [proposal, setProposal] = useState({ loading: false, data: null, error: null });
      const [refState, setRefState] = useState({ loading: false, data: null, error: null });
      const [convertOpen, setConvertOpen] = useState(false);
      const [convertPriority, setConvertPriority] = useState("");
      const loadRequirementRef = () => {
        if (!requirementId) return;
        setRefState({ loading: true, data: null, error: null });
        feedbackGet("requirement-ref", root, `id=${encodeURIComponent(item.id)}`).then((payload) => setRefState({ loading: false, data: payload ?? null, error: null })).catch((error) => setRefState({ loading: false, data: null, error }));
      };
      const openLinkedRequirement = async () => {
        if (!requirementId) return;
        let ref = refState.data?.requirement ?? null;
        if (!ref) {
          try {
            const payload = await feedbackGet("requirement-ref", root, `id=${encodeURIComponent(item.id)}`);
            setRefState({ loading: false, data: payload ?? null, error: null });
            ref = payload?.requirement ?? null;
          } catch (error) {
            setRefState({ loading: false, data: null, error });
          }
        }
        onOpenRequirement(requirementId, ref);
      };
      const convertToRequirement = async () => {
        if (!convertPriority) {
          setActionError({ code: "priority-required", message: "\u8BF7\u5148\u9009\u62E9\u4F18\u5148\u7EA7 P0/P1/P2\uFF08\u4E0D\u731C\u4F18\u5148\u7EA7\uFF09\u3002" });
          return;
        }
        setBusy("generate");
        setActionError(null);
        setActionNote(null);
        try {
          const payload = await feedbackPost("generate", { id: item.id, priority: convertPriority }, root);
          const requirement = payload?.requirement?.id ?? "";
          const destinationName = payload?.destination?.name ?? "";
          setActionNote(
            payload?.deduplicated ? `\u540C\u4E00\u95EE\u9898\u5DF2\u6709\u9700\u6C42\uFF0C\u5DF2\u5173\u8054\u5230 ${requirement}` : `\u5DF2\u751F\u6210\u9700\u6C42 ${requirement}${destinationName ? `\uFF08${destinationName}\uFF09` : ""}`
          );
          setConvertOpen(false);
          loadRequirementRef();
          onChanged?.();
        } catch (error) {
          const code = error?.code ?? "";
          const message = code === "proposal-unconfirmed" ? "\u8FD9\u6761\u53CD\u9988\u7684\u5019\u9009\u8FD8\u6CA1\u786E\u8BA4\uFF0C\u5148\u70B9\u300C\u786E\u8BA4\u5019\u9009\u300D\u518D\u8F6C\u9700\u6C42\u3002" : code === "destination-not-configured" ? "\u8FD8\u6CA1\u6709\u914D\u7F6E\u63A5\u6536\u5DE5\u4F5C\u533A\uFF1A\u5728\u53CD\u9988\u8BBE\u7F6E\u91CC\u9009\u62E9\u76EE\u6807\u5DE5\u4F5C\u533A\u540E\u518D\u8F6C\u9700\u6C42\u3002" : code === "feedback-link-failed" ? `\u9700\u6C42\u5DF2\u521B\u5EFA\u4F46\u53CD\u9988\u6CA1\u5173\u8054\u4E0A\uFF0C\u53EF\u4EE5\u91CD\u8BD5\u3002${error?.message ? `\uFF08${error.message}\uFF09` : ""}` : `\u8F6C\u9700\u6C42\u5931\u8D25\uFF1A${error?.message ?? "\u672A\u77E5\u9519\u8BEF"}`;
          setActionError({ message });
        } finally {
          setBusy("");
        }
      };
      const loadProposal = () => {
        if (!item.proposalId && !processing?.proposalId) return;
        setProposal((prev) => ({ ...prev, loading: true, error: null }));
        feedbackGet("proposal", root, `feedbackId=${encodeURIComponent(item.id)}`).then((payload) => setProposal({ loading: false, data: payload?.proposal ?? null, error: null })).catch((error) => setProposal({ loading: false, data: null, error }));
      };
      useEffect(() => {
        loadProposal();
      }, [item.id, item.proposalId]);
      const organise = async () => {
        setBusy("process");
        setActionError(null);
        try {
          await feedbackPost("process", { id: item.id }, root);
          setActionNote("\u5DF2\u6574\u7406\u51FA\u5019\u9009\uFF0C\u786E\u8BA4\u540E\u53EF\u8F6C\u9700\u6C42");
          loadProposal();
          onChanged();
        } catch (error) {
          setActionError(error);
        } finally {
          setBusy("");
        }
      };
      const confirmProposal = async () => {
        setBusy("proposal-confirm");
        setActionError(null);
        try {
          await feedbackPost("proposal-confirm", { id: item.id }, root);
          setActionNote("\u5019\u9009\u5DF2\u786E\u8BA4\uFF0C\u53EF\u4EE5\u8F6C\u9700\u6C42");
          loadProposal();
          onChanged();
        } catch (error) {
          setActionError(error);
        } finally {
          setBusy("");
        }
      };
      const downloadAttachment = async (attachment) => {
        if (!attachment?.sha256) return;
        try {
          const payload = await feedbackGet("attachment", root, `sha256=${encodeURIComponent(attachment.sha256)}`);
          const blob = `${payload.attachment.type};base64,${payload.attachment.dataBase64}`;
          const link = document.createElement("a");
          link.href = `data:${blob}`;
          link.download = attachment.name ?? attachment.sha256;
          document.body.appendChild(link);
          link.click();
          link.remove();
        } catch (error) {
          setActionError(error);
        }
      };
      const loadDetail = () => {
        if (detail.record || detail.loading) return;
        setDetail({ loading: true, record: null, error: null });
        feedbackGet("record", root, `id=${encodeURIComponent(item.id)}`).then((payload) => setDetail({ loading: false, record: payload?.feedback ?? payload?.record ?? null, error: null })).catch((error) => setDetail({ loading: false, record: null, error }));
      };
      const toggle = () => {
        const next = !open;
        setOpen(next);
        if (next) loadDetail();
      };
      const run = async (action, body, note) => {
        setBusy(action);
        setActionError(null);
        setActionNote(null);
        try {
          const payload = await feedbackPost(action, { id: item.id, ...body }, root);
          setDetail((prev) => ({ ...prev, record: payload?.feedback ?? prev.record }));
          setActionNote(note);
          setSupplementText("");
          setLinkId("");
          onChanged();
        } catch (error) {
          setActionError(error);
        } finally {
          setBusy("");
        }
      };
      const submitSupplement = () => {
        const text = supplementText.trim();
        if (!text) {
          setActionError({ message: "\u8865\u5145\u5185\u5BB9\u4E0D\u80FD\u4E3A\u7A7A" });
          return;
        }
        const supplementId = `fb-ui-sup-${item.id}-${Date.now().toString(36)}`;
        run("supplement", { statement: text, supplementId }, "\u8865\u5145\u5DF2\u4FDD\u5B58").then(() => setSupplementOpen(false));
      };
      const buttonStyle = (tone = "neutral") => ({
        ...button,
        padding: "3px 9px",
        fontSize: 11.5,
        ...tone === "brand" ? { color: T.brand, border: "1px solid rgba(77,107,254,.35)", background: "rgba(77,107,254,.12)" } : {},
        ...tone === "err" ? { color: T.err } : {}
      });
      const record = detail.record;
      const supplements = Array.isArray(record?.supplements) ? record.supplements : [];
      return h(
        "div",
        {
          "data-feedback-row": item.id,
          "data-feedback-disposition": disposition,
          style: {
            border: `1px solid ${T.line}`,
            borderRadius: 9,
            padding: "9px 11px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            background: T.layer
          }
        },
        h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } },
          feedbackStatusBadge(item.status),
          h("span", { "data-feedback-id": item.id, style: { fontSize: 11, color: T.text3, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" } }, item.id),
          h("span", { style: { fontSize: 11.5, color: T.text2 } }, feedbackCategoryLabel(item.category)),
          h("span", { style: { fontSize: 11, color: T.text3 } }, formatLocalStamp(item.createdAt)),
          h(FeedbackInboxBadge, { label: FEEDBACK_DISPOSITION_LABELS[disposition] ?? disposition, tone: disposition === "open" ? "neutral" : disposition === "declined" ? "err" : "warn" }),
          h(FeedbackInboxBadge, { label: FEEDBACK_RESOLUTION_LABELS[resolution] ?? resolution, tone: resolution === "resolved" ? "ok" : resolution === "reopened" ? "err" : "neutral" }),
          processing?.state ? h(FeedbackInboxBadge, {
            label: FEEDBACK_PROCESSING_LABELS[processing.state] ?? processing.state,
            tone: processing.state === "draft-ready" ? "ok" : processing.state === "failed" ? "err" : processing.state === "analyzing" ? "warn" : "neutral"
          }) : null,
          proposal.data?.status ? h(FeedbackInboxBadge, {
            label: `\u5019\u9009${FEEDBACK_PROPOSAL_LABELS[proposal.data.status] ?? proposal.data.status}`,
            tone: proposal.data.status === "awaiting-confirmation" ? "warn" : proposal.data.status === "converted" ? "ok" : "neutral"
          }) : null,
          item.supplementCount > 0 ? h("span", { style: { fontSize: 11, color: T.text3 } }, `\u8865\u5145 ${item.supplementCount} \u6761`) : null
        ),
        h("div", { style: { fontSize: 12, color: T.text, lineHeight: 1.6, wordBreak: "break-word" } }, item.statementExcerpt ?? "\uFF08\u65E0\u6458\u8981\uFF09"),
        requirementId ? h(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: 5 } },
          h(
            "div",
            { style: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" } },
            h(
              "button",
              {
                type: "button",
                "data-feedback-requirement": requirementId,
                onClick: openLinkedRequirement,
                style: { ...button, alignSelf: "flex-start", padding: "3px 9px", fontSize: 11.5, color: T.brand, background: "rgba(77,107,254,.12)", border: "1px solid rgba(77,107,254,.35)" }
              },
              `${requirementId}\uFF08v${item.requirement?.revision ?? 1}\uFF09`
            ),
            h(
              "button",
              { type: "button", "data-feedback-requirement-ref": item.id, disabled: refState.loading, onClick: loadRequirementRef, style: { ...button, padding: "3px 9px", fontSize: 11.5 } },
              refState.loading ? "\u8BFB\u53D6\u4E2D\u2026" : "\u67E5\u770B\u63A8\u8FDB\u60C5\u51B5"
            )
          ),
          refState.data?.requirement ? h(
            "div",
            {
              "data-feedback-requirement-status": refState.data.requirement.id,
              style: { fontSize: 11.5, color: T.text2, lineHeight: 1.7, background: T.layer2, border: `1px solid ${T.line}`, borderRadius: 7, padding: "6px 9px" }
            },
            h(
              "div",
              { style: { color: T.text } },
              `\u9700\u6C42\u72B6\u6001\uFF1A${refState.data.requirement.status ?? "\u672A\u77E5"} \xB7 \u51B3\u7B56\uFF1A${refState.data.requirement.decision?.label ?? "\u672A\u68C0\u67E5"} \xB7 \u9A8C\u6536\uFF1A${refState.data.requirement.acceptance?.latest?.result ?? "\u672A\u767B\u8BB0"}`
            ),
            h("div", { style: { color: T.text3 } }, refState.data.resolutionHint ?? "\u751F\u6210\u9700\u6C42\u4E0D\u7B49\u4E8E\u539F\u95EE\u9898\u89E3\u51B3\uFF0C\u9700\u8981\u4EBA\u5DE5\u9A8C\u8BC1\u540E\u518D\u6807\u8BB0\u3002")
          ) : null,
          refState.data && !refState.data.found ? h("div", { style: { fontSize: 11, color: T.warn } }, `\u5DF2\u5173\u8054 ${requirementId}\uFF0C\u4F46\u5728\u76EE\u6807\u5DE5\u4F5C\u533A\u6CA1\u6709\u8BFB\u5230\u5B83\uFF08\u53EF\u80FD\u5DF2\u88AB\u79FB\u52A8\u6216\u5220\u9664\uFF09\u3002`) : null,
          refState.error ? h("div", { style: { fontSize: 11, color: T.err } }, `\u8BFB\u53D6\u63A8\u8FDB\u60C5\u51B5\u5931\u8D25\uFF1A${refState.error.message ?? "\u672A\u77E5\u9519\u8BEF"}`) : null
        ) : null,
        item.failureCode ? h("div", { style: { fontSize: 11, color: T.err } }, `\u5931\u8D25\u539F\u56E0\uFF1A${item.failureCode}`) : null,
        h(
          "div",
          { style: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" } },
          h("button", { type: "button", "data-feedback-expand": item.id, "aria-expanded": open ? "true" : "false", onClick: toggle, style: buttonStyle() }, open ? "\u6536\u8D77" : "\u8BE6\u60C5"),
          h("button", { type: "button", "data-feedback-organise": item.id, disabled: busy !== "", onClick: organise, style: buttonStyle("brand") }, busy === "process" ? "\u6574\u7406\u4E2D\u2026" : "\u6574\u7406"),
          proposal.data?.status === "awaiting-confirmation" ? h("button", { type: "button", "data-feedback-confirm-proposal": item.id, disabled: busy !== "", onClick: confirmProposal, style: buttonStyle("brand") }, busy === "proposal-confirm" ? "\u786E\u8BA4\u4E2D\u2026" : "\u786E\u8BA4\u5019\u9009") : null,
          requirementId ? null : convertOpen ? h("button", { type: "button", "data-feedback-convert-cancel": item.id, disabled: busy !== "", onClick: () => setConvertOpen(false), style: buttonStyle() }, "\u53D6\u6D88\u8F6C\u9700\u6C42") : h("button", { type: "button", "data-feedback-convert": item.id, disabled: busy !== "", onClick: () => setConvertOpen(true), style: buttonStyle("brand") }, "\u8F6C\u9700\u6C42"),
          disposition === "open" ? h("button", { type: "button", "data-feedback-defer": item.id, disabled: busy !== "", onClick: () => run("disposition", { disposition: "deferred", reason: "\u6682\u7F13\u5904\u7406" }, "\u5DF2\u6682\u7F13"), style: buttonStyle() }, "\u6682\u7F13") : h("button", { type: "button", "data-feedback-reopen-disposition": item.id, disabled: busy !== "", onClick: () => run("disposition", { disposition: "open", reason: "\u91CD\u65B0\u5904\u7406" }, "\u5DF2\u6062\u590D\u5F85\u5904\u7406"), style: buttonStyle() }, "\u6062\u590D\u5F85\u5904\u7406"),
          h("button", { type: "button", "data-feedback-decline": item.id, disabled: busy !== "", onClick: () => run("disposition", { disposition: "declined", reason: "\u4E0D\u91C7\u7EB3" }, "\u5DF2\u4E0D\u91C7\u7EB3"), style: buttonStyle("err") }, "\u4E0D\u91C7\u7EB3"),
          h("button", { type: "button", "data-feedback-duplicate": item.id, disabled: busy !== "", onClick: () => run("disposition", { disposition: "duplicate", reason: "\u4E0E\u5DF2\u6709\u53CD\u9988\u91CD\u590D" }, "\u5DF2\u6807\u8BB0\u91CD\u590D"), style: buttonStyle() }, "\u6807\u8BB0\u91CD\u590D"),
          h("button", { type: "button", "data-feedback-supplement-toggle": item.id, onClick: () => setSupplementOpen((value) => !value), style: buttonStyle() }, supplementOpen ? "\u6536\u8D77\u8865\u5145" : "\u8865\u5145"),
          resolution === "resolved" ? h("button", { type: "button", "data-feedback-reopen-resolution": item.id, disabled: busy !== "", onClick: () => run("reopen", { note: "\u95EE\u9898\u518D\u6B21\u51FA\u73B0" }, "\u5DF2\u91CD\u5F00\uFF0C\u95EE\u9898\u5C06\u91CD\u65B0\u8DDF\u8FDB"), style: buttonStyle("err") }, "\u91CD\u5F00") : h("button", { type: "button", "data-feedback-resolve": item.id, disabled: busy !== "" || !requirementId, title: requirementId ? "\u9A8C\u8BC1\u539F\u95EE\u9898\u5DF2\u89E3\u51B3" : "\u5148\u628A\u53CD\u9988\u5173\u8054\u5230\u9700\u6C42\uFF0C\u518D\u9A8C\u8BC1\u89E3\u51B3", onClick: () => run("resolve", { note: "\u5DF2\u9A8C\u8BC1\u539F\u95EE\u9898\u89E3\u51B3" }, "\u5DF2\u6807\u8BB0\u89E3\u51B3"), style: buttonStyle("brand") }, "\u9A8C\u8BC1\u89E3\u51B3")
        ),
        convertOpen ? h(
          "div",
          { "data-feedback-convert-panel": item.id, style: { display: "flex", flexDirection: "column", gap: 8, border: `1px solid ${T.line2}`, borderRadius: 8, padding: "9px 11px", background: T.layer } },
          h(
            "div",
            { style: { fontSize: 12, color: T.text2 } },
            "\u8F6C\u5230\u54EA\u4E2A\u4F18\u5148\u7EA7\uFF1F\u786E\u8BA4\u540E\u4F1A\u5728\u63A5\u6536\u5DE5\u4F5C\u533A\u751F\u6210\u4E00\u6761\u5F85\u8BC4\u5BA1\u9700\u6C42\uFF1B\u540C\u4E00\u95EE\u9898\u5DF2\u6709\u9700\u6C42\u65F6\u53EA\u5173\u8054\u3001\u4E0D\u91CD\u590D\u521B\u5EFA\u3002"
          ),
          h(
            "div",
            { style: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" } },
            ...["P0", "P1", "P2"].map(
              (level) => h("button", { type: "button", "data-feedback-convert-priority": level, "aria-pressed": convertPriority === level ? "true" : "false", disabled: busy !== "", onClick: () => setConvertPriority(level), style: { ...buttonStyle(convertPriority === level ? "brand" : void 0), padding: "3px 10px" } }, level)
            ),
            h("button", { type: "button", "data-feedback-convert-confirm": item.id, disabled: busy !== "", onClick: convertToRequirement, style: buttonStyle("brand") }, busy === "generate" ? "\u751F\u6210\u4E2D\u2026" : "\u786E\u8BA4\u8F6C\u9700\u6C42")
          )
        ) : null,
        supplementOpen ? h(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: 6 } },
          h("textarea", {
            value: supplementText,
            "data-feedback-supplement-input": item.id,
            "aria-label": "\u8865\u5145\u8FD9\u6761\u53CD\u9988",
            onChange: (event) => setSupplementText(event.target.value),
            placeholder: "\u8865\u5145\u65B0\u4FE1\u606F\uFF1A\u518D\u6B21\u51FA\u73B0\u7684\u6761\u4EF6\u3001\u5F71\u54CD\u8303\u56F4\u3001\u671F\u671B\u7ED3\u679C\u2026",
            style: { ...input, minHeight: 64, padding: "7px 10px", resize: "vertical", fontFamily: "inherit" }
          }),
          h(
            "div",
            { style: { display: "flex", gap: 6 } },
            h("button", { type: "button", "data-feedback-supplement-submit": item.id, disabled: busy !== "", onClick: submitSupplement, style: buttonStyle("brand") }, busy === "supplement" ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58\u8865\u5145"),
            h("button", { type: "button", onClick: () => setSupplementOpen(false), style: buttonStyle() }, "\u53D6\u6D88")
          )
        ) : null,
        open ? h(
          "div",
          { "data-feedback-detail": item.id, style: { display: "flex", flexDirection: "column", gap: 8, marginTop: 4, paddingTop: 8, borderTop: `1px dashed ${T.line2}` } },
          detail.loading ? h("div", { style: muted }, "\u6B63\u5728\u8BFB\u53D6\u8BE6\u60C5\u2026") : detail.error ? h("div", { role: "alert", style: { fontSize: 12, color: T.err } }, `\u8BE6\u60C5\u8BFB\u53D6\u5931\u8D25\uFF1A${detail.error.message}`) : record ? h(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: T.text2, lineHeight: 1.65 } },
            h("div", { style: { color: T.text } }, record.statement),
            h(
              "div",
              { style: { display: "flex", flexWrap: "wrap", gap: 10, fontSize: 11, color: T.text3 } },
              h("span", null, `\u573A\u666F\uFF1A${record.context?.ui?.page ?? "\u2014"}${record.context?.ui?.stage ? ` / ${record.context.ui.stage}` : ""}`),
              h("span", null, `\u89C2\u5BDF\uFF1A${record.context?.observedAt ? formatLocalStamp(record.context.observedAt) : "\u672A\u8BB0\u5F55"}`),
              h("span", null, `\u63A5\u6536\uFF1A${record.receivedAt ? formatLocalStamp(record.receivedAt) : "\u672A\u8BB0\u5F55"}`),
              h("span", null, `\u5FEB\u7167\uFF1A${record.context?.contextSnapshotId ?? "\u2014"}`),
              h("span", null, `\u4FEE\u8BA2\uFF1Av${record.revision ?? 1}`)
            ),
            record.processing?.state ? h(
              "div",
              { style: { display: "flex", flexWrap: "wrap", gap: 10, fontSize: 11, color: T.text3 } },
              h("span", null, `\u6574\u7406\uFF1A${FEEDBACK_PROCESSING_LABELS[record.processing.state] ?? record.processing.state}`),
              record.processing.proposalId ? h("span", null, `\u5019\u9009\uFF1A${record.processing.proposalId}`) : null,
              record.processing.lastError ? h("span", { style: { color: T.err } }, record.processing.lastError) : null
            ) : null,
            record.context?.evidence?.textExcerpts?.length ? h(
              "div",
              { style: { display: "flex", flexDirection: "column", gap: 2 } },
              record.context.evidence.textExcerpts.slice(0, 3).map(
                (excerpt, index) => h("div", { key: index, style: { fontSize: 11, color: T.text3 } }, `${excerpt.label ?? "\u6458\u5F55"}\uFF1A${excerpt.text ?? ""}`)
              )
            ) : null,
            record.context?.evidence?.attachments?.length ? h(
              "div",
              { style: { display: "flex", flexDirection: "column", gap: 4 }, "data-feedback-attachments": item.id },
              h("div", { style: { fontSize: 11, color: T.text3 } }, `\u9644\u4EF6 ${record.context.evidence.attachments.length} \u4E2A`),
              record.context.evidence.attachments.map(
                (attachment, index) => h(
                  "div",
                  { key: index, style: { display: "flex", gap: 8, alignItems: "center", fontSize: 11.5, color: T.text2 } },
                  h("span", null, `${attachment.name ?? attachment.sha256}\uFF08${Math.max(0, Math.round((attachment.size ?? 0) / 1024))} KB\uFF09`),
                  h("button", { type: "button", "data-feedback-attachment-download": attachment.sha256, onClick: () => downloadAttachment(attachment), style: { ...buttonStyle("ghost"), padding: "2px 8px", fontSize: 11 } }, "\u4E0B\u8F7D")
                )
              )
            ) : null,
            supplements.length > 0 ? h(
              "div",
              { style: { display: "flex", flexDirection: "column", gap: 4 } },
              h("div", { style: { fontSize: 11, color: T.text3 } }, `\u8865\u5145 ${supplements.length} \u6761`),
              supplements.slice(-3).map(
                (supplement, index) => h("div", { key: index, style: { fontSize: 11.5, color: T.text2 } }, `\xB7 ${supplement.statement}`)
              )
            ) : null,
            h(
              "div",
              { style: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" } },
              h("input", {
                value: linkId,
                "data-feedback-link-input": item.id,
                "aria-label": "\u5173\u8054\u9700\u6C42 ID",
                onChange: (event) => setLinkId(event.target.value),
                placeholder: "\u5173\u8054\u9700\u6C42 ID\uFF0C\u4F8B\u5982 REQ-ALM-001",
                style: { ...input, width: 220, padding: "5px 9px", fontSize: 11.5 }
              }),
              h(
                "button",
                { type: "button", "data-feedback-link-submit": item.id, disabled: busy !== "" || !linkId.trim(), onClick: () => run("link", { requirement: { id: linkId.trim(), revision: 1 } }, "\u5DF2\u5173\u8054\u9700\u6C42"), style: buttonStyle("brand") },
                busy === "link" ? "\u5173\u8054\u4E2D\u2026" : "\u5173\u8054\u9700\u6C42"
              )
            )
          ) : h("div", { style: muted }, "\u6CA1\u6709\u8BFB\u5230\u8BE6\u60C5\uFF1B\u53EF\u91CD\u65B0\u6253\u5F00\u3002")
        ) : null,
        actionNote ? h("div", { role: "status", "data-feedback-action-note": item.id, style: { fontSize: 11.5, color: T.ok } }, actionNote) : null,
        actionError ? h(
          "div",
          { role: "alert", "data-feedback-action-error": item.id, style: { fontSize: 11.5, color: T.err } },
          `\u64CD\u4F5C\u672A\u5B8C\u6210\uFF1A${actionError.code ? `[${actionError.code}] ` : ""}${actionError.message ?? ""}`
        ) : null
      );
    }
    function FeedbackInbox({ root, onOpenRequirement, refreshToken }) {
      const [filter, setFilter] = useState("all");
      const [state, setState] = useState({ loading: true, error: null, data: null });
      const [reloadKey, setReloadKey] = useState(0);
      useEffect(() => {
        let alive = true;
        setState((prev) => ({ ...prev, loading: true, error: null }));
        feedbackGet("inbox", root, feedbackInboxFilterQuery(filter)).then((payload) => {
          if (alive) setState({ loading: false, error: null, data: payload });
        }).catch((error) => {
          if (alive) setState({ loading: false, error, data: null });
        });
        return () => {
          alive = false;
        };
      }, [root, refreshToken, reloadKey, filter]);
      const data = state.data;
      const items = Array.isArray(data?.items) ? data.items : [];
      const counts = feedbackCountsOf(data);
      const onChanged = () => setReloadKey((value) => value + 1);
      return h(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: 10 } },
        h("div", { role: "status", "data-feedback-inbox-counts": "true", style: { fontSize: 12, color: T.text2 } }, `\u5F85\u5904\u7406 ${counts.pending} \xB7 \u5DF2\u8F6C\u9700\u6C42 ${counts.requirementCreated} \xB7 \u5171 ${data?.total ?? items.length} \u6761`),
        h(
          "div",
          { style: { display: "flex", gap: 6, flexWrap: "wrap" } },
          FEEDBACK_INBOX_FILTERS.map(
            ([id, label]) => h(
              "button",
              {
                key: id,
                type: "button",
                "data-feedback-inbox-filter": id,
                "aria-pressed": filter === id ? "true" : "false",
                onClick: () => setFilter(id),
                style: feedbackChipStyle(filter === id)
              },
              label
            )
          )
        ),
        state.loading && !data ? h("div", { style: muted }, "\u6B63\u5728\u8BFB\u53D6\u6536\u4EF6\u7BB1\u2026") : state.error ? h(
          "div",
          { role: "alert", style: { fontSize: 12, color: T.err, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } },
          `\u6536\u4EF6\u7BB1\u8BFB\u53D6\u5931\u8D25\uFF1A${state.error.message}`,
          h("button", { type: "button", onClick: () => setReloadKey((value) => value + 1), style: { ...button, padding: "3px 9px", fontSize: 11.5 } }, "\u91CD\u8BD5")
        ) : items.length === 0 ? h("div", { style: { ...muted, lineHeight: 1.7, padding: "18px 0" } }, filter === "all" ? "\u8FD8\u6CA1\u6709\u53CD\u9988\u3002" : "\u5F53\u524D\u7B5B\u9009\u4E0B\u6CA1\u6709\u53CD\u9988\u3002") : h(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: 8 } },
          items.map((item) => h(FeedbackInboxRow, { key: item.id, item, root, onOpenRequirement, onChanged }))
        )
      );
    }
    function normalizeFeedbackSettings(payload, fallbackWorkspaces) {
      const settings = payload?.settings ?? {};
      const destination = settings.destinationWorkspace ?? settings.destination ?? null;
      const stages = Array.isArray(settings?.coverage?.stages) ? settings.coverage.stages : FEEDBACK_COVERAGE_STAGES.map(([id]) => id);
      return {
        enabled: settings.enabled === true,
        destinationWorkspaceId: feedbackWorkspaceValue(destination),
        stages: stages.filter((stage) => FEEDBACK_COVERAGE_STAGES.some(([id]) => id === stage)),
        includeAttachments: settings?.capture?.includeAttachments === true,
        retentionDays: Number.isFinite(settings?.capture?.retentionDays) ? settings.capture.retentionDays : 90,
        maxRecords: Number.isFinite(settings?.capture?.maxRecords) ? settings.capture.maxRecords : 500,
        workspaces: Array.isArray(payload?.workspaces) ? payload.workspaces : Array.isArray(fallbackWorkspaces) ? fallbackWorkspaces : []
      };
    }
    function FeedbackSettingsPanel({ root, onBack }) {
      const [state, setState] = useState({ loading: true, error: null, value: null, saving: false, savedAt: 0, saveError: null });
      const [reloadKey, setReloadKey] = useState(0);
      useEffect(() => {
        let alive = true;
        setState((prev) => ({ ...prev, loading: true, error: null }));
        feedbackGet("settings", root).then((payload) => {
          if (!alive) return;
          setState({ loading: false, error: null, value: normalizeFeedbackSettings(payload), saving: false, savedAt: 0, saveError: null });
        }).catch((error) => {
          if (alive) setState({ loading: false, error, value: null, saving: false, savedAt: 0, saveError: null });
        });
        return () => {
          alive = false;
        };
      }, [root, reloadKey]);
      const updateValue = (patch) => {
        setState((prev) => prev.value ? { ...prev, value: { ...prev.value, ...patch }, savedAt: 0 } : prev);
      };
      const toggleStage = (stage) => {
        setState((prev) => {
          if (!prev.value) return prev;
          const has = prev.value.stages.includes(stage);
          const stages = has ? prev.value.stages.filter((id) => id !== stage) : [...prev.value.stages, stage];
          return { ...prev, value: { ...prev.value, stages }, savedAt: 0 };
        });
      };
      const save = () => {
        const value2 = state.value;
        if (!value2 || state.saving) return;
        setState((prev) => ({ ...prev, saving: true, saveError: null }));
        feedbackPost(
          "settings",
          {
            destinationWorkspaceId: value2.destinationWorkspaceId || null,
            coverage: { stages: value2.stages },
            capture: {
              includeAttachments: value2.includeAttachments,
              retentionDays: value2.retentionDays,
              maxRecords: value2.maxRecords
            }
          },
          root
        ).then((payload) => {
          setState((prev) => ({
            loading: false,
            error: null,
            value: normalizeFeedbackSettings(payload, prev.value?.workspaces),
            saving: false,
            savedAt: Date.now(),
            saveError: null
          }));
        }).catch((error) => {
          setState((prev) => ({ ...prev, saving: false, saveError: error }));
        });
      };
      const value = state.value;
      return h(
        "div",
        { "data-feedback-settings": "true", style: { display: "flex", flexDirection: "column", gap: 14 } },
        h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: 8 } },
          h("button", { type: "button", "data-feedback-settings-back": "true", onClick: onBack, style: { ...button, padding: "4px 9px", fontSize: 11.5 } }, "\u8FD4\u56DE"),
          h("div", { style: { fontSize: 12.5, fontWeight: 600, color: T.text } }, "\u53CD\u9988\u53D1\u9001\u8BBE\u7F6E")
        ),
        state.loading ? h("div", { style: muted }, "\u6B63\u5728\u8BFB\u53D6\u8BBE\u7F6E\u2026") : state.error ? h(
          "div",
          { role: "alert", style: { fontSize: 12, color: T.err, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } },
          `\u8BFB\u53D6\u8BBE\u7F6E\u5931\u8D25\uFF1A${state.error.message}`,
          h("button", { type: "button", onClick: () => setReloadKey((prev) => prev + 1), style: { ...button, padding: "3px 9px", fontSize: 11.5 } }, "\u91CD\u8BD5")
        ) : !value ? null : h(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: 14 } },
          h(
            "div",
            { style: { display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", border: `1px solid ${T.line}`, borderRadius: 9, background: T.layer } },
            h("input", { type: "checkbox", checked: false, disabled: true, "data-feedback-auto-review": "true" }),
            h(
              "div",
              { style: { display: "flex", flexDirection: "column", gap: 2 } },
              h("div", { style: { fontSize: 12, color: T.text3 } }, "\u542F\u7528\u81EA\u52A8\u8FC7\u7A0B\u590D\u76D8"),
              h("div", { style: { fontSize: 11, color: T.text3 } }, "\u81EA\u52A8\u8FC7\u7A0B\u590D\u76D8\u5C06\u5728\u540E\u7EED\u7248\u672C\u63D0\u4F9B\u3002")
            )
          ),
          h(
            "label",
            { style: { display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: T.text2 } },
            "\u63A5\u6536\u5DE5\u4F5C\u533A\uFF08\u751F\u6210\u9700\u6C42\u7684\u76EE\u6807\uFF09",
            h(
              "select",
              {
                "data-feedback-destination": "true",
                value: value.destinationWorkspaceId ?? "",
                onChange: (event) => updateValue({ destinationWorkspaceId: event.target.value || null }),
                style: { ...input, minWidth: 0, padding: "6px 9px" }
              },
              h("option", { value: "" }, "\u672A\u914D\u7F6E"),
              value.workspaces.map((workspace) => {
                const id = feedbackWorkspaceValue(workspace);
                return h("option", { key: id ?? "unknown", value: id ?? "" }, feedbackWorkspaceLabel(workspace));
              })
            )
          ),
          h(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: 7 } },
            h("div", { style: { fontSize: 12, color: T.text2 } }, "\u8986\u76D6\u9636\u6BB5"),
            h(
              "div",
              { style: { display: "flex", flexWrap: "wrap", gap: 6 } },
              FEEDBACK_COVERAGE_STAGES.map(([id, label]) => {
                const on = value.stages.includes(id);
                return h(
                  "button",
                  {
                    key: id,
                    type: "button",
                    "data-feedback-coverage": id,
                    "aria-pressed": on ? "true" : "false",
                    onClick: () => toggleStage(id),
                    style: feedbackChipStyle(on)
                  },
                  label
                );
              })
            )
          ),
          h(
            "label",
            { style: { display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: T.text2 } },
            "\u4FDD\u7559\u6761\u6570",
            h("input", {
              type: "number",
              min: 1,
              max: 5e3,
              "data-feedback-max-records": "true",
              value: value.maxRecords,
              onChange: (event) => {
                const next = Number.parseInt(event.target.value, 10);
                updateValue({ maxRecords: Number.isFinite(next) ? Math.min(5e3, Math.max(1, next)) : value.maxRecords });
              },
              style: { ...input, minWidth: 120, width: 140 }
            })
          ),
          state.savedAt ? h("div", { role: "status", "data-feedback-settings-saved": "true", style: { fontSize: 12, color: T.ok } }, "\u5DF2\u4FDD\u5B58\u8BBE\u7F6E") : null,
          state.saveError ? h("div", { role: "alert", style: { fontSize: 12, color: T.err } }, `\u4FDD\u5B58\u8BBE\u7F6E\u5931\u8D25\uFF1A${state.saveError.message}`) : null,
          h(
            "div",
            { style: { display: "flex", gap: 8 } },
            h("button", { type: "button", "data-feedback-settings-save": "true", onClick: save, disabled: state.saving, style: primary }, state.saving ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58\u8BBE\u7F6E")
          )
        )
      );
    }
    function FeedbackDrawer({ root, context, returnFocus, onClose, onOpenRequirement }) {
      const draftRef = useRef(null);
      if (!draftRef.current) draftRef.current = feedbackDraftFor(context);
      const draft = draftRef.current;
      const [tab, setTab] = useState("compose");
      const [statement, setStatement] = useState(draft.statement);
      const [category, setCategory] = useState(draft.category);
      const [keep, setKeep] = useState(draft.keep);
      const [restored, setRestored] = useState(Boolean(draft.statement.trim() || draft.savedId));
      const [saved, setSaved] = useState({ id: draft.savedId, statement: draft.savedStatement });
      const [attachments, setAttachments] = useState(Array.isArray(draft.attachments) ? draft.attachments : []);
      const [saveState, setSaveState] = useState({ phase: "idle", id: null, ms: 0, error: null, appended: false });
      const [refreshToken, setRefreshToken] = useState(0);
      const textareaRef = useRef(null);
      const busy = saveState.phase === "saving";
      const [build, setBuild] = useState({ checked: false, serverBuild: null, stale: false, mismatch: false });
      const [targetInfo, setTargetInfo] = useState({ loading: true, workspace: null, destination: null });
      useEffect(() => {
        let live = true;
        feedbackGet("settings", root).then((payload) => {
          if (!live) return;
          const settings = payload?.settings ?? {};
          const destination = settings.destinationWorkspace ?? settings.destination ?? null;
          const value = feedbackWorkspaceValue(destination);
          const list = Array.isArray(payload?.workspaces) ? payload.workspaces : [];
          const workspace = list.find((entry) => feedbackWorkspaceValue(entry) === value) ?? null;
          setTargetInfo({ loading: false, workspace, destination: value });
        }).catch(() => {
          if (live) setTargetInfo({ loading: false, workspace: null, destination: null });
        });
        return () => {
          live = false;
        };
      }, [root]);
      useEffect(() => {
        let live = true;
        feedbackGet("diagnostics", root).then((payload) => {
          if (!live) return;
          const serverBuild = payload?.serverBuild ?? payload?.clientBuild ?? null;
          setBuild({
            checked: true,
            serverBuild,
            stale: false,
            mismatch: Boolean(serverBuild) && serverBuild !== FEEDBACK_CLIENT_BUILD
          });
        }).catch(() => {
          if (!live) return;
          setBuild({ checked: true, serverBuild: null, stale: true, mismatch: false });
        });
        return () => {
          live = false;
        };
      }, [root]);
      const clearReceipt = () => {
        draft.requestId = null;
        draft.supplementRequestId = null;
        setSaveState({ phase: "idle", id: null, ms: 0, error: null, appended: false });
      };
      const changeStatement = (next) => {
        setStatement(next);
        draft.statement = next;
        if (next !== draft.savedStatement) clearReceipt();
      };
      const changeCategory = (next) => {
        setCategory(next);
        if (next === draft.category) return;
        draft.category = next;
        clearReceipt();
      };
      const toggleKeep = (id) => {
        setKeep((prev) => {
          const next = { ...prev, [id]: prev[id] === false };
          draft.keep = next;
          clearReceipt();
          return next;
        });
      };
      const readAttachmentFile = (file) => new Promise((resolveRead, rejectRead) => {
        if (!FEEDBACK_ATTACHMENT_TYPES.includes(file.type)) {
          rejectRead(Object.assign(new Error("\u4E0D\u652F\u6301\u7684\u9644\u4EF6\u7C7B\u578B"), { code: "attachment-type" }));
          return;
        }
        if (file.size > FEEDBACK_ATTACHMENT_MAX_BYTES) {
          rejectRead(Object.assign(new Error("\u9644\u4EF6\u8D85\u8FC7 2 MB"), { code: "attachment-too-large" }));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = String(reader.result ?? "");
          const dataBase64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
          resolveRead({
            id: `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
            name: file.name || "attachment",
            type: file.type,
            size: file.size,
            dataBase64
          });
        };
        reader.onerror = () => rejectRead(Object.assign(new Error("\u9644\u4EF6\u8BFB\u53D6\u5931\u8D25"), { code: "attachment-read" }));
        reader.readAsDataURL(file);
      });
      const addAttachments = (files) => {
        const incoming = Array.from(files ?? []);
        if (incoming.length === 0) return;
        Promise.all(incoming.map((file) => readAttachmentFile(file))).then((entries) => {
          const merged = [...attachments, ...entries].slice(0, 3);
          draft.attachments = merged;
          setAttachments(merged);
          setSaveState({ phase: "idle", id: null, ms: 0, error: null, appended: false });
        }).catch((error) => {
          setSaveState({ phase: "error", id: null, ms: 0, error: { code: error?.code ?? "attachment-invalid", message: error?.message ?? "\u9644\u4EF6\u8BFB\u53D6\u5931\u8D25" } });
        });
      };
      const removeAttachment = (id) => {
        const merged = attachments.filter((entry) => entry.id !== id);
        draft.attachments = merged;
        setAttachments(merged);
      };
      const onComposePaste = (event) => {
        const items = Array.from(event?.clipboardData?.items ?? []);
        const files = items.filter((entry) => entry.kind === "file").map((entry) => entry.getAsFile()).filter(Boolean);
        if (files.length === 0) return;
        event.preventDefault();
        addAttachments(files);
      };
      const kickOffProcessing = (id) => {
        if (!id) return;
        feedbackPost("process", { id }, root).then(() => setRefreshToken((value) => value + 1)).catch(() => {
        });
      };
      const buildContext = () => {
        const ui = { page: context?.page ?? "list" };
        if (keep?.requirement !== false && context?.stage) ui.stage = context.stage;
        if (keep?.requirement !== false && context?.overlay?.kind) {
          const overlay = { kind: context.overlay.kind, label: String(context.overlay.label ?? "").slice(0, 160) };
          if (context.overlay.requirementId) overlay.requirementId = String(context.overlay.requirementId).slice(0, 80);
          ui.viewState = { overlay };
          if (["requirement", "delivery", "record"].includes(context.overlay.tab)) ui.viewState.tab = context.overlay.tab;
        }
        const links = {};
        if (keep?.requirement !== false && context?.requirementId) links.requirementId = context.requirementId;
        if (keep?.run !== false && context?.runId) links.runIds = [context.runId];
        if (keep?.intent !== false && context?.intentSessionId) links.intentSessionId = context.intentSessionId;
        if (keep?.requirement !== false && context?.candidateId) links.candidateId = context.candidateId;
        if (keep?.requirement !== false && context?.requirementRevision != null) links.requirementRevision = context.requirementRevision;
        if (keep?.requirement !== false && context?.requirementFile) {
          links.requirementFile = context.requirementFile;
          links.requirementInstanceKey = context.requirementFile;
        }
        if (keep?.requirement !== false && context?.acceptanceDecisionId) links.acceptanceDecisionId = context.acceptanceDecisionId;
        if (keep?.requirement !== false && Array.isArray(context?.failureIds) && context.failureIds.length > 0) {
          links.failureIds = context.failureIds.slice(0, 20);
        }
        const observedAt = Number.isFinite(context?.frozenAt) ? new Date(context.frozenAt).toISOString() : void 0;
        return {
          ...observedAt ? { observedAt, capturedAt: observedAt } : {},
          ...context?.root ? { observedRoot: context.root } : {},
          capture: { kind: "client-click", client: "dsh-web", clientBuild: FEEDBACK_CLIENT_BUILD, ...observedAt ? { observedAt } : {} },
          // Top-level, not inside ui: the server's UI whitelist is intentionally
          // narrow, while core already turns recentError into a text excerpt.
          ...keep?.error !== false && context?.recentError ? { recentError: context.recentError } : {},
          ui,
          links,
          captureBoundary: { mode: "current-only", coveredStages: [], notCoveredStages: ["\u672A\u8BB0\u5F55\u7684\u5386\u53F2\u64CD\u4F5C"], truncated: false }
        };
      };
      const resetDraft = () => {
        draft.statement = "";
        draft.category = "undetermined";
        draft.requestId = null;
        draft.supplementRequestId = null;
        draft.savedId = null;
        draft.savedStatement = null;
        setStatement("");
        setCategory("undetermined");
        setSaved({ id: null, statement: null });
        setRestored(false);
        setSaveState({ phase: "idle", id: null, ms: 0, error: null, appended: false });
      };
      const saveFeedback = () => {
        const text = statement.trim();
        if (!text) {
          const error = { code: "statement-required", message: FEEDBACK_ERROR_HINTS["statement-required"] };
          setSaveState({ phase: "error", id: null, ms: 0, error });
          return Promise.resolve({ id: null, error });
        }
        if (text.length > FEEDBACK_MAX_STATEMENT) {
          const error = { code: "statement-too-long", message: FEEDBACK_ERROR_HINTS["statement-too-long"] };
          setSaveState({ phase: "error", id: null, ms: 0, error });
          return Promise.resolve({ id: null, error });
        }
        const startedAt = Date.now();
        setSaveState({ phase: "saving", id: null, ms: 0, error: null });
        const appending = Boolean(draft.savedId) && text !== draft.savedStatement;
        if (appending) {
          if (!draft.supplementRequestId) {
            draft.supplementRequestId = `fb-sup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
          }
          return feedbackPost(
            "supplement",
            { id: draft.savedId, statement: text, context: buildContext(), supplementId: draft.supplementRequestId },
            root
          ).then((payload) => {
            const id = payload?.feedback?.id ?? draft.savedId;
            draft.savedId = id;
            draft.savedStatement = text;
            draft.supplementRequestId = null;
            setSaved({ id, statement: text });
            setSaveState({ phase: "done", id, ms: Math.max(0, Date.now() - startedAt), error: null, appended: true });
            setRefreshToken((value) => value + 1);
            kickOffProcessing(id);
            return { id, error: null };
          }).catch((error) => {
            const shown = feedbackErrorView(error);
            setSaveState({ phase: "error", id: null, ms: 0, error: shown });
            return { id: null, error };
          });
        }
        if (!draft.requestId) {
          draft.requestId = `fb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        }
        return feedbackPost(
          "save",
          { statement: text, category, context: buildContext(), clientRequestId: draft.requestId, ...attachments.length > 0 ? { attachments: attachments.map(({ name, type, dataBase64 }) => ({ name, type, dataBase64 })) } : {} },
          root
        ).then((payload) => {
          const id = payload?.feedback?.id ?? payload?.receipt?.feedbackId ?? null;
          draft.savedId = id;
          draft.savedStatement = text;
          draft.attachments = [];
          setAttachments([]);
          setSaved({ id, statement: text });
          setSaveState({ phase: "done", id, ms: Math.max(0, Date.now() - startedAt), error: null, appended: false });
          setRefreshToken((value) => value + 1);
          kickOffProcessing(id);
          return { id, error: null };
        }).catch((error) => {
          const shown = feedbackErrorView(error);
          setSaveState({ phase: "error", id: null, ms: 0, error: shown });
          return { id: null, error: shown };
        });
      };
      useEffect(() => {
        const onKey = (event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          onClose();
        };
        document.addEventListener("keydown", onKey, true);
        return () => document.removeEventListener("keydown", onKey, true);
      }, [onClose]);
      useEffect(() => {
        const onKey = (event) => {
          if (event.key !== "Tab") return;
          const layer = typeof document !== "undefined" ? document.querySelector('[data-feedback-layer="true"]') : null;
          if (!layer) return;
          const focusable = Array.from(layer.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((node) => !node.disabled && node.offsetParent !== null);
          if (focusable.length === 0) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (!layer.contains(document.activeElement)) {
            event.preventDefault();
            (event.shiftKey ? last : first).focus();
          } else if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        };
        document.addEventListener("keydown", onKey, true);
        return () => document.removeEventListener("keydown", onKey, true);
      }, []);
      useEffect(() => {
        const target = textareaRef.current;
        if (target && typeof target.focus === "function") target.focus();
      }, []);
      useEffect(() => {
        const target = returnFocus;
        return () => {
          if (!target || typeof target.focus !== "function") return;
          if (target.isConnected === false) return;
          try {
            target.focus();
          } catch {
          }
        };
      }, [returnFocus]);
      const renderSaveStatus = () => {
        if (saveState.phase === "saving") {
          return h("div", { role: "status", "data-feedback-save": "saving", style: { fontSize: 12, color: T.text2 } }, "\u4FDD\u5B58\u4E2D\u2026");
        }
        if (saveState.phase === "done") {
          return h(
            "div",
            {
              role: "status",
              "data-feedback-save": "done",
              style: { fontSize: 12, color: T.ok, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }
            },
            `${saveState.appended ? "\u5DF2\u8865\u5145\u5230" : "\u5DF2\u4FDD\u5B58"} ${saveState.id}\uFF08${saveState.ms}ms\uFF09`,
            h("button", { type: "button", "data-feedback-view-inbox": "true", onClick: () => setTab("inbox"), style: { ...button, padding: "2px 8px", fontSize: 11 } }, "\u67E5\u770B\u6536\u4EF6\u7BB1")
          );
        }
        if (saveState.phase === "error" && saveState.error) {
          const code = saveState.error.code;
          return h(
            "div",
            { role: "alert", "data-feedback-save": "error", style: { fontSize: 12, color: T.err, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } },
            `\u4FDD\u5B58\u5931\u8D25\uFF1A${code ? `[${code}] ` : ""}${saveState.error.message}`,
            h("button", { type: "button", "data-feedback-retry": "true", onClick: () => {
              saveFeedback();
            }, style: { ...button, padding: "2px 8px", fontSize: 11 } }, "\u91CD\u8BD5")
          );
        }
        return null;
      };
      const composeNode = h(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: 12 } },
        restored ? h(
          "div",
          { "data-feedback-draft-restored": "true", style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 11.5, color: T.text2 } },
          h("span", null, "\u5DF2\u6062\u590D\u8FD9\u6761\u53CD\u9988\u4E0A\u6B21\u672A\u63D0\u4EA4\u7684\u5185\u5BB9\u3002"),
          h(
            "button",
            { type: "button", "data-feedback-draft-reset": "true", onClick: resetDraft, style: { ...button, padding: "2px 8px", fontSize: 11 } },
            "\u6E05\u7A7A\uFF0C\u5199\u65B0\u7684"
          )
        ) : null,
        h(
          "div",
          { "data-feedback-target": "true", style: { display: "flex", flexWrap: "wrap", gap: 6, fontSize: 11.5, color: T.text3 } },
          h("span", null, "\u6539\u8FDB\u5BF9\u8C61\uFF1A\u9700\u6C42\u63D2\u4EF6\uFF08DSH \u9700\u6C42\uFF09"),
          h("span", null, "\xB7"),
          h(
            "span",
            { "data-feedback-destination": "true" },
            targetInfo.loading ? "\u63A5\u6536\u5DE5\u4F5C\u533A\uFF1A\u8BFB\u53D6\u4E2D\u2026" : targetInfo.workspace ? `\u63A5\u6536\u5DE5\u4F5C\u533A\uFF1A${targetInfo.workspace.title ?? targetInfo.workspace.name ?? targetInfo.destination}` : "\u63A5\u6536\u5DE5\u4F5C\u533A\uFF1A\u672A\u914D\u7F6E\uFF08\u8F6C\u9700\u6C42\u524D\u9700\u5728\u8BBE\u7F6E\u91CC\u9009\u62E9\uFF09"
          )
        ),
        h(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: 6 } },
          h("div", { style: { fontSize: 12, color: T.text2 } }, "\u54EA\u91CC\u4E0D\u987A\uFF0C\u6216\u5E0C\u671B\u600E\u6837\u6539\u53D8\uFF08\u5FC5\u586B\uFF09"),
          h("textarea", {
            ref: textareaRef,
            "data-feedback-statement": "true",
            "aria-label": "\u54EA\u91CC\u4E0D\u987A\uFF0C\u6216\u5E0C\u671B\u600E\u6837\u6539\u53D8",
            value: statement,
            maxLength: FEEDBACK_MAX_STATEMENT,
            onChange: (event) => changeStatement(event.target.value),
            onPaste: onComposePaste,
            placeholder: "\u4F8B\u5982\uFF1A\u6309\u6765\u6E90\u7B5B\u9009\u540E\u5217\u8868\u6CA1\u6709\u8BF4\u660E\uFF0C\u6211\u770B\u4E0D\u51FA\u7B5B\u9009\u662F\u5426\u751F\u6548\u3002",
            style: { ...input, minHeight: 132, minWidth: 0, padding: "9px 11px", resize: "vertical", lineHeight: 1.6, fontFamily: "inherit" }
          }),
          h(
            "div",
            { style: { display: "flex", justifyContent: "space-between", fontSize: 11, color: T.text3 } },
            h("span", null, "\u8D8A\u5177\u4F53\u8D8A\u5BB9\u6613\u88AB\u8F6C\u6210\u9700\u6C42"),
            h("span", { "data-feedback-counter": "true" }, `${statement.length}/${FEEDBACK_MAX_STATEMENT}`)
          )
        ),
        h(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: 6 } },
          h("div", { style: { fontSize: 12, color: T.text2 } }, "\u7C7B\u522B"),
          h(
            "div",
            { style: { display: "flex", flexWrap: "wrap", gap: 6 } },
            FEEDBACK_CATEGORIES.map(([id, label]) => {
              const on = category === id;
              return h(
                "button",
                { key: id, type: "button", "data-feedback-category": id, "aria-pressed": on ? "true" : "false", onClick: () => changeCategory(id), style: feedbackChipStyle(on) },
                label
              );
            })
          )
        ),
        h(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: 6 } },
          h(
            "div",
            { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12, color: T.text2 } },
            h(
              "label",
              { role: "button", tabIndex: 0, onKeyDown: (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.currentTarget.querySelector("input").click();
                }
              }, style: { ...button, display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", fontSize: 11.5, cursor: "pointer" } },
              "\uFF0B \u9644\u4EF6",
              h("input", { type: "file", multiple: true, accept: FEEDBACK_ATTACHMENT_TYPES.join(","), style: { display: "none" }, onChange: (event) => {
                addAttachments(event.target.files);
                event.target.value = "";
              } })
            ),
            h("span", { style: { fontSize: 11, color: T.text3 } }, "\u622A\u56FE\u6216\u65E5\u5FD7\uFF0C\u6700\u591A 3 \u4E2A\uFF1B\u4E5F\u53EF\u4EE5\u76F4\u63A5\u7C98\u8D34\u622A\u56FE")
          ),
          attachments.length > 0 ? h(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: 4 } },
            ...attachments.map(
              (entry) => h(
                "div",
                { key: entry.id, "data-feedback-attachment": entry.name, style: { display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: T.text2, background: T.layer2, border: `1px solid ${T.line}`, borderRadius: 6, padding: "4px 8px" } },
                h("span", { style: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, `${entry.name} \xB7 ${Math.round(entry.size / 1024)} KB`),
                h("button", { type: "button", "data-feedback-attachment-remove": entry.id, "aria-label": `\u79FB\u9664\u9644\u4EF6\uFF1A${entry.name}`, onClick: () => removeAttachment(entry.id), style: { ...button, padding: "1px 6px", fontSize: 11 } }, "\xD7")
              )
            )
          ) : null
        ),
        h(FeedbackContextSummary, { context, keep, onToggle: toggleKeep }),
        renderSaveStatus()
      );
      const headerNode = h(
        "div",
        { style: { display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: `1px solid ${T.line}` } },
        h(ActionIcon, { name: "message", size: 16 }),
        h(
          "div",
          { style: { flex: 1, minWidth: 0 } },
          h("div", { style: { fontSize: 13.5, fontWeight: 600, color: T.text } }, "\u53CD\u9988\u4E0E\u5EFA\u8BAE"),
          h("div", { style: { fontSize: 11.5, color: T.text3, marginTop: 2 } }, "\u8BB0\u5F55\u4E0D\u987A\uFF0C\u8F6C\u6210\u9700\u6C42\uFF1B\u4E0D\u4F1A\u81EA\u52A8\u5F00\u53D1\u3002")
        ),
        h(
          "button",
          { type: "button", "data-feedback-close": "true", "aria-label": "\u5173\u95ED\u53CD\u9988\u9762\u677F", onClick: onClose, style: { ...button, padding: "5px 9px", fontSize: 12 } },
          h(ActionIcon, { name: "close", size: 13 })
        )
      );
      const buildText = !build.checked ? "\u6B63\u5728\u6838\u5BF9\u5BA2\u6237\u7AEF\u4E0E\u670D\u52A1\u7AEF\u6784\u5EFA\u2026" : build.stale ? "\u670D\u52A1\u7AEF\u8FD8\u6CA1\u6709\u52A0\u8F7D\u53CD\u9988 v2 \u63A5\u53E3\uFF08\u5E94\u7528\u672A\u91CD\u542F\uFF09\uFF1A\u65B0\u5B57\u6BB5\u4E0E\u65B0\u5165\u53E3\u5728\u91CD\u542F\u540E\u751F\u6548\u3002" : build.mismatch ? `\u5BA2\u6237\u7AEF ${FEEDBACK_CLIENT_BUILD} \u4E0E\u670D\u52A1\u7AEF ${build.serverBuild} \u4E0D\u4E00\u81F4\uFF1B\u8BF7\u91CD\u542F\u5E94\u7528\uFF0C\u907F\u514D\u6309\u65E7\u884C\u4E3A\u5224\u65AD\u3002` : `\u6784\u5EFA ${FEEDBACK_CLIENT_BUILD}`;
      const bannerNode = h(
        "div",
        {
          "data-feedback-context": "true",
          role: "status",
          style: { padding: "8px 18px", borderBottom: `1px solid ${T.line}`, background: T.layer, fontSize: 11.5, color: T.text2, lineHeight: 1.5 }
        },
        `\u5DF2\u56FA\u5B9A\u5F53\u524D\u4E0A\u4E0B\u6587 \xB7 ${FEEDBACK_PAGE_LABELS[context?.page] ?? "\u5F53\u524D\u9875\u9762"}${context?.stage ? ` \xB7 ${DEFECT_STAGE_LABELS[context.stage] ?? context.stage}` : ""}${context?.requirementId ? ` \xB7 ${context.requirementId}` : ""}`,
        h(
          "div",
          {
            "data-feedback-build": build.stale ? "stale-server" : build.mismatch ? "mismatch" : build.checked ? "ok" : "checking",
            style: { marginTop: 3, fontSize: 11, color: build.stale || build.mismatch ? T.warn : T.text3 }
          },
          buildText
        )
      );
      const tabsRow = h(
        "div",
        { role: "tablist", "aria-label": "\u53CD\u9988\u89C6\u56FE", onKeyDown: (event) => {
          const ids = ["compose", "inbox", "settings"];
          const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
          if (!step && event.key !== "Home" && event.key !== "End") return;
          event.preventDefault();
          const next = event.key === "Home" ? 0 : event.key === "End" ? 2 : (ids.indexOf(tab) + step + 3) % 3;
          setTab(ids[next]);
          event.currentTarget.querySelectorAll('[role="tab"]')[next]?.focus();
        }, style: { display: "flex", gap: 6, padding: "12px 18px 0" } },
        [
          ["compose", "\u5199\u53CD\u9988"],
          ["inbox", "\u6536\u4EF6\u7BB1"],
          ["settings", "\u8BBE\u7F6E"]
        ].map(([id, label]) => {
          const on = tab === id;
          return h(
            "button",
            {
              key: id,
              type: "button",
              role: "tab",
              "aria-selected": on ? "true" : "false",
              "data-feedback-tab": id,
              id: `feedback-tab-${id}`,
              "aria-controls": "feedback-tab-panel",
              tabIndex: on ? 0 : -1,
              onClick: () => setTab(id),
              style: {
                ...button,
                border: `1px solid ${on ? "rgba(77,107,254,.5)" : T.line}`,
                background: on ? "rgba(77,107,254,.12)" : "transparent",
                color: on ? T.text : T.text2,
                padding: "5px 12px",
                fontSize: 12
              }
            },
            label
          );
        })
      );
      const body = tab === "inbox" ? h(FeedbackInbox, { root, onOpenRequirement, refreshToken }) : tab === "settings" ? h(FeedbackSettingsPanel, { root, onBack: () => setTab("compose") }) : composeNode;
      const footer = tab !== "compose" ? null : h(
        "div",
        { style: { display: "flex", alignItems: "center", gap: 8, padding: "12px 18px", borderTop: `1px solid ${T.line}`, background: T.layer, flexWrap: "wrap" } },
        h(
          "button",
          {
            type: "button",
            "data-feedback-save-button": "true",
            disabled: busy || !statement.trim(),
            onClick: () => {
              saveFeedback();
            },
            style: { ...button, padding: "7px 14px", fontSize: 12 }
          },
          saved.id && statement.trim() !== (saved.statement ?? "") ? "\u63D0\u4EA4\u8865\u5145" : "\u63D0\u4EA4\u53CD\u9988"
        ),
        h(
          "button",
          { type: "button", "data-feedback-dismiss": "true", onClick: onClose, style: { ...button, padding: "7px 14px", fontSize: 12, marginLeft: "auto" } },
          "\u5173\u95ED"
        )
      );
      return h(
        "div",
        { "data-feedback-layer": "true", style: { position: "fixed", inset: 0, zIndex: 65 } },
        h(
          "style",
          null,
          "@keyframes feedback-drawer-in { from { opacity: 0; transform: translateX(18px) } to { opacity: 1; transform: none } } @media (prefers-reduced-motion: reduce) { [data-feedback-panel] { animation: none !important } }"
        ),
        h("div", { onClick: onClose, "aria-hidden": "true", style: { position: "absolute", inset: 0, background: "rgba(4,6,9,.45)" } }),
        h(
          "aside",
          {
            role: "dialog",
            "aria-modal": "false",
            "aria-label": "\u53CD\u9988\u4E0E\u5EFA\u8BAE",
            "data-feedback-panel": "true",
            style: {
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              width: 480,
              maxWidth: "96vw",
              background: T.base,
              borderLeft: `1px solid ${T.line2}`,
              boxShadow: "-24px 0 60px rgba(0,0,0,.45)",
              display: "flex",
              flexDirection: "column",
              animation: REDUCE_MOTION ? "none" : "feedback-drawer-in 160ms ease-out"
            }
          },
          headerNode,
          bannerNode,
          tabsRow,
          h("div", { role: "tabpanel", id: "feedback-tab-panel", "aria-labelledby": `feedback-tab-${tab}`, style: { flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 18px 16px" } }, body),
          footer
        )
      );
    }
    const MONITORING_STAGE_OPTIONS = ["clarify", "review", "develop", "test", "handoff"];
    function MonitoringPanel({ root, onClose }) {
      const [state, setState] = useState({ loading: true, error: null, value: null, saving: false, savedAt: null, saveError: null });
      useEffect(() => {
        let live = true;
        writeJson("defect", { mode: "settings" }, root).then((payload) => {
          if (!live) return;
          const value2 = payload?.monitoring ?? payload?.settings ?? (payload && payload.enabled !== void 0 ? payload : null);
          if (!value2) {
            setState({ loading: false, error: "\u540E\u7AEF\u6CA1\u6709\u8FD4\u56DE\u76D1\u63A7\u8BBE\u7F6E\uFF08\u63A5\u53E3\u53EF\u80FD\u8FD8\u6CA1\u5C31\u7EEA\uFF09\u3002", value: null, saving: false, savedAt: null, saveError: null });
            return;
          }
          const stages = Array.isArray(value2.stages) ? value2.stages.filter((stage) => MONITORING_STAGE_OPTIONS.includes(stage)) : MONITORING_STAGE_OPTIONS;
          setState({ loading: false, error: null, value: { enabled: value2.enabled !== false, stages, notify: value2.notify !== false }, saving: false, savedAt: null, saveError: null });
        }).catch((error) => {
          if (!live) return;
          setState({ loading: false, error: error.message, value: null, saving: false, savedAt: null, saveError: null });
        });
        return () => {
          live = false;
        };
      }, [root]);
      const value = state.value;
      const patch = (next) => setState((current) => ({ ...current, value: { ...current.value, ...next }, savedAt: null }));
      const toggleStage = (stage) => {
        if (!value) return;
        const stages = value.stages.includes(stage) ? value.stages.filter((entry) => entry !== stage) : [...value.stages, stage];
        patch({ stages });
      };
      const save = () => {
        if (!value || state.saving) return;
        setState((current) => ({ ...current, saving: true, saveError: null }));
        writeJson("defect", { mode: "settings", settings: { enabled: value.enabled, stages: value.stages, notify: value.notify } }, root).then((payload) => {
          const next = payload?.monitoring ?? payload?.settings ?? (payload && payload.enabled !== void 0 ? payload : null);
          setState((current) => ({
            ...current,
            saving: false,
            saveError: null,
            savedAt: Date.now(),
            value: next ? { enabled: next.enabled !== false, stages: Array.isArray(next.stages) ? next.stages : current.value.stages, notify: next.notify !== false } : current.value
          }));
        }).catch((error) => setState((current) => ({ ...current, saving: false, saveError: error.message })));
      };
      const stageChips = value ? MONITORING_STAGE_OPTIONS.map((stage) => {
        const on = value.stages.includes(stage);
        return h(
          "button",
          {
            key: stage,
            type: "button",
            "aria-pressed": on,
            onClick: () => toggleStage(stage),
            style: {
              border: `1px solid ${on ? "rgba(77,107,254,.5)" : T.line}`,
              background: on ? "rgba(77,107,254,.12)" : "transparent",
              color: on ? T.text : T.text2,
              borderRadius: "999px",
              padding: "4px 11px",
              fontSize: "11.5px",
              cursor: "pointer"
            }
          },
          `${on ? "\u2713 " : ""}${DEFECT_STAGE_LABELS[stage] ?? stage}`
        );
      }) : [];
      return h(
        ModalShell,
        {
          title: "\u5931\u8D25\u76D1\u63A7\u8BBE\u7F6E",
          lead: "\u76D1\u63A7\u5728\u6BCF\u6B21\u95E8\u7981\u5931\u8D25\u540E\u843D\u4E00\u6761\u5931\u8D25\u4E8B\u4EF6\uFF1B\u53EF\u590D\u73B0\u7684\u5931\u8D25\u4F1A\u81EA\u52A8\u5EFA\u6210\u7F3A\u9677\u9700\u6C42\uFF0C\u7B49\u4F60\u786E\u8BA4\u3002",
          onClose,
          width: "680px",
          footer: [
            h(ActionButton, { key: "close", label: "\u5173\u95ED", variant: "ghost", onClick: onClose }),
            h(ActionButton, { key: "save", label: state.saving ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58\u8BBE\u7F6E", icon: "check", variant: "primary", disabled: state.saving || !value, onClick: save })
          ]
        },
        state.loading ? h("p", { style: { margin: "16px 0 0", ...DETAIL_SUB } }, "\u6B63\u5728\u8BFB\u53D6\u76D1\u63A7\u8BBE\u7F6E\u2026") : null,
        state.error ? h("div", { style: { marginTop: "14px", border: `1px solid ${T.err}`, borderRadius: "10px", padding: "10px 12px" } }, h("p", { style: { margin: 0, color: T.err, fontSize: "12.5px", lineHeight: 1.7 } }, `\u8BFB\u53D6\u76D1\u63A7\u8BBE\u7F6E\u5931\u8D25\uFF1A${state.error}`)) : null,
        value ? h(
          "div",
          { style: { marginTop: "16px" } },
          h(
            "div",
            {
              style: {
                display: "flex",
                alignItems: "center",
                gap: "8px",
                border: `1px solid ${value.enabled ? "rgba(53,196,122,.35)" : "rgba(231,176,75,.35)"}`,
                background: value.enabled ? "rgba(53,196,122,.1)" : "rgba(231,176,75,.1)",
                borderRadius: "10px",
                padding: "9px 12px"
              }
            },
            h("span", { style: { width: "7px", height: "7px", borderRadius: "50%", background: value.enabled ? T.ok : T.warn } }),
            h("span", { style: { fontSize: "12.5px", color: T.text } }, value.enabled ? "\u76D1\u63A7\u6B63\u5E38\u8FD0\u884C" : "\u76D1\u63A7\u5DF2\u6682\u505C\uFF08\u5386\u53F2\u8BB0\u5F55\u4FDD\u7559\uFF09"),
            h("span", { style: { marginLeft: "auto", display: "inline-flex" } }, h(ActionButton, {
              label: value.enabled ? "\u6682\u505C\u76D1\u63A7" : "\u6062\u590D\u76D1\u63A7",
              icon: value.enabled ? "close" : "play",
              variant: "secondary",
              onClick: () => patch({ enabled: !value.enabled })
            }))
          ),
          h(
            "div",
            { style: { marginTop: "14px" } },
            h("div", { style: { fontSize: "11px", letterSpacing: ".06em", textTransform: "uppercase", color: T.text3, marginBottom: "7px" } }, "\u76D1\u63A7\u9636\u6BB5"),
            h("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap" } }, stageChips)
          ),
          h(
            "div",
            { style: { marginTop: "14px", display: "flex", alignItems: "center", gap: "8px" } },
            h("input", {
              type: "checkbox",
              checked: value.notify,
              onChange: (event) => patch({ notify: event.target.checked }),
              "aria-label": "\u53D1\u73B0\u7F3A\u9677\u65F6\u901A\u77E5\u6211"
            }),
            h("span", { style: { fontSize: "12.5px", color: T.text2 } }, "\u53D1\u73B0\u65B0\u7F3A\u9677\u65F6\u901A\u77E5\u6211")
          ),
          state.saveError ? h("p", { style: { margin: "12px 0 0", color: T.err, fontSize: "12.5px" } }, `\u4FDD\u5B58\u5931\u8D25\uFF1A${state.saveError}`) : null,
          state.savedAt ? h("p", { style: { margin: "12px 0 0", color: T.ok, fontSize: "12px" } }, "\u5DF2\u4FDD\u5B58\u3002") : null
        ) : null
      );
    }
    function DefectToast({ toast, onOpen, onClose }) {
      const closeRef = useRef(onClose);
      closeRef.current = onClose;
      useEffect(() => {
        const timer = setTimeout(() => closeRef.current?.(), 9e3);
        return () => clearTimeout(timer);
      }, [toast]);
      const record = defectRecord(toast?.defect) ?? toast?.defect ?? null;
      if (!record) return null;
      const count = Number(toast?.count ?? 1);
      return h(
        "div",
        {
          role: "status",
          "aria-live": "polite",
          style: {
            position: "fixed",
            right: "18px",
            bottom: "18px",
            zIndex: 70,
            width: "320px",
            maxWidth: "calc(100vw - 36px)",
            background: T.layer2,
            border: "1px solid rgba(231,176,75,.4)",
            borderRadius: "12px",
            padding: "12px 14px",
            boxShadow: "0 16px 44px rgba(0,0,0,.45)"
          }
        },
        h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "7px" } },
          h(ActionIcon, { name: "alert", size: 13 }),
          h("span", { style: { fontSize: "12.5px", fontWeight: 600, color: T.text } }, `\u53D1\u73B0\u65B0\u7F3A\u9677\u9700\u6C42 ${record.id ?? ""}`.trim()),
          h("button", {
            type: "button",
            onClick: onClose,
            "aria-label": "\u5173\u95ED\u901A\u77E5",
            style: { marginLeft: "auto", border: 0, background: "transparent", color: T.text3, cursor: "pointer", fontSize: "14px", lineHeight: 1, padding: 0 }
          }, "\xD7")
        ),
        h("div", { style: { marginTop: "5px", fontSize: "11.5px", color: T.text2, lineHeight: 1.6 } }, record.title ?? "\uFF08\u65E0\u6807\u9898\uFF09"),
        h(
          "div",
          { style: { marginTop: "9px", display: "flex", alignItems: "center", gap: "10px" } },
          count > 1 ? h("span", { style: { fontSize: "11px", color: T.text3 } }, `\u5171 ${count} \u4E2A\u65B0\u7F3A\u9677`) : null,
          h("span", { style: { marginLeft: "auto", display: "inline-flex" } }, h(ActionButton, { label: "\u67E5\u770B", icon: "eye", variant: "accent", onClick: () => onOpen?.(record) }))
        )
      );
    }
    function readV4Navigation() {
      try {
        const value = JSON.parse(sessionStorage.getItem("alm.requirements.navigation.v4") ?? "{}");
        return value?.viewVersion === NAVIGATION_VERSION ? value : { ...value, filter: void 0 };
      } catch {
        return {};
      }
    }
    async function saveExchangeFile(format, request, { suggestedName } = {}) {
      const mime = format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/json";
      let handle;
      if (typeof window.showSaveFilePicker === "function") {
        try {
          handle = await window.showSaveFilePicker({
            suggestedName: suggestedName ?? `requirements.${format}`,
            types: [{ description: format === "xlsx" ? "Excel workbook" : "JSON", accept: { [mime]: [`.${format}`] } }]
          });
        } catch (error) {
          if (error.name === "AbortError") return { message: "\u5DF2\u53D6\u6D88\u4FDD\u5B58\uFF0C\u672A\u4E0B\u8F7D\u6587\u4EF6\u3002" };
          throw error;
        }
      }
      const file = await request({ action: "export", format });
      const bytes = Uint8Array.from(atob(file.content), (c) => c.charCodeAt(0));
      if (!Number.isSafeInteger(file.bytes) || bytes.byteLength !== file.bytes || file.mime !== mime) throw new Error("\u5BFC\u51FA\u6587\u4EF6\u5B57\u8282\u6570\u6216\u7C7B\u578B\u4E0D\u5339\u914D\uFF0C\u672A\u4FDD\u5B58");
      const blob = new Blob([bytes], { type: mime });
      if (handle) {
        const writable = await handle.createWritable();
        try {
          await writable.write(blob);
          await writable.close();
        } catch (error) {
          try {
            await writable.abort();
          } catch {
          }
          throw error;
        }
        return { message: `\u5DF2\u4FDD\u5B58 ${handle.name}\uFF08${file.bytes} bytes\uFF09\u3002` };
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const cleanup = () => {
        link.remove();
        URL.revokeObjectURL(url);
      };
      try {
        link.href = url;
        link.download = file.filename;
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
      } catch (error) {
        cleanup();
        throw error;
      }
      setTimeout(cleanup, 6e4);
      return { message: `\u5DF2\u53D1\u8D77\u4E0B\u8F7D ${file.filename}\uFF08${file.bytes} bytes\uFF09\uFF0C\u8BF7\u68C0\u67E5\u6D4F\u89C8\u5668\u4E0B\u8F7D\u8BB0\u5F55\uFF1B\u5C1A\u672A\u786E\u8BA4\u843D\u76D8\u3002` };
    }
    const EXCHANGE_CLIENT_BUILD = "v3.2026-11-14";
    const EXCHANGE_FIELD_LABELS = { title: "\u6807\u9898", brief: "\u9700\u6C42\u63CF\u8FF0", priority: "\u4F18\u5148\u7EA7", owner: "\u8D1F\u8D23\u4EBA" };
    const EXCHANGE_FIELD_TEXT = (fields) => (fields ?? []).map((field) => EXCHANGE_FIELD_LABELS[field] ?? field).join("\u3001");
    function exchangePreviewSummary(preview) {
      const changes = Array.isArray(preview?.changes) ? preview.changes : [];
      const conflicts = Array.isArray(preview?.conflicts) ? preview.conflicts : [];
      const creates = changes.filter((change) => change?.operation === "create");
      const updates = changes.filter((change) => change?.operation === "update");
      const conflictGroups = [...new Set(conflicts.map((entry) => entry?.uid).filter(Boolean))].map((uid) => ({
        uid,
        title: conflicts.find((entry) => entry?.uid === uid)?.title ?? uid,
        fields: [...new Set(conflicts.filter((entry) => entry?.uid === uid).map((entry) => entry.field))]
      }));
      return { creates, updates, conflicts: conflictGroups };
    }
    const EXCHANGE_ERROR_HINTS = [
      // Structural failures first: these happen with re-saved, renamed or
      // hand-assembled files and every one of them has a concrete remedy.
      [/invalid JSON/i, "JSON \u6587\u4EF6\u89E3\u6790\u5931\u8D25\uFF1A\u5185\u5BB9\u4E0D\u662F\u5408\u6CD5 JSON\uFF08\u5E38\u56E0\u624B\u5DE5\u6539\u8FC7\u6216\u590D\u5236\u4E0D\u5B8C\u6574\uFF09\u3002Excel \u6570\u636E\u8BF7\u7528\u300C\u5BFC\u51FA Excel\u300D\u5F97\u5230\u7684 .xlsx\uFF0C\u6216\u91CD\u65B0\u751F\u6210 JSON \u540E\u518D\u5BFC\u5165\u3002"],
      [/not a valid \.xlsx package/i, "\u8FD9\u4E0D\u662F .xlsx \u5DE5\u4F5C\u7C3F\uFF08\u53EF\u80FD\u628A .xls / .csv / \u6587\u672C\u6587\u4EF6\u6539\u6210\u4E86 .xlsx \u540E\u7F00\uFF09\u3002\u8BF7\u5728 Excel \u6216 WPS \u4E2D\u6253\u5F00\u540E\u300C\u53E6\u5B58\u4E3A \u2192 Excel \u5DE5\u4F5C\u7C3F(.xlsx)\u300D\uFF0C\u518D\u5BFC\u5165\u3002"],
      [/unsafe ZIP path|duplicate ZIP path|directory ZIP entry with content/i, "\u6587\u4EF6\u5185\u90E8\u6253\u5305\u7ED3\u6784\u5F02\u5E38\uFF08\u8DEF\u5F84\u91CD\u590D\u6216\u542B\u975E\u6CD5\u76EE\u5F55\uFF09\u3002\u8BF7\u7528 Excel \u6216 WPS \u6253\u5F00\u8BE5\u6587\u4EF6\u540E\u300C\u53E6\u5B58\u4E3A \u2192 Excel \u5DE5\u4F5C\u7C3F(.xlsx)\u300D\uFF0C\u518D\u5BFC\u5165\u3002"],
      [/truncated ZIP|missing ZIP directory|corrupt ZIP|unsupported ZIP|overlapping ZIP entries|ZIP (?:header|directory|CRC)|ZIP data range/i, "\u6587\u4EF6\u4E0D\u5B8C\u6574\uFF0C\u6216\u4E0D\u662F\u6807\u51C6\u7684\u5DE5\u4F5C\u7C3F\u538B\u7F29\u5305\uFF08\u4E0B\u8F7D\u4E2D\u65AD\u3001\u88AB\u538B\u7F29\u5DE5\u5177\u6539\u5199\u8FC7\uFF09\u3002\u8BF7\u91CD\u65B0\u5BFC\u51FA / \u91CD\u65B0\u4E0B\u8F7D\u6A21\u677F\u540E\u518D\u586B\u5199\u3002"],
      [/more than 1000 records/i, "\u4E00\u6B21\u6700\u591A\u5BFC\u5165 1000 \u6761\u9700\u6C42\u3002\u8BF7\u5206\u6279\u5BFC\u51FA\u3001\u5206\u6279\u5BFC\u5165\u3002"],
      [/expanded ZIP exceeds|exceeds 32 MiB/i, "\u6587\u4EF6\u89E3\u538B\u540E\u8D85\u8FC7 32 MiB\u3002\u8BF7\u51CF\u5C11\u6761\u6570\u6216\u7CBE\u7B80\u957F\u63CF\u8FF0\u540E\u5206\u6279\u5BFC\u5165\u3002"],
      [/cell exceeds Excel text limit/i, "\u67D0\u4E2A\u5355\u5143\u683C\u8D85\u8FC7 Excel \u7684 32767 \u5B57\u4E0A\u9650\u3002\u8BF7\u628A\u957F\u63CF\u8FF0\u62C6\u5230\u300C\u9700\u6C42\u63CF\u8FF0\uFF08\u7EED\uFF09\u300D\u5217\uFF0C\u6216\u7F29\u77ED\u5185\u5BB9\u3002"],
      [/unexpected worksheet column/i, "\u6709\u4E00\u884C\u8D85\u51FA\u4E86 6 \u5217\u3002\u8BF7\u5220\u9664\u591A\u4F59\u5217\uFF0C\u53EA\u4FDD\u7559\u300C\u9700\u6C42\u7F16\u53F7 / \u9879\u76EE / \u6807\u9898 / \u9700\u6C42\u63CF\u8FF0 / \u4F18\u5148\u7EA7 / \u8D1F\u8D23\u4EBA\u300D\u3002"],
      [/macros forbidden|external relationships|externalLink|hyperlinks? forbidden|vbaProject|DTD\/entities/i, "\u6587\u4EF6\u91CC\u542B\u5B8F\u3001\u5916\u90E8\u94FE\u63A5\u6216\u8D85\u94FE\u63A5\u3002\u8BF7\u300C\u53E6\u5B58\u4E3A \u2192 Excel \u5DE5\u4F5C\u7C3F(.xlsx)\u300D\uFF0C\u5E76\u53BB\u6389\u94FE\u63A5\u540E\u518D\u5BFC\u5165\u3002"],
      [/unsupported binary\/macro ZIP part/i, "\u6587\u4EF6\u91CC\u542B\u6709\u56FE\u7247\u7B49\u975E\u6587\u672C\u90E8\u4EF6\u3002\u8BF7\u5220\u9664\u56FE\u7247/\u6279\u6CE8\u540E\u53E6\u5B58\u4E3A .xlsx \u518D\u5BFC\u5165\u3002"],
      [/unsupported cell type|missing cell reference|duplicate\/out-of-range cell|unsupported worksheet row element|unsupported\/oversized XML|mismatched XML tags|malformed XML|duplicate XML attribute|invalid XML entity/i, "\u5355\u5143\u683C\u7ED3\u6784\u5F02\u5E38\uFF08\u53EF\u80FD\u63D2\u5165\u4E86\u5408\u5E76\u5355\u5143\u683C\u3001\u516C\u5F0F\u6216\u56FE\u7247\uFF09\u3002\u8BF7\u53EA\u5728\u8FD9 6 \u5217\u91CC\u586B\u7EAF\u6587\u672C\uFF0C\u53E6\u5B58\u4E3A .xlsx \u540E\u518D\u5BFC\u5165\u3002"],
      [/unsupported exchange payload|invalid record|invalid (?:title|brief|priority|owner) type|brief exceeds 1 MiB|title\/owner exceeds limit/i, "\u5DE5\u4F5C\u8868\u91CC\u7684\u5185\u5BB9\u4E0D\u7B26\u5408\u9700\u6C42\u5B57\u6BB5\u9650\u5236\uFF08\u6BD4\u5982\u6807\u9898\u8FC7\u957F\uFF09\u3002\u8BF7\u68C0\u67E5\u300C\u6807\u9898\u300D\u2264200 \u5B57\u3001\u300C\u8D1F\u8D23\u4EBA\u300D\u2264120 \u5B57\u3001\u300C\u9700\u6C42\u63CF\u8FF0\u300D\u22641 MB \u540E\u91CD\u8BD5\u3002"],
      [/missing metadata digest|metadata digest changed|metadata chunk changed|missing workbook|invalid worksheet relationship/i, "\u8FD9\u4E2A\u6587\u4EF6\u4E0D\u662F\u7531\u300C\u5BFC\u51FA Excel\u300D\u6216\u300C\u4E0B\u8F7D\u5BFC\u5165\u6A21\u677F\u300D\u751F\u6210\u7684\uFF0C\u7F3A\u5C11\u6821\u9A8C\u4FE1\u606F\u3002\u8BF7\u91CD\u65B0\u5BFC\u51FA\u6216\u91CD\u65B0\u4E0B\u8F7D\u6A21\u677F\u540E\u518D\u586B\u5199\u3002"],
      [/legacy workbook layout/i, "\u8FD9\u662F\u65E7\u7248\u5BFC\u51FA\u7684\u5DE5\u4F5C\u7C3F\uFF08\u9996\u884C\u662F\u7248\u672C\u4FE1\u606F\u3001\u542B\u5DF2\u79FB\u9664\u7684\u5217\uFF09\u3002\u8BF7\u91CD\u65B0\u5BFC\u51FA\u9700\u6C42\u6216\u91CD\u65B0\u4E0B\u8F7D\u6A21\u677F\u540E\u518D\u586B\u5199\u3002"],
      [/unexpected worksheet\b|missing\/duplicate \w+ sheet/i, "\u627E\u4E0D\u5230\u5FC5\u8981\u7684\u5DE5\u4F5C\u8868\uFF1A\u8BF7\u4FDD\u7559\u300CRequirements\u300D\u548C\u9690\u85CF\u7684\u300C_Metadata\u300D\u4E24\u5F20\u8868\uFF0C\u4E0D\u8981\u5220\u9664\u6216\u6539\u540D\uFF08\u300CBrief\u300D\u8868\u53EA\u662F\u957F\u63CF\u8FF0\u7EED\u5757\uFF0C\u53EF\u7559\u53EF\u5220\uFF09\u3002\u6700\u7701\u4E8B\u7684\u505A\u6CD5\u662F\u91CD\u65B0\u4E0B\u8F7D\u6A21\u677F\u518D\u586B\u5199\u3002"],
      [/Brief header changed|read-only header changed/i, "\u8868\u5934\u88AB\u6539\u52A8\u4E86\u3002\u8BF7\u4FDD\u7559\u300C\u9700\u6C42\u7F16\u53F7 / \u9879\u76EE / \u6807\u9898 / \u9700\u6C42\u63CF\u8FF0 / \u4F18\u5148\u7EA7 / \u8D1F\u8D23\u4EBA\u300D\u539F\u6837\uFF0C\u53EA\u6539\u8FD9\u56DB\u5217\u7684\u5185\u5BB9\uFF08\u8868\u5934\u6587\u5B57\u4E0D\u80FD\u6539\uFF09\u3002"],
      [/read-only record identity changed|duplicated/i, "\u540C\u4E00\u6761\u9700\u6C42\u51FA\u73B0\u4E86\u4E24\u6B21\uFF08\u6216\u300C\u9700\u6C42\u7F16\u53F7\u300D\u88AB\u6539\u4E71\uFF09\u3002\u6BCF\u884C\u7684\u9700\u6C42\u7F16\u53F7\u53EA\u80FD\u51FA\u73B0\u4E00\u6B21\uFF0C\u91CD\u590D\u884C\u8BF7\u5220\u9664\u3002"],
      [/unknown requirement in worksheet/i, "\u8FD9\u4E00\u884C\u7684\u300C\u9700\u6C42\u7F16\u53F7\u300D\u4E0D\u5728\u672C\u6B21\u5BFC\u51FA\u91CC\u3002\u8BF7\u5BF9\u7167\u539F\u59CB\u6587\u4EF6\u6838\u5BF9\uFF1B\u5982\u679C\u8981\u65B0\u589E\u9700\u6C42\uFF0C\u8BF7\u628A\u8BE5\u884C\u300C\u9700\u6C42\u7F16\u53F7\u300D\u6574\u683C\u6E05\u7A7A\u3002"],
      [/new row needs a title|duplicate new row content/i, "\u300C\u9700\u6C42\u7F16\u53F7\u300D\u4E3A\u7A7A\u7684\u884C\u4F1A\u88AB\u5F53\u4F5C\u65B0\u589E\u9700\u6C42\uFF1A\u5FC5\u987B\u586B\u5199\u300C\u6807\u9898\u300D\uFF0C\u5E76\u4E14\u4E0D\u8981\u590D\u5236\u51FA\u4E24\u884C\u5B8C\u5168\u76F8\u540C\u7684\u5185\u5BB9\u3002"],
      [/wrong project in worksheet row|wrong project|project mismatch|record project mismatch/i, "\u300C\u9879\u76EE\u300D\u5217\u5FC5\u987B\u4FDD\u6301\u5BFC\u51FA\u65F6\u7684\u9879\u76EE\uFF0C\u4E0D\u80FD\u6539\u6210\u5176\u5B83\u9879\u76EE\u3002"],
      [/create identity already used|create-conflict/i, "\u8FD9\u6279\u65B0\u589E\u9700\u6C42\u4E4B\u524D\u5DF2\u7528\u4E0D\u540C\u5185\u5BB9\u5BFC\u5165\u8FC7\u3002\u8BF7\u91CD\u65B0\u5BFC\u51FA\u6216\u91CD\u65B0\u4E0B\u8F7D\u6A21\u677F\uFF0C\u53E6\u5B58\u4E3A\u65B0\u6587\u4EF6\u540E\u518D\u5BFC\u5165\u3002"],
      [/formula-like value|formula-injection|unsafe .*formula/i, "\u5355\u5143\u683C\u4EE5 = + - @ \u5F00\u5934\u4F1A\u88AB\u5F53\u6210\u516C\u5F0F\u3002\u8BF7\u5728\u524D\u9762\u52A0\u4E00\u4E2A\u7A7A\u683C\u6216\u6539\u6210\u666E\u901A\u6587\u5B57\uFF08\u9700\u6C42\u63CF\u8FF0\u91CC\u7684\u300C- \u300D\u5217\u8868\u4E0D\u53D7\u5F71\u54CD\uFF09\u3002"],
      [/invalid title, priority or brief|invalid title|invalid priority/i, "\u6807\u9898\u4E0D\u80FD\u4E3A\u7A7A\uFF1B\u4F18\u5148\u7EA7\u53EA\u80FD\u586B P0 / P1 / P2 / P3\uFF1B\u9700\u6C42\u63CF\u8FF0\u4E0D\u8981\u7559\u7A7A\u884C\u4EE5\u5916\u7684\u63A7\u5236\u5B57\u7B26\u3002"],
      [/stale-preview|local files changed after preview/i, "\u672C\u5730\u9700\u6C42\u5728\u9884\u89C8\u4E4B\u540E\u53D1\u751F\u4E86\u53D8\u5316\u3002\u8BF7\u91CD\u65B0\u9009\u62E9\u6587\u4EF6\u9884\u89C8\u4E00\u6B21\u518D\u786E\u8BA4\u3002"],
      [/unfinished exchange transaction|recovery-required/i, "\u4E0A\u6B21\u5199\u5165\u672A\u5B8C\u6210\uFF0C\u9700\u8981\u5148\u6062\u590D\u624D\u80FD\u7EE7\u7EED\u5BFC\u5165\u3002"],
      [/exchange-locked/i, "\u53E6\u4E00\u4E2A\u5BFC\u5165/\u5BFC\u51FA\u6B63\u5728\u8FDB\u884C\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002"],
      [/exceeds 8 MiB|file-too-large|超过 8 MiB/i, "\u6587\u4EF6\u8D85\u8FC7 8 MiB \u9650\u5236\u3002\u8BF7\u5206\u6279\u5BFC\u51FA\u6216\u62C6\u5206\u6210\u591A\u4E2A\u6587\u4EF6\u3002"]
    ];
    const exchangeErrorHint = (message) => {
      const text = String(message ?? "").trim().replace(/^file rejected:\s*/i, "");
      const hit = EXCHANGE_ERROR_HINTS.find(([pattern]) => pattern.test(text));
      if (hit) return hit[1];
      if (/invalid requirements xlsx/i.test(text)) {
        const detail = text.replace(/^invalid requirements xlsx:\s*/i, "");
        return `\u8FD9\u4E2A\u6587\u4EF6\u65E0\u6CD5\u4F5C\u4E3A\u9700\u6C42\u5DE5\u4F5C\u7C3F\u8BFB\u53D6\u3002\u8BF7\u91CD\u65B0\u4E0B\u8F7D\u5BFC\u5165\u6A21\u677F\uFF0C\u53EA\u586B\u5199\u300C\u6807\u9898 / \u9700\u6C42\u63CF\u8FF0 / \u4F18\u5148\u7EA7 / \u8D1F\u8D23\u4EBA\u300D\u56DB\u5217\u540E\u53E6\u5B58\u4E3A .xlsx \u518D\u5BFC\u5165\u3002\uFF08\u6280\u672F\u4FE1\u606F\uFF1A${detail}\uFF09`;
      }
      return text || "\u64CD\u4F5C\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002";
    };
    const exchangeErrorParts = (message) => {
      const [main, ...rest] = String(message ?? "").split("\uFF08\u6280\u672F\u4FE1\u606F\uFF1A");
      return { main, tech: rest.join("\uFF08\u6280\u672F\u4FE1\u606F\uFF1A").replace(/）\s*$/, "") };
    };
    function ExchangeModal({ root, onClose, onApplied, visibleIds = [] }) {
      const dialogRef = useRef(null);
      const inputRef = useRef(null);
      const [busy, setBusy] = useState(false);
      const [scope, setScope] = useState("all");
      const [selected, setSelected] = useState(null);
      const [preview, setPreview] = useState(null);
      const [receipt, setReceipt] = useState(null);
      const [error, setError] = useState("");
      const [dragging, setDragging] = useState(false);
      const [hostBuild, setHostBuild] = useState(null);
      const request = async (body) => {
        const response = await fetch(`/api/alm/requirements/exchange?root=${encodeURIComponent(root)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        const result = await response.json();
        if (!response.ok && !Array.isArray(result.conflicts)) throw new Error(result.error?.message ?? result.message ?? `HTTP ${response.status}`);
        return result;
      };
      useEffect(() => {
        let live = true;
        request({ action: "version" }).then((result) => {
          if (live) setHostBuild(typeof result?.build === "string" ? result.build : null);
        }).catch(() => {
          if (live) setHostBuild("\u65E7\u7248\u672C");
        });
        return () => {
          live = false;
        };
      }, [root]);
      const run = async (fn) => {
        setBusy(true);
        setError("");
        try {
          await fn();
        } catch (e) {
          setError(exchangeErrorHint(e.message));
        } finally {
          setBusy(false);
        }
      };
      const download = () => run(async () => {
        setReceipt(null);
        if (scope === "filtered" && !visibleIds.length) throw new Error("\u5F53\u524D\u7B5B\u9009\u7ED3\u679C\u4E3A\u7A7A\uFF0C\u6CA1\u6709\u53EF\u5BFC\u51FA\u7684\u9700\u6C42");
        const uids = scope === "filtered" ? visibleIds : void 0;
        const result = await saveExchangeFile("xlsx", (body) => request({ ...body, ...uids ? { uids } : {} }));
        setReceipt({ message: `${result.message}\u6539\u5B8C\u8FD9\u56DB\u5217\u540E\uFF0C\u4ECE\u5361\u7247\u4E8C\u5BFC\u5165\u5373\u53EF\u3002` });
      });
      const downloadTemplate = () => run(async () => {
        setReceipt(null);
        const result = await saveExchangeFile("xlsx", () => request({ action: "template" }), { suggestedName: "requirements-template.xlsx" });
        setReceipt({ message: `${result.message}\u6A21\u677F\u542B 1 \u884C\u793A\u4F8B\uFF08\u300C\u9700\u6C42\u7F16\u53F7\u300D\u7559\u7A7A\u5373\u4E3A\u65B0\u589E\uFF09\uFF1A\u6539\u5199\u4E3A\u771F\u5B9E\u9700\u6C42\uFF0C\u6216\u6574\u884C\u5220\u9664\u540E\u518D\u5BFC\u5165\uFF1B\u8BE5\u6587\u4EF6\u53EA\u7528\u4E8E\u65B0\u589E\u9700\u6C42\u3002` });
      });
      const pick = (file) => run(async () => {
        setPreview(null);
        setReceipt(null);
        setSelected(null);
        if (!file) return;
        if (file.size > 8 * 1024 * 1024) throw new Error("\u6587\u4EF6\u8D85\u8FC7 8 MiB \u9650\u5236");
        const name = String(file.name ?? "");
        const format = name.toLowerCase().endsWith(".xlsx") ? "xlsx" : name.toLowerCase().endsWith(".json") ? "json" : null;
        if (!format) throw new Error("\u4EC5\u652F\u6301 .xlsx \u6216 .json \u6587\u4EF6");
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
        const input2 = { format, filename: name, content: btoa(binary) };
        const result = await request({ action: "preview", ...input2 });
        setSelected(input2);
        setPreview(result);
      });
      const openPicker = () => {
        if (!busy) inputRef.current?.click();
      };
      const drop = (event) => {
        event.preventDefault();
        setDragging(false);
        if (busy) return;
        pick(event.dataTransfer?.files?.[0] ?? null);
      };
      const apply = () => run(async () => {
        const result = await request({ action: "apply", ...selected, expectedLocalHash: preview.localHash });
        if (result.ok === false) {
          setPreview(result);
          return;
        }
        const created = (result.changes ?? []).filter((change) => change.operation === "create").length;
        const updated = (result.changes ?? []).filter((change) => change.operation === "update").length;
        setReceipt({ ...result, message: result.idempotent ? "\u56DE\u5BFC\u5B8C\u6210\uFF1A\u6CA1\u6709\u9700\u8981\u5199\u5165\u7684\u53D8\u66F4\uFF08\u5E42\u7B49\uFF09\u3002" : `\u56DE\u5BFC\u5B8C\u6210\uFF1A\u65B0\u589E ${created} \u6761\u3001\u66F4\u65B0 ${updated} \u6761\uFF0C\u6574\u6279\u5DF2\u539F\u5B50\u5199\u5165\u3002` });
        setPreview(null);
        setSelected(null);
        onApplied();
      });
      useDialogFocus(dialogRef, onClose, { closeOnEscape: false });
      const card2 = { marginTop: 14, padding: "14px 16px", border: `1px solid ${T.line2}`, borderRadius: 12, background: T.layer2 };
      const cardTitle = { margin: 0, fontSize: "14px", fontWeight: 600, color: T.text };
      const hint = { margin: "6px 0 0", fontSize: "12px", color: T.text2, lineHeight: 1.6 };
      const secondary = (active) => ({ minHeight: "32px", padding: "5px 11px", borderRadius: 8, cursor: busy ? "not-allowed" : "pointer", fontSize: "12.5px", color: active ? T.text : T.text2, background: active ? "rgba(77,107,254,.16)" : "transparent", border: `1px solid ${active ? "rgba(106,140,255,.6)" : T.line2}` });
      const primaryButton = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, minHeight: "34px", padding: "7px 14px", borderRadius: 8, cursor: busy ? "not-allowed" : "pointer", fontSize: "12.5px", fontWeight: 600, color: T.base, background: T.text, border: "1px solid transparent", whiteSpace: "nowrap" };
      const ghostButton = { ...primaryButton, color: T.text, background: "transparent", border: `1px solid ${T.line2}`, fontWeight: 500 };
      const disabledLook = (off) => ({ opacity: off ? 0.5 : 1, cursor: busy || off ? "not-allowed" : "pointer" });
      const summary = exchangePreviewSummary(preview);
      const creates = summary.creates;
      const updates = summary.updates;
      const conflictGroups = summary.conflicts;
      const chip = (tone, id, label) => h("span", { "data-exchange-count": id, style: { padding: "3px 9px", borderRadius: 999, fontSize: "12px", fontWeight: 600, color: tone, background: T.layer, border: `1px solid ${T.line2}` } }, label);
      const row2 = (key, kind, tone, title, detail) => h(
        "li",
        { "data-exchange-change": kind, "data-exchange-uid": key, style: { display: "flex", gap: 8, alignItems: "baseline", padding: "6px 0", fontSize: "12.5px", color: T.text, borderTop: `1px solid ${T.line}` } },
        h("span", { style: { color: tone, fontWeight: 600, flex: "none" } }, kind === "create" ? "\u{1F7E2} \u65B0\u589E" : kind === "update" ? "\u{1F7E1} \u66F4\u65B0" : "\u{1F534} \u51B2\u7A81"),
        h("span", { style: { minWidth: 0, overflowWrap: "anywhere" } }, title),
        detail ? h("span", { style: { marginLeft: "auto", color: T.text3, flex: "none" } }, detail) : null
      );
      return h(
        "div",
        { "data-exchange-modal": "true", style: { position: "fixed", inset: 0, zIndex: 1e3, background: "rgba(5,7,11,.66)", backdropFilter: "blur(6px)", display: "grid", placeItems: "center", padding: "24px" } },
        h(
          "section",
          { ref: dialogRef, tabIndex: -1, role: "dialog", "aria-modal": "true", "aria-labelledby": "alm-exchange-title", style: { width: "min(860px, 96vw)", maxHeight: "90vh", overflow: "auto", overscrollBehavior: "contain", padding: "20px 22px 22px", background: T.layer, color: T.text, border: `1px solid ${T.line2}`, borderRadius: 14, boxShadow: "0 28px 80px rgba(0,0,0,.55)" } },
          h(
            "div",
            { style: { display: "flex", alignItems: "center", gap: 12 } },
            h("h2", { id: "alm-exchange-title", style: { margin: 0, fontSize: "18px", fontWeight: 600 } }, "\u9700\u6C42\u6587\u4EF6\u4EA4\u6362"),
            h("button", { type: "button", "data-exchange-close": "true", "aria-label": "\u5173\u95ED\u4EA4\u6362\u5F39\u7A97", disabled: busy, onClick: onClose, style: { marginLeft: "auto", minHeight: "32px", padding: "5px 12px", borderRadius: 8, cursor: busy ? "not-allowed" : "pointer", fontSize: "12.5px", color: T.text, background: "transparent", border: `1px solid ${T.line2}` } }, "\u2715 \u5173\u95ED")
          ),
          h("p", { style: hint }, "\u53EA\u4EA4\u6362\u6807\u9898 / \u9700\u6C42\u63CF\u8FF0 / \u4F18\u5148\u7EA7 / \u8D1F\u8D23\u4EBA\uFF1A\u9700\u6C42\u7F16\u53F7\u3001\u72B6\u6001\u4E0E\u7248\u672C\u53EA\u8BFB\uFF1B\u4E0D\u5BFC\u5165\u6267\u884C\u72B6\u6001\u3001\u9A8C\u6536\u8BC1\u636E\u3001\u7B7E\u6536\u6216\u53D1\u5E03\u6388\u6743\uFF1B\u7F3A\u884C\u4E0D\u5220\u9664\u672C\u5730\u9700\u6C42\u3002"),
          h(
            "section",
            { "data-exchange-export": "true", style: card2 },
            h("h3", { style: cardTitle }, "\u5361\u7247\u4E00 \xB7 \u5BFC\u51FA\u9700\u6C42"),
            h("p", { style: hint }, "\u5BFC\u51FA\u53EF\u76F4\u63A5\u7F16\u8F91\u7684 Excel\uFF08.xlsx\uFF09\u5DE5\u4F5C\u7C3F\uFF1B\u53EF\u7F16\u8F91\u5217\uFF1A\u6807\u9898 / \u9700\u6C42\u63CF\u8FF0 / \u4F18\u5148\u7EA7 / \u8D1F\u8D23\u4EBA\u3002\u7528\u4E8E\u6279\u91CF\u4FEE\u6539\u5DF2\u6709\u9700\u6C42\u3002"),
            h(
              "div",
              { role: "group", "aria-label": "\u5BFC\u51FA\u8303\u56F4", style: { display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" } },
              h("button", { type: "button", "data-exchange-scope": "all", "aria-pressed": scope === "all" ? "true" : "false", disabled: busy, onClick: () => setScope("all"), style: secondary(scope === "all") }, "\u5168\u90E8\u9700\u6C42"),
              h("button", { type: "button", "data-exchange-scope": "filtered", "aria-pressed": scope === "filtered" ? "true" : "false", disabled: busy || !visibleIds.length, title: visibleIds.length ? `\u5BFC\u51FA\u5F53\u524D\u7B5B\u9009\u7684 ${visibleIds.length} \u6761\u9700\u6C42` : "\u5F53\u524D\u7B5B\u9009\u7ED3\u679C\u4E3A\u7A7A", onClick: () => setScope("filtered"), style: secondary(scope === "filtered") }, `\u5F53\u524D\u7B5B\u9009\u7ED3\u679C\uFF08${visibleIds.length} \u6761\uFF09`)
            ),
            h(
              "div",
              { style: { display: "flex", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap" } },
              h(
                "button",
                { type: "button", "data-exchange-export-action": "true", "aria-label": "\u5BFC\u51FA Excel \u5DE5\u4F5C\u7C3F", disabled: busy, onClick: download, style: { ...primaryButton, ...disabledLook(false) } },
                h(ActionIcon, { name: "download", size: 14 }),
                h("span", null, "\u5BFC\u51FA Excel (.xlsx)")
              ),
              h("span", { style: { ...hint, margin: 0 } }, scope === "filtered" ? `\u5C06\u5BFC\u51FA ${visibleIds.length} \u6761\u5F53\u524D\u7B5B\u9009\u7ED3\u679C` : "\u5C06\u5BFC\u51FA\u5168\u90E8\u9700\u6C42")
            )
          ),
          h(
            "section",
            { "data-exchange-import": "true", style: card2 },
            h("h3", { style: cardTitle }, "\u5361\u7247\u4E8C \xB7 \u5BFC\u5165\u4E0E\u5DEE\u5F02\u9884\u89C8"),
            h("p", { style: hint }, "\u62D6\u62FD\u6216\u70B9\u51FB\u9009\u62E9 .xlsx / .json \u6587\u4EF6\uFF1A\u5148\u89E3\u6790\u5E76\u5C55\u793A\u53D8\u66F4\u9884\u89C8\uFF0C\u786E\u8BA4\u540E\u6574\u6279\u539F\u5B50\u843D\u76D8\u3002"),
            h(
              "div",
              { style: { display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" } },
              h(
                "button",
                { type: "button", "data-exchange-template": "true", "aria-label": "\u4E0B\u8F7D\u5BFC\u5165\u6A21\u677F", disabled: busy, onClick: downloadTemplate, style: { ...ghostButton, ...disabledLook(false) } },
                h(ActionIcon, { name: "download", size: 14 }),
                h("span", null, "\u4E0B\u8F7D\u5BFC\u5165\u6A21\u677F (.xlsx)")
              ),
              h("span", { style: { ...hint, margin: 0 } }, "\u7B2C\u4E00\u6B21\u65B0\u589E\u9700\u6C42\u65F6\u5148\u4E0B\u8F7D\u6A21\u677F\uFF1B\u6A21\u677F\u53EA\u7528\u4E8E\u65B0\u589E\uFF0C\u4FEE\u6539\u5DF2\u6709\u9700\u6C42\u8BF7\u7528\u5361\u7247\u4E00\u5BFC\u51FA\u3002")
            ),
            h("p", { style: { ...hint, margin: "8px 0 0" } }, "\u586B\u5199\u89C4\u5219\uFF1A\u53EA\u6539\u300C\u6807\u9898 / \u9700\u6C42\u63CF\u8FF0 / \u4F18\u5148\u7EA7 / \u8D1F\u8D23\u4EBA\u300D\u56DB\u5217\uFF1B\u65B0\u589E\u9700\u6C42\u8BF7\u5728\u672B\u5C3E\u8FFD\u52A0\u4E00\u884C\u3001\u628A\u300C\u9700\u6C42\u7F16\u53F7\u300D\u7559\u7A7A\u5E76\u586B\u5199\u6807\u9898\uFF1B\u300C\u9879\u76EE\u300D\u5217\u4E0D\u8981\u6539\uFF1B\u6E05\u7A7A\u67D0\u884C\u9700\u6C42\u7F16\u53F7\u7B49\u4E8E\u65B0\u589E\u4E00\u6761\uFF0C\u8BF7\u52FF\u8BEF\u5220\uFF1B\u4F18\u5148\u7EA7\u9650 P0\u2013P3\uFF1B\u6807\u9898 \u2264200 \u5B57\uFF1B\u7F3A\u884C\u4E0D\u4F1A\u5220\u9664\u672C\u5730\u9700\u6C42\u3002"),
            h("input", { ref: inputRef, type: "file", accept: ".xlsx,.json", "data-exchange-input": "true", style: { display: "none" }, onChange: (event) => {
              const file = event.target.files?.[0] ?? null;
              event.target.value = "";
              pick(file);
            } }),
            h(
              "div",
              {
                role: "button",
                tabIndex: 0,
                "data-exchange-dropzone": dragging ? "active" : "true",
                "aria-label": "\u62D6\u62FD\u6216\u70B9\u51FB\u9009\u62E9\u5BFC\u5165\u6587\u4EF6",
                "aria-disabled": busy ? "true" : "false",
                onClick: openPicker,
                onKeyDown: (event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openPicker();
                  }
                },
                onDragOver: (event) => {
                  event.preventDefault();
                  if (!busy) setDragging(true);
                },
                onDragLeave: () => setDragging(false),
                onDrop: drop,
                style: { marginTop: 10, padding: "16px 14px", borderRadius: 10, textAlign: "center", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1, color: T.text2, background: dragging ? "rgba(77,107,254,.12)" : T.layer, border: `1px dashed ${dragging ? "rgba(106,140,255,.75)" : T.line2}` }
              },
              h("div", { style: { fontSize: "13px", color: T.text } }, "\u62D6\u62FD .xlsx / .json \u5230\u6B64\u5904\uFF0C\u6216\u70B9\u51FB\u9009\u62E9\u6587\u4EF6"),
              h("div", { style: hint }, "\u9009\u62E9\u540E\u81EA\u52A8\u89E3\u6790\u5E76\u9884\u89C8\uFF1A\u{1F7E2} \u65B0\u589E \xB7 \u{1F7E1} \u66F4\u65B0 \xB7 \u{1F534} \u51B2\u7A81\uFF1B\u6B64\u6B65\u9AA4\u4E0D\u4F1A\u5199\u5165")
            ),
            selected ? h("p", { "data-exchange-selected": "true", style: hint }, `\u5DF2\u9009\u62E9\uFF1A${selected.filename}`) : null,
            preview ? h(
              "div",
              { "data-exchange-preview": preview.ok ? "ready" : "conflict", style: { marginTop: 12 } },
              h(
                "div",
                { style: { display: "flex", gap: 8, flexWrap: "wrap" } },
                chip(T.ok, "create", `\u{1F7E2} \u65B0\u589E ${creates.length} \u6761`),
                chip(T.warn, "update", `\u{1F7E1} \u66F4\u65B0 ${updates.length} \u6761`),
                chip(T.err, "conflict", `\u{1F534} \u51B2\u7A81 ${conflictGroups.length} \u6761`)
              ),
              h("p", { role: "status", style: hint }, preview.ok ? "\u9884\u89C8\u901A\u8FC7\uFF1A\u786E\u8BA4\u540E\u6574\u6279\u539F\u5B50\u843D\u76D8\u3002" : "\u5B58\u5728\u540C\u5B57\u6BB5\u51B2\u7A81\uFF1A\u4E0D\u4F1A\u5199\u5165\u4EFB\u4F55\u8BB0\u5F55\uFF1B\u8BF7\u5148\u5728 Excel \u4E2D\u4FEE\u6B63\u6216\u91CD\u65B0\u5BFC\u51FA\u540E\u518D\u5BFC\u5165\u3002"),
              h(
                "ul",
                { "data-exchange-changes": "true", style: { listStyle: "none", margin: "8px 0 0", padding: 0, maxHeight: 240, overflow: "auto" } },
                creates.map((change) => row2(change.uid, "create", T.ok, `${change.uid} ${change.title ?? ""}`.trim(), "\u5168\u90E8\u5B57\u6BB5")),
                updates.map((change) => row2(change.uid, "update", T.warn, `${change.uid} ${change.title ?? ""}`.trim(), `\u4FEE\u6539\u5B57\u6BB5\uFF1A${EXCHANGE_FIELD_TEXT(change.fields)}`)),
                conflictGroups.map((group) => row2(group.uid, "conflict", T.err, `${group.uid} ${group.title}`.trim(), `\u51B2\u7A81\u5B57\u6BB5\uFF1A${EXCHANGE_FIELD_TEXT(group.fields)}`))
              ),
              h(
                "div",
                { style: { display: "flex", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap" } },
                h(
                  "button",
                  { type: "button", "data-exchange-apply": "true", disabled: busy || !preview.ok, onClick: apply, style: { ...primaryButton, ...disabledLook(!preview.ok) } },
                  h(ActionIcon, { name: "check", size: 14 }),
                  h("span", null, preview.ok ? "\u786E\u8BA4\u5BFC\u5165" : "\u5B58\u5728\u51B2\u7A81\uFF0C\u6682\u4E0D\u53EF\u5BFC\u5165")
                ),
                preview.ok ? h("span", { style: { ...hint, margin: 0 } }, "\u5199\u5165\u540E\u53EF\u5728\u5217\u8868\u67E5\u770B\uFF0C\u4E5F\u53EF\u518D\u6B21\u5BFC\u51FA\u6838\u5BF9\u3002") : null
              )
            ) : null
          ),
          // The receipt belongs to whichever card acted, so it sits between the
          // cards and the dialog footer instead of inside the import card.
          receipt ? h(
            "div",
            { role: "status", "data-exchange-receipt": "true", style: { marginTop: 12, padding: "10px 12px", borderRadius: 10, border: `1px solid ${T.line2}`, background: T.layer2 } },
            h("h4", { style: { margin: 0, fontSize: "13px" } }, "\u7ED3\u679C\u56DE\u6267"),
            h("p", { style: hint }, receipt.message)
          ) : null,
          busy ? h("p", { role: "status", "data-exchange-busy": "true", style: hint }, "\u5904\u7406\u4E2D\u2026") : null,
          error ? (() => {
            const { main, tech } = exchangeErrorParts(error);
            return h(
              "div",
              { role: "alert", "data-exchange-error": "true", style: { display: "flex", gap: 8, alignItems: "flex-start", margin: "12px 0 0", padding: "9px 12px", borderRadius: 10, border: `1px solid ${T.line2}`, background: T.layer2 } },
              h("span", { style: { flex: "none", display: "inline-flex", color: T.warn, marginTop: 2 } }, h(ActionIcon, { name: "alert", size: 13 })),
              h(
                "div",
                { style: { minWidth: 0 } },
                h("p", { style: { margin: 0, fontSize: "12.5px", color: T.text, lineHeight: 1.65 } }, main),
                tech ? h("p", { style: { ...hint, margin: "3px 0 0" } }, `\u6280\u672F\u4FE1\u606F\uFF1A${tech}`) : null
              )
            );
          })() : null,
          // Diagnostics, not decoration: when this line reports an old host, the
          // import rules in force are not the ones on screen.
          h(
            "p",
            { "data-exchange-build": "true", style: { ...hint, margin: "14px 0 0", textAlign: "right" } },
            hostBuild && hostBuild !== EXCHANGE_CLIENT_BUILD ? `\u5DE5\u4F5C\u7C3F\u683C\u5F0F ${EXCHANGE_CLIENT_BUILD} \xB7 \u5BBF\u4E3B\u63D2\u4EF6 ${hostBuild} \u672A\u66F4\u65B0\uFF1A\u8BF7\u5B8C\u5168\u9000\u51FA\u5E76\u91CD\u542F DSH Desktop \u540E\u518D\u5BFC\u5165\u3002` : `\u5DE5\u4F5C\u7C3F\u683C\u5F0F ${EXCHANGE_CLIENT_BUILD}`
          )
        )
      );
    }
    const NATIVE_SOURCE_BUILD_ID = false ? null : null;
    const NATIVE_CLIENT_BUILD_ID = true ? "ac1771fbdba28e478a398aaebbc675acde276158e29abda58b66a49cbdcfb97a" : null;
    function NativeDeliveryControl({ root, requirementId }) {
      const [job, setJob] = useState(null);
      const [error, setError] = useState(null);
      const [busy, setBusy] = useState(false);
      const dispatching = useRef(false);
      const scope = `${root}|${requirementId}`;
      const currentScope = useRef(scope);
      currentScope.current = scope;
      useEffect(() => {
        setJob(null);
        setError(null);
        if (!root || !requirementId) return;
        let saved = null;
        try {
          saved = JSON.parse(localStorage.getItem("alm.native-delivery.job") ?? "null");
        } catch {
        }
        if (saved?.root === root && saved?.requirementId === requirementId) setJob({ jobId: saved.jobId, status: "running", phase: "reconnecting" });
      }, [scope]);
      useEffect(() => {
        if (!job?.jobId || job.status !== "running") return;
        let active = true;
        let timer;
        const poll = async () => {
          try {
            const response = await fetch(`/api/alm/requirements/native-delivery?root=${encodeURIComponent(root)}&jobId=${encodeURIComponent(job.jobId)}`);
            const result = await response.json();
            if (!response.ok || !result.ok || !result.job) throw new Error(result.error?.message ?? "\u90E8\u7F72\u4EFB\u52A1\u4E0D\u53EF\u7528");
            if (active && currentScope.current === scope) {
              setJob(result.job);
              setError(null);
            }
          } catch (failure) {
            if (active) setError(failure.message);
          }
          if (active) timer = setTimeout(poll, 2e3);
        };
        poll();
        return () => {
          active = false;
          clearTimeout(timer);
        };
      }, [job?.jobId, job?.status, scope]);
      const start = async () => {
        if (dispatching.current || !root || !requirementId || job?.status === "running") return;
        if (!window.confirm(`\u5BF9 ${requirementId} \u6267\u884C\u672C\u673A\u771F\u5B9E\u6784\u5EFA\u3001\u53D7\u63A7\u91CD\u8F7D\u3001\u539F\u767B\u8BB0\u9A8C\u6536\u91CD\u9A8C\u4E0E\u53EA\u8BFB GUI \u68C0\u67E5\uFF1F\u8FD9\u4E0D\u662F\u9A8C\u6536\u7B7E\u5B57\u6216\u53D1\u5E03\u3002`)) return;
        dispatching.current = true;
        setBusy(true);
        setError(null);
        try {
          const response = await fetch("/api/alm/requirements/native-delivery", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ root, requirementId }) });
          const result = await response.json();
          if (!response.ok || !result.ok || !result.job?.jobId) throw new Error(result.error?.message ?? "\u65E0\u6CD5\u542F\u52A8\u539F\u751F\u90E8\u7F72");
          localStorage.setItem("alm.native-delivery.job", JSON.stringify({ root, requirementId, jobId: result.job.jobId }));
          if (currentScope.current === scope) setJob(result.job);
        } catch (failure) {
          if (currentScope.current === scope) setError(failure.message);
        } finally {
          dispatching.current = false;
          setBusy(false);
        }
      };
      return h(
        "section",
        { "data-native-delivery-control": "true", style: { padding: 10, borderBottom: `1px solid ${T.line}`, flexShrink: 0 } },
        h("button", { type: "button", disabled: busy || job?.status === "running" || !root || !requirementId, onClick: start }, busy ? "\u6B63\u5728\u8BF7\u6C42\u90E8\u7F72\u2026" : "\u6784\u5EFA\u3001\u90E8\u7F72\u5E76\u9A8C\u8BC1\u672C\u673A GUI"),
        job ? h("div", { role: "status", "data-native-delivery-status": job.status }, `${job.jobId} \xB7 ${job.status} \xB7 ${job.phase ?? ""}${job.error?.message ? ` \xB7 ${job.error.message}` : ""}`) : null,
        error ? h("div", { role: "alert" }, error) : null,
        job?.status === "passed" ? h("div", null, "\u672C\u673A\u90E8\u7F72\u9A8C\u8BC1\u901A\u8FC7\uFF1B\u4ECD\u9700\u72EC\u7ACB\u4EBA\u5DE5\u9A8C\u6536\u4E0E\u53D1\u5E03\u51B3\u7B56\u3002") : null
      );
    }
    function Workbench({ openPanel, onOpenSession }) {
      const nativePageInstance = useRef(`requirements-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      const storedRoot = typeof localStorage === "undefined" ? "" : localStorage.getItem(ROOT_KEY) ?? "";
      const storedProject = typeof localStorage === "undefined" ? "" : localStorage.getItem(PROJECT_KEY) ?? "";
      const [rootInput, setRootInput] = useState(storedRoot);
      const [root, setRoot] = useState(storedRoot);
      const [projectId, setProjectId] = useState(storedProject);
      const [projects, setProjects] = useState([]);
      const [filter, setFilter] = useState(() => readV4Navigation().filter ?? DEFAULT_REQUIREMENT_VIEW);
      const [source, setSource] = useState(() => readV4Navigation().source ?? "all");
      const [awaitingDefects, setAwaitingDefects] = useState([]);
      const [defectSummary, setDefectSummary] = useState(null);
      const [defectInboxOpen, setDefectInboxOpen] = useState(false);
      const [defectTarget, setDefectTarget] = useState(null);
      const [confirmDefectTarget, setConfirmDefectTarget] = useState(null);
      const [monitoringOpen, setMonitoringOpen] = useState(false);
      const [defectToast, setDefectToast] = useState(null);
      const seenDefectFingerprints = useRef(readSeenDefectFingerprints());
      const [keyword, setKeyword] = useState(() => readV4Navigation().keyword ?? "");
      useEffect(() => {
        try {
          sessionStorage.setItem("alm.requirements.navigation.v4", JSON.stringify({ root, projectId, filter, source, keyword, viewVersion: NAVIGATION_VERSION }));
        } catch {
        }
      }, [root, projectId, filter, source, keyword]);
      const [selectedId, setSelectedId] = useState(() => {
        try {
          return sessionStorage.getItem("alm.requirements.detail.v4") || null;
        } catch {
          return null;
        }
      });
      const listFocus = useRef(null);
      const listScroll = useRef(null);
      const detailWasOpen = useRef(false);
      useEffect(() => {
        try {
          if (selectedId) sessionStorage.setItem("alm.requirements.detail.v4", selectedId);
          else sessionStorage.removeItem("alm.requirements.detail.v4");
        } catch {
        }
        if (!selectedId && detailWasOpen.current) setTimeout(() => listFocus.current?.isConnected && listFocus.current.focus?.({ preventScroll: true }), 0);
        detailWasOpen.current = Boolean(selectedId);
      }, [selectedId]);
      const [pendingOpenId, setPendingOpenId] = useState(null);
      const [snapshot, setSnapshot] = useState(null);
      const [diff, setDiff] = useState(null);
      const [traceItem, setTraceItem] = useState(null);
      const [startItem, setStartItem] = useState(null);
      const [acceptanceItem, setAcceptanceItem] = useState(null);
      const [signoffItem, setSignoffItem] = useState(null);
      const [answerItem, setAnswerItem] = useState(null);
      const [releaseItem, setReleaseItem] = useState(null);
      const [aiReviewItem, setAiReviewItem] = useState(null);
      const [rehearsalItem, setRehearsalItem] = useState(null);
      const [archiveItem, setArchiveItem] = useState(null);
      const [removeItem, setRemoveItem] = useState(null);
      const [exchangeOpen, setExchangeOpen] = useState(false);
      const [createOpen, setCreateOpen] = useState(false);
      const [createdNotice, setCreatedNotice] = useState(null);
      const [associateTarget, setAssociateTarget] = useState(null);
      const [showRoot, setShowRoot] = useState(false);
      const [anomalyOpen, setAnomalyOpen] = useState(false);
      const [checkOpen, setCheckOpen] = useState(false);
      const [menuOpen, setMenuOpen] = useState(false);
      const menuRef = useRef(null);
      const projectSelectRef = useRef(null);
      const [feedbackContext, setFeedbackContext] = useState(null);
      const [folderNotice, setFolderNotice] = useState(null);
      const [narrow, setNarrow] = useState(typeof window !== "undefined" ? window.innerWidth < 1120 : false);
      const [mobile, setMobile] = useState(typeof window !== "undefined" ? window.innerWidth < 760 : false);
      const { loading, error, data, reload } = useRequirements({ root, projectId });
      const refreshRef = useRef(reload);
      refreshRef.current = reload;
      const watchDelivery = Boolean(selectedId || startItem || (data?.requirements ?? []).some((entry) => entry.run?.active || entry.delivery?.key === "in-progress"));
      useEffect(() => {
        if (!watchDelivery || !(data?.root ?? root)) return;
        let active = true, timer, pending = false;
        const tick = async () => {
          if (!active || pending) return;
          pending = true;
          try {
            if (document.visibilityState !== "hidden") await refreshRef.current({ silent: true });
          } finally {
            pending = false;
            if (active) timer = setTimeout(tick, 3e3);
          }
        };
        timer = setTimeout(tick, 3e3);
        const onVisible = () => {
          if (!pending && document.visibilityState !== "hidden") {
            clearTimeout(timer);
            timer = setTimeout(tick, 0);
          }
        };
        document.addEventListener("visibilitychange", onVisible);
        return () => {
          active = false;
          clearTimeout(timer);
          document.removeEventListener("visibilitychange", onVisible);
        };
      }, [watchDelivery, data?.root, root, projectId]);
      const workbenchRef = useRef(null);
      useEffect(() => {
        const node = workbenchRef.current;
        if (!node || typeof ResizeObserver === "undefined") return void 0;
        const observer = new ResizeObserver(([entry]) => {
          setNarrow(entry.contentRect.width < 1060);
          setMobile(entry.contentRect.width < 680);
        });
        observer.observe(node);
        return () => observer.disconnect();
      }, []);
      const loadDefectLedger = useCallback(() => {
        const ledgerRoot = data?.root ?? root;
        if (!ledgerRoot) return;
        writeJson("defect", { mode: "summary" }, ledgerRoot).then((payload) => {
          const summary = defectSummaryOf(payload);
          setDefectSummary(summary);
          if (!summary || !(Number(summary.awaitingConfirmation ?? 0) > 0)) {
            setAwaitingDefects([]);
            return null;
          }
          return writeJson("defect", { mode: "list", status: "awaiting-confirmation" }, ledgerRoot).then((listPayload) => {
            const defects = defectListOf(listPayload);
            setAwaitingDefects(defects);
            const fresh = defects.filter((entry) => entry?.fingerprint && !seenDefectFingerprints.current.has(entry.fingerprint));
            if (fresh.length === 0) return;
            for (const entry of fresh) seenDefectFingerprints.current.add(entry.fingerprint);
            rememberDefectFingerprints(fresh.map((entry) => entry.fingerprint));
            setDefectToast({ defect: fresh[0], count: fresh.length });
          });
        }).catch(() => {
          setDefectSummary(null);
          setAwaitingDefects([]);
        });
      }, [data?.root, root]);
      useEffect(() => {
        loadDefectLedger();
      }, [loadDefectLedger, data]);
      const loadProjects = useCallback(() => {
        return fetch("/api/alm/projects").then((response) => response.ok ? response.json() : null).then((payload) => {
          if (!payload?.projects) return;
          setProjects(payload.projects);
        }).catch(() => {
        });
      }, []);
      useEffect(() => {
        loadProjects();
      }, [loadProjects]);
      useEffect(() => {
        if (!data?.project || projectId === ALL_PROJECTS) return;
        setProjectId((current) => current === ALL_PROJECTS ? current : data.project);
        if (typeof localStorage !== "undefined") localStorage.setItem(PROJECT_KEY, data.project);
      }, [data?.project, projectId === ALL_PROJECTS]);
      const applyRoot = useCallback((value, preserveProject = false) => {
        setRoot(value);
        setSelectedId(null);
        if (!preserveProject) setProjectId("");
        if (typeof localStorage !== "undefined") {
          if (value) localStorage.setItem(ROOT_KEY, value);
          else localStorage.removeItem(ROOT_KEY);
          if (!preserveProject) localStorage.removeItem(PROJECT_KEY);
        }
      }, []);
      const applyProject = (id) => {
        setSelectedId(null);
        setFilter(DEFAULT_REQUIREMENT_VIEW);
        setKeyword("");
        if (id === ALL_PROJECTS) {
          setProjectId(ALL_PROJECTS);
          if (typeof localStorage !== "undefined") localStorage.setItem(PROJECT_KEY, ALL_PROJECTS);
          return;
        }
        if (!id) {
          applyRoot("");
          setRootInput("");
          return;
        }
        const project = projects.find((entry) => entry.id === id || entry.workspaceId === id);
        if (!project) return;
        setProjectId(project.id);
        if (typeof localStorage !== "undefined") localStorage.setItem(PROJECT_KEY, project.id);
        applyRoot(project.root ?? "", true);
        setRootInput(project.root ?? "");
      };
      const openSnapshot = (item, version) => {
        const snapshotRoot = item.root ?? data?.root ?? root;
        setSnapshot({ item, version, loading: true, content: null, error: null });
        const query = `root=${encodeURIComponent(snapshotRoot)}&asset=${encodeURIComponent(item.id)}&sha=${encodeURIComponent(version.sha)}`;
        fetch(`/api/alm/requirements/version?${query}`, { headers: { accept: "application/json" } }).then(async (response) => {
          const body2 = await response.json().catch(() => null);
          if (!response.ok || body2?.ok === false) throw new Error(body2?.error?.message ?? `HTTP ${response.status}`);
          setSnapshot(
            (current) => current?.version.sha === version.sha ? { ...current, loading: false, content: body2.content } : current
          );
        }).catch(
          (error2) => setSnapshot(
            (current) => current?.version.sha === version.sha ? { ...current, loading: false, error: error2.message } : current
          )
        );
      };
      const openDiff = (item, version) => {
        const diffRoot = item.root ?? data?.root ?? root;
        setDiff({ loading: true, item, version, data: null, error: null });
        const query = `root=${encodeURIComponent(diffRoot)}&asset=${encodeURIComponent(item.id)}&from=${encodeURIComponent(version.sha)}`;
        fetch(`/api/alm/requirements/diff?${query}`, { headers: { accept: "application/json" } }).then(async (response) => {
          const body2 = await response.json().catch(() => null);
          if (!response.ok || body2?.ok === false) throw new Error(body2?.error?.message ?? `HTTP ${response.status}`);
          setDiff((current) => current?.version.sha === version.sha ? { ...current, loading: false, data: body2 } : current);
        }).catch(
          (error2) => setDiff((current) => current?.version.sha === version.sha ? { ...current, loading: false, error: error2.message } : current)
        );
      };
      useEffect(() => {
        if (!menuOpen) return void 0;
        const onKeyDown = (event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setMenuOpen(false);
          }
        };
        const onPointerDown = (event) => {
          if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false);
        };
        document.addEventListener("keydown", onKeyDown, true);
        document.addEventListener("mousedown", onPointerDown, true);
        return () => {
          document.removeEventListener("keydown", onKeyDown, true);
          document.removeEventListener("mousedown", onPointerDown, true);
        };
      }, [menuOpen]);
      const projectMetaFor = useCallback(
        (item) => {
          if (!item) return null;
          const fromProjects = projects.find((entry) => entry.projectId === item.project || entry.id === item.project);
          if (fromProjects) {
            return {
              name: fromProjects.name,
              repo: fromProjects.github ? `${fromProjects.github.owner}/${fromProjects.github.repo}` : null,
              board: fromProjects.github?.project?.number ?? null,
              workspaceTitle: fromProjects.title,
              linked: fromProjects.linked
            };
          }
          if (data?.projectInfo) {
            return { name: data.projectInfo.name, repo: data.projectInfo.repo, board: data.projectInfo.board, workspaceTitle: data.projectName, linked: true };
          }
          return { name: item.projectName, repo: null, board: null };
        },
        [projects, data?.projectInfo, data?.projectName]
      );
      const items = data?.requirements ?? [];
      useEffect(() => {
        if (!pendingOpenId) return;
        const target = items.find((entry) => entry.id === pendingOpenId || entry.uid === pendingOpenId);
        if (!target) return;
        setSelectedId(keyOf(target));
        setPendingOpenId(null);
      }, [pendingOpenId, items]);
      const scopedItems = items;
      const keyOf = (item) => item?.occurrenceKey ?? item?.id;
      const needle = keyword.trim().toLowerCase();
      const activeItems = scopedItems.filter((item) => deliveryOf(item).key !== "closed");
      const scopeItems = scopedItems;
      const sourceItems = source === "all" ? scopeItems : scopeItems.filter((item) => matchesSource(item, source));
      const keywordMatched = needle ? sourceItems.filter(
        (item) => item.title.toLowerCase().includes(needle) || item.id.toLowerCase().includes(needle) || (item.businessId ?? "").toLowerCase().includes(needle) || (item.owner ?? "").toLowerCase().includes(needle)
      ) : sourceItems;
      const counts = requirementViewCounts(data, keywordMatched);
      const searched = keywordMatched.filter((item) => matchesView(item, filter));
      const visible = searched;
      const normalizeRoot = (value) => String(value ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
      const exchangeRoot = data?.root ?? root;
      const exportableIds = [...new Set(visible.filter((item) => !item.root || !exchangeRoot || normalizeRoot(item.root) === normalizeRoot(exchangeRoot)).map((item) => item.id))];
      const itemCount = activeItems.length;
      const filtered = filter !== "all" || keyword !== "" || source !== "all";
      const clearFilters = () => {
        setFilter("all");
        setSource("all");
        setKeyword("");
      };
      const selected = items.find((item) => keyOf(item) === selectedId) ?? null;
      const currentProject = projects.find((entry) => entry.id === projectId || entry.workspaceId === projectId) ?? null;
      const openOccurrence = (occurrence) => {
        const match = items.find((item) => {
          if (occurrence?.occurrenceKey) return keyOf(item) === occurrence.occurrenceKey;
          return item.id === (occurrence?.assetId ?? occurrence?.id ?? occurrence?.requirementIds?.[0]);
        });
        if (match) setSelectedId(keyOf(match));
      };
      const openRequirementById = (id) => {
        const match = items.find((item) => item.id === id);
        setSelectedId(match ? keyOf(match) : id);
      };
      const openDefect = (value) => {
        const record = defectRecord(value) ?? defectOf(value) ?? null;
        const linkedItem = items.find((item) => record?.requirement && item.id === record.requirement || value?.id && item.id === value.id) ?? null;
        setDefectInboxOpen(false);
        setDefectTarget({ defect: record, item: linkedItem ?? (isDefect(value) ? value : null) });
      };
      const awaitingDefectCount = Number(defectSummary?.awaitingConfirmation ?? awaitingDefects.length ?? 0);
      const onIntentCreated = (result) => {
        if (result?.requirementId) setCreatedNotice({ requirementId: result.requirementId, awaiting: true });
        reload();
      };
      useEffect(() => {
        if (!createdNotice?.awaiting) return;
        if (loading || !data) return;
        if (listScroll.current) listScroll.current.scrollTop = 0;
        setCreatedNotice((current) => current && current.awaiting ? { ...current, awaiting: false } : current);
      }, [data, loading, createdNotice]);
      const hasScope = projectId === ALL_PROJECTS || Boolean(root);
      const singleWorkspace = projectId !== ALL_PROJECTS && Boolean(root);
      const linked = Boolean(currentProject?.linked);
      const scopeText = projectId === ALL_PROJECTS ? data ? `${data.summary.projects} \u4E2A\u5DE5\u4F5C\u533A` : "\u5168\u90E8\u5DE5\u4F5C\u533A" : !hasScope ? "\u8BF7\u9009\u62E9\u5DE5\u4F5C\u533A\u6216\u6307\u5B9A\u4ED3\u5E93\u6839\u76EE\u5F55" : linked ? "\u5DF2\u5173\u8054\u4ED3\u5E93" : "\u672A\u5173\u8054\u4ED3\u5E93";
      const countLabel = loading ? "\u8BFB\u53D6\u4E2D" : data ? `${itemCount} \u6761` : "\u2014";
      const createRequirement = () => {
        if (!singleWorkspace) return;
        if (currentProject && !currentProject.linked) {
          setAssociateTarget(currentProject);
          return;
        }
        setCreateOpen(true);
      };
      const openFolder = () => {
        const targetRoot = data?.root ?? root;
        if (!targetRoot) {
          setFolderNotice({ ok: false, message: "\u8FD8\u6CA1\u6709\u53EF\u6253\u5F00\u7684\u4ED3\u5E93\u6839\u76EE\u5F55\u3002" });
          return;
        }
        writeJson("reveal", { root: targetRoot }, targetRoot).then((payload) => {
          if (payload?.ok === false) throw new Error(payload?.error?.message ?? "\u6253\u5F00\u76EE\u5F55\u5931\u8D25");
          setFolderNotice({ ok: true, message: "\u5DF2\u5728\u7CFB\u7EDF\u6587\u4EF6\u7BA1\u7406\u5668\u4E2D\u6253\u5F00\uFF1A" + (payload?.root ?? targetRoot) });
        }).catch((error2) => setFolderNotice({ ok: false, message: "\u65E0\u6CD5\u6253\u5F00\u76EE\u5F55\uFF1A" + error2.message + "\uFF08\u8DEF\u5F84\uFF1A" + targetRoot + "\uFF09" }));
      };
      const freezeFeedbackContext = () => {
        const defect = selected ? defectOf(selected) : null;
        const failure = selected?.run?.failure ?? null;
        const rawError = error ? readableError(error) : failure?.message ?? null;
        return {
          page: selected ? "detail" : "list",
          stage: defect?.impact?.stage ?? selected?.run?.phase ?? null,
          workspaceId: currentProject?.workspaceId ?? null,
          root: data?.root ?? root ?? null,
          projectId: currentProject?.projectId ?? currentProject?.project ?? null,
          requirementId: selected?.id ?? null,
          requirementRevision: selected?.revision ?? null,
          requirementFile: selected?.file ?? null,
          intentSessionId: null,
          runId: selected?.run?.id ?? null,
          candidateId: selected?.candidate?.id ?? null,
          recentError: rawError ? feedbackMaskPaths(rawError).slice(0, 600) : null,
          frozenAt: Date.now()
        };
      };
      const openFeedback = (overlay) => {
        setMenuOpen(false);
        const explicit = { ...overlay?.context ?? {} };
        for (const key of ["requirementId", "requirementRevision", "requirementFile", "runId", "candidateId", "intentSessionId", "acceptanceDecisionId", "failureIds", "stage"]) {
          if (overlay?.[key] != null && explicit[key] == null) explicit[key] = overlay[key];
        }
        const next = { ...freezeFeedbackContext(), ...explicit };
        if (overlay && overlay.kind) {
          next.overlay = {
            kind: overlay.kind,
            label: overlay.label ?? null,
            requirementId: overlay.requirementId ?? next.requirementId ?? null
          };
          if (["requirement", "delivery", "record"].includes(overlay.tab)) next.overlay.tab = overlay.tab;
        }
        setFeedbackContext(next);
      };
      FEEDBACK_LAUNCHER = openFeedback;
      const menuItem = (label, icon, onClick, extra, attrs) => h(
        "button",
        {
          type: "button",
          role: "menuitem",
          ...attrs ?? {},
          onClick: () => {
            setMenuOpen(false);
            onClick();
          },
          style: {
            display: "flex",
            alignItems: "center",
            gap: "8px",
            width: "100%",
            border: 0,
            background: "transparent",
            color: T.text,
            padding: "8px 10px",
            borderRadius: "7px",
            fontSize: "12px",
            textAlign: "left",
            cursor: "pointer",
            ...extra
          },
          onMouseEnter: (event) => {
            event.currentTarget.style.background = T.layer2;
          },
          onMouseLeave: (event) => {
            event.currentTarget.style.background = "transparent";
          }
        },
        h(ActionIcon, { name: icon, size: 14 }),
        label
      );
      const header = h(
        "div",
        { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "20px", flexWrap: "wrap", paddingTop: "26px" } },
        h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "12px", minWidth: 0, flexWrap: "wrap" } },
          h(
            "div",
            { style: { display: "flex", alignItems: "baseline", gap: "10px" } },
            h("h1", { style: { margin: 0, fontSize: "28px", lineHeight: 1.2, fontWeight: 600, letterSpacing: "-.025em" } }, "\u9700\u6C42"),
            h("span", { style: { color: T.text2, fontSize: "12px", fontVariantNumeric: "tabular-nums" } }, countLabel)
          ),
          h("span", { "aria-hidden": "true", style: { width: "1px", height: "28px", background: T.line } }),
          h(
            "div",
            { style: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "4px", minWidth: 0 } },
            h(ProjectPicker, { projects, currentId: projectId, onPick: applyProject, selectRef: projectSelectRef }),
            h("span", { style: { color: T.text2, fontSize: "11px", lineHeight: 1.4, overflowWrap: "anywhere" } }, scopeText)
          )
        ),
        h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "8px" } },
          h("button", { disabled: !singleWorkspace, onClick: () => setExchangeOpen(true), title: "\u5B89\u5168\u4EA4\u6362\uFF1A\u5BFC\u51FA Excel\uFF0C\u5BFC\u5165\u5E76\u9884\u89C8\u53D8\u66F4" }, "\u5BFC\u5165 / \u5BFC\u51FA"),
          h(ActionButton, {
            label: "\u65B0\u5EFA\u9700\u6C42",
            icon: "plus",
            variant: "primary",
            disabled: !singleWorkspace,
            onClick: createRequirement,
            title: singleWorkspace ? "\u5148\u6F84\u6E05\u610F\u56FE\uFF0C\u518D\u4FDD\u5B58\u9700\u6C42" : "\u5207\u6362\u5230\u5355\u4E2A\u5DE5\u4F5C\u533A\u540E\u53EF\u65B0\u5EFA\u9700\u6C42"
          })
        )
      );
      const onFilterKeyDown = (event) => {
        const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (step === 0 && event.key !== "Home" && event.key !== "End") return;
        const current = Math.max(0, FILTERS.findIndex(([id]) => id === filter));
        const next = event.key === "Home" ? 0 : event.key === "End" ? FILTERS.length - 1 : (current + step + FILTERS.length) % FILTERS.length;
        event.preventDefault();
        setFilter(FILTERS[next][0]);
        event.currentTarget.querySelectorAll('[role="tab"]')[next]?.focus();
      };
      const toolbar = h(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: "10px",
            margin: "0 0 12px",
            padding: "14px 0 12px",
            borderBottom: `1px solid ${T.line}`,
            flexWrap: "wrap",
            background: T.base
          }
        },
        h(
          "div",
          { role: "tablist", "aria-label": "\u6309\u4EA4\u4ED8\u89C6\u56FE\u7B5B\u9009", "data-work-views": "true", style: { display: "flex", alignItems: "stretch", gap: "4px", width: "100%", minWidth: 0, overflowX: "auto", borderBottom: `1px solid ${T.line}`, paddingBottom: "4px", marginBottom: "4px" }, onKeyDown: onFilterKeyDown },
          FILTERS.map(([id, label]) => {
            const active = filter === id;
            return h(
              "button",
              {
                key: id,
                type: "button",
                role: "tab",
                "aria-selected": active,
                tabIndex: active ? 0 : -1,
                onClick: () => setFilter(id),
                style: {
                  border: 0,
                  borderBottom: `2px solid ${active ? T.text : "transparent"}`,
                  background: "transparent",
                  color: active ? T.text : T.text2,
                  padding: "7px 9px 8px",
                  fontSize: "12.5px",
                  fontWeight: active ? 500 : 400,
                  cursor: "pointer",
                  whiteSpace: "nowrap"
                }
              },
              label,
              h("span", { style: { marginLeft: "6px", color: active ? T.text2 : T.text3, fontSize: "11px", fontVariantNumeric: "tabular-nums" } }, counts[id])
            );
          })
        ),
        // Source is a second, orthogonal axis: a defect-born requirement keeps
        // its work view (待处理/推进中/…) and is separable by origin.
        h(
          "div",
          {
            role: "group",
            "aria-label": "\u6309\u6765\u6E90\u7B5B\u9009",
            style: { display: "flex", alignItems: "center", gap: "2px", flexWrap: "wrap", padding: "3px", background: T.layer, borderRadius: "8px" }
          },
          h("span", { style: { color: T.text3, fontSize: "11px", marginRight: "2px" } }, "\u6765\u6E90"),
          SOURCE_FILTERS.map(([id, label]) => {
            const active = source === id;
            return h(
              "button",
              {
                key: id,
                type: "button",
                "data-source": id,
                "aria-pressed": active,
                onClick: () => setSource(id),
                style: {
                  border: 0,
                  borderRadius: "6px",
                  background: active ? T.layer2 : "transparent",
                  color: active ? T.text : T.text2,
                  padding: "6px 9px",
                  fontSize: "11.5px",
                  fontWeight: active ? 500 : 400,
                  cursor: "pointer",
                  whiteSpace: "nowrap"
                }
              },
              label
            );
          })
        ),
        awaitingDefectCount > 0 ? h(
          "button",
          {
            type: "button",
            "data-defect-inbox": "true",
            onClick: () => setDefectInboxOpen(true),
            title: "\u5931\u8D25\u76D1\u63A7\u53D1\u73B0\u3001\u5C1A\u672A\u786E\u8BA4\u7684\u7F3A\u9677\u9700\u6C42",
            style: {
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              marginLeft: "6px",
              border: `1px solid ${T.warn}`,
              background: "transparent",
              color: T.warn,
              borderRadius: "999px",
              padding: "3px 10px 3px 8px",
              fontSize: "11.5px",
              cursor: "pointer",
              whiteSpace: "nowrap"
            }
          },
          h(ActionIcon, { name: "alert", size: 12 }),
          `\u5F85\u786E\u8BA4\u7F3A\u9677 ${awaitingDefectCount}`
        ) : null,
        h("div", { style: { flex: 1, minWidth: "12px" } }),
        filtered ? h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "8px" } },
          h(
            "span",
            { role: "status", "aria-live": "polite", style: { color: T.text3, fontSize: "11.5px", fontVariantNumeric: "tabular-nums" } },
            `${visible.length} \u6761\u7ED3\u679C`
          ),
          h(
            "button",
            {
              type: "button",
              onClick: clearFilters,
              title: "\u91CD\u7F6E\u5168\u90E8\u67E5\u8BE2\u6761\u4EF6",
              "aria-label": "\u91CD\u7F6E\u5168\u90E8\u67E5\u8BE2\u6761\u4EF6",
              style: { border: `1px solid ${T.line}`, background: "transparent", color: T.text2, borderRadius: "6px", padding: "3px 8px", fontSize: "11.5px", cursor: "pointer" }
            },
            "\u91CD\u7F6E"
          )
        ) : null,
        h(
          "label",
          { "data-requirements-search": "true", style: { display: "flex", alignItems: "center", gap: "7px", height: "36px", width: mobile ? "100%" : "250px", maxWidth: "100%", border: `1px solid ${T.line}`, borderRadius: "8px", background: T.layer, padding: "0 10px" } },
          h("span", { style: { display: "inline-flex", flex: "0 0 auto", alignItems: "center", justifyContent: "center", width: "14px", height: "14px", color: T.text3 } }, h(ActionIcon, { name: "search", size: 14 })),
          h("input", {
            value: keyword,
            onChange: (event) => setKeyword(event.target.value),
            placeholder: "\u641C\u7D22\u6807\u9898\u3001\u9700\u6C42 ID \u6216\u8D1F\u8D23\u4EBA",
            "aria-label": "\u641C\u7D22\u6807\u9898\u3001\u9700\u6C42 ID \u6216\u8D1F\u8D23\u4EBA",
            style: { border: 0, outline: 0, background: "transparent", color: T.text, fontSize: "12px", flex: "1 1 auto", minWidth: 0, width: "100%" }
          }),
          keyword ? h(
            "button",
            {
              type: "button",
              onClick: () => setKeyword(""),
              "aria-label": "\u6E05\u9664\u641C\u7D22",
              style: { border: 0, background: "transparent", color: T.text3, cursor: "pointer", padding: 0, display: "inline-flex" }
            },
            h(ActionIcon, { name: "close", size: 12 })
          ) : null
        ),
        h(ActionButton, { label: loading ? "\u5237\u65B0\u4E2D\u2026" : "\u5237\u65B0", icon: "refresh", variant: "ghost", disabled: loading, onClick: reload, title: "\u91CD\u65B0\u8BFB\u53D6\u9700\u6C42\u8D44\u4EA7" }),
        h(
          "div",
          { style: { position: "relative" }, ref: menuRef },
          h(ActionButton, { label: "\u66F4\u591A", icon: "more", variant: "ghost", onClick: () => setMenuOpen((value) => !value), title: "\u66F4\u591A\u5DE5\u5177", "aria-haspopup": "menu", "aria-expanded": menuOpen }),
          menuOpen ? h(
            "div",
            {
              role: "menu",
              style: {
                position: "absolute",
                right: 0,
                top: "calc(100% + 6px)",
                zIndex: 40,
                minWidth: "190px",
                background: T.layer,
                border: `1px solid ${T.line2}`,
                borderRadius: "10px",
                padding: "5px",
                boxShadow: "0 12px 32px rgba(0,0,0,.35)"
              }
            },
            singleWorkspace && currentProject ? menuItem(linked ? "\u66F4\u65B0\u5DE5\u4F5C\u533A\u5173\u8054" : "\u5173\u8054 GitHub \u4ED3\u5E93", "link", () => setAssociateTarget(currentProject)) : null,
            menuItem("\u6253\u5F00\u4ED3\u5E93\u76EE\u5F55", "folder", openFolder),
            menuItem("\u6307\u5B9A\u6839\u76EE\u5F55", "folder", () => setShowRoot(true)),
            menuItem("\u5931\u8D25\u76D1\u63A7\u8BBE\u7F6E", "alert", () => setMonitoringOpen(true)),
            menuItem("\u53CD\u9988\u4E0E\u5EFA\u8BAE", "message", () => openFeedback(), null, { "data-feedback-entry": "true" }),
            openPanel ? menuItem("\u5728\u5DE5\u4F5C\u53F0\u6253\u5F00", "eye", openPanel) : null
          ) : null
        )
      );
      const createdBanner = createdNotice && !createdNotice.awaiting && !visible.some((item) => item.id === createdNotice.requirementId) ? h(
        "div",
        {
          role: "status",
          style: {
            ...card,
            cursor: "default",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            flexWrap: "wrap",
            borderColor: T.line2,
            background: EVIDENCE_TONE.warn.bg
          }
        },
        h("span", { style: { fontSize: "12.5px", color: T.text2 } }, `\u5DF2\u521B\u5EFA ${createdNotice.requirementId}\uFF0C\u4F46\u5F53\u524D\u7B5B\u9009\u4E0B\u4E0D\u53EF\u89C1`),
        h(
          "button",
          {
            style: button,
            onClick: () => {
              clearFilters();
              setCreatedNotice(null);
            }
          },
          "\u6E05\u9664\u7B5B\u9009\u67E5\u770B"
        )
      ) : null;
      const duplicateCounts = {};
      for (const item of scopedItems) duplicateCounts[item.id] = (duplicateCounts[item.id] ?? 0) + 1;
      let body;
      let tableInScroller = false;
      if (!hasScope) {
        body = h(ProjectContextPrompt, { selectRef: projectSelectRef });
      } else if (loading && !data) {
        body = h(SkeletonTable, { narrow, mobile });
      } else if (error && !data) {
        body = h(
          "div",
          { style: { border: `1px solid ${T.line}`, borderRadius: "12px", background: T.layer, padding: "28px" } },
          h("p", { style: { margin: "0 0 6px", color: T.text, fontSize: "14px", fontWeight: 600 } }, "\u8BFB\u53D6\u9700\u6C42\u5931\u8D25"),
          h("p", { style: { margin: "0 0 16px", color: T.err, fontSize: "12.5px", lineHeight: 1.7 } }, readableError(error)),
          h(ActionButton, { label: "\u91CD\u8BD5", icon: "refresh", variant: "secondary", onClick: reload })
        );
      } else if (scopedItems.length === 0) {
        body = h(EmptyState, { root: data?.root ?? root, onCreate: createRequirement, onOpenPanel: openPanel });
      } else {
        tableInScroller = true;
        body = h(RequirementTable, {
          items: visible,
          narrow,
          mobile,
          showProject: data?.scope === "all",
          contained: true,
          stickyTop: 0,
          selectedKey: selectedId,
          duplicateCounts,
          onAiReview: (entry) => setAiReviewItem(entry),
          onAcceptance: (entry) => setAcceptanceItem(entry),
          onSignoff: (entry) => setSignoffItem(entry),
          onOpen: (entry) => {
            listFocus.current = document.activeElement;
            setSelectedId(keyOf(entry));
          },
          onDefect: (entry) => openDefect(entry),
          onArchive: (entry) => setArchiveItem(entry),
          onRemove: (entry) => setRemoveItem(entry),
          emptyNode: h(NoResults, { filter, keyword, source, onClear: clearFilters })
        });
      }
      const notices = h(
        "div",
        null,
        folderNotice ? h(
          "div",
          {
            role: "status",
            style: {
              ...card,
              cursor: "default",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
              flexWrap: "wrap",
              borderColor: folderNotice.ok ? T.line2 : T.err,
              background: folderNotice.ok ? T.layer2 : EVIDENCE_TONE.warn.bg
            }
          },
          h("span", { style: { fontSize: "12.5px", color: T.text2 } }, folderNotice.message),
          h("button", { type: "button", style: button, onClick: () => setFolderNotice(null) }, "\u77E5\u9053\u4E86")
        ) : null,
        error && data ? h(
          "div",
          {
            role: "status",
            style: {
              ...card,
              cursor: "default",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
              flexWrap: "wrap",
              borderColor: T.err,
              background: EVIDENCE_TONE.warn.bg
            }
          },
          h("span", { style: { fontSize: "12.5px", color: T.text2 } }, "\u5237\u65B0\u5931\u8D25\uFF1A" + readableError(error)),
          h("button", { type: "button", style: button, onClick: reload }, "\u91CD\u8BD5")
        ) : null,
        h(AnomalyNotice, {
          anomalies: data?.anomalies,
          summary: data?.anomalySummary,
          expanded: anomalyOpen,
          anomalyOnly: filter === "anomalies",
          onToggleExpanded: () => setAnomalyOpen((value) => !value),
          onToggleOnly: () => setFilter((value) => value === "anomalies" ? "all" : "anomalies"),
          onOpen: openOccurrence
        }),
        h(CheckNotice, {
          data,
          expanded: checkOpen,
          onToggleExpanded: () => setCheckOpen((value) => !value)
        })
      );
      return h(
        "div",
        { ref: workbenchRef, style: { ...panel, ...mobile ? { paddingLeft: "16px", paddingRight: "16px", overflowY: "auto" } : {} }, "data-requirements-workbench": "true", "data-native-delivery-identity": "true", "data-source-build-id": NATIVE_SOURCE_BUILD_ID, "data-client-build-id": NATIVE_CLIENT_BUILD_ID, "data-page-instance": nativePageInstance.current },
        h("style", null, `
          [data-requirements-workbench] button:focus-visible, [role="dialog"] button:focus-visible, [role="dialog"] input:focus-visible, [role="dialog"] textarea:focus-visible, [role="dialog"] select:focus-visible { outline: 2px solid ${T.brand}; outline-offset: 3px; }
          [data-requirements-search]:focus-within { outline: 2px solid ${T.brand}; outline-offset: 2px; }
          [role="dialog"] [data-intent-screen-heading]:focus { outline: 2px solid ${T.brand}; outline-offset: 3px; }
          [data-list-scroll]:focus-visible { outline: 2px solid ${T.brand}; outline-offset: 2px; }
          [data-requirements-workbench] button { transition: background-color 120ms ease, color 120ms ease; }
          [data-work-views] button { flex-shrink: 0; }
          @media (max-width: 760px) { [data-requirements-search] { width: 100% !important; } }
          @media (max-height: 620px) { [data-requirements-workbench] { overflow-y: auto !important; } }
          @media (max-width: 760px) { [data-requirements-workbench] { padding-left: 16px !important; padding-right: 16px !important; overflow-y: auto !important; } }
          [role="dialog"] [role="button"]:focus-visible { outline: 2px solid ${T.brand}; outline-offset: 3px; }
          @media (prefers-reduced-motion: reduce) { [data-requirements-workbench] button { transition: none; } }
        `),
        h(
          "div",
          { "data-requirements-list-page": "true", style: { display: selected ? "none" : "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0 } },
          header,
          showRoot ? h(RootPicker, { rootInput, setRootInput, onApply: () => applyRoot(rootInput), onReset: () => {
            setRootInput("");
            applyRoot("");
          } }) : null,
          toolbar,
          createdBanner,
          // Notices stay above the list and never push it off screen.
          h("div", { style: { flex: "0 0 auto", maxHeight: "38vh", overflowY: "auto" } }, notices),
          h(
            "div",
            { style: listArea },
            tableInScroller ? h("div", { ref: listScroll, role: "region", "aria-label": "\u9700\u6C42\u5217\u8868", tabIndex: 0, style: listScroller, "data-list-scroll": "true" }, body) : h("div", { style: { flex: "1 1 auto", minHeight: 0, overflowY: "auto" } }, body)
          )
        ),
        selected ? h(Drawer, {
          item: selected,
          onOpenSession,
          onFeedback: openFeedback,
          allItems: items,
          projectMeta: projectMetaFor(selected),
          root: data?.root ?? root,
          onClose: () => setSelectedId(null),
          onSnapshot: openSnapshot,
          onDiff: openDiff,
          onTrace: (entry) => setTraceItem(entry),
          onDefect: openDefect,
          onStart: async (entry, options) => {
            try {
              const targetRoot = entry.root ?? data?.root ?? root;
              const decision = await writeJson("run", { mode: "decision", requirementId: entry.id }, targetRoot);
              if (decision?.decision) {
                setAnswerItem(entry);
                return;
              }
              if (decision?.exists) {
                const result = await writeJson("run", { mode: "continue", requirementId: entry.id }, targetRoot);
                if (result?.resumed !== true) throw new Error(result?.message ?? "\u8FD0\u884C\u672A\u7EE7\u7EED");
                if (result?.autoAdvanceResumed === false) window.alert(`\u5DF2\u7EE7\u7EED\u672C\u8F6E\uFF0C\u4F46\u81EA\u52A8\u63A8\u8FDB\u672A\u6062\u590D\uFF08${result.autoAdvanceReason}\uFF09\u3002\u9700\u5728\u539F\u751F\u754C\u9762\u68C0\u67E5\u7248\u672C\u4E0E\u6267\u884C\u9884\u7B97\uFF1B\u672A\u65B0\u589E\u6388\u6743\u3002`);
                await reload();
                return;
              }
              setStartItem({ item: entry, isolate: options?.isolate === true });
            } catch (error2) {
              window.alert(`\u5F00\u59CB\u4FEE\u590D\u5931\u8D25\uFF1A${error2.message}`);
            }
          },
          onAcceptance: (entry) => setAcceptanceItem(entry),
          onSignoff: (entry) => setSignoffItem(entry),
          onRelease: (entry) => setReleaseItem(entry),
          onAiReview: (entry) => setAiReviewItem(entry),
          onRehearsal: (entry) => setRehearsalItem(entry),
          onArchive: (entry) => setArchiveItem(entry),
          onRemove: (entry) => setRemoveItem(entry),
          onRefresh: () => reload(),
          onCancelRun: (entry) => {
            if (!window.confirm(`\u53D6\u6D88 ${entry.id} \u7684\u672C\u8F6E\u63A8\u8FDB\uFF1F\u5DE5\u4F5C\u533A\u6539\u52A8\u4E0E\u8BB0\u5F55\u4F1A\u4FDD\u7559\u3002`)) return;
            writeJson("run", { mode: "cancel", requirementId: entry.id, reason: "\u4EBA\u7C7B\u5728\u9700\u6C42\u9762\u677F\u53D6\u6D88\u672C\u8F6E\u63A8\u8FDB" }, entry.root ?? data?.root ?? root).then(() => reload()).catch((error2) => window.alert(`\u53D6\u6D88\u5931\u8D25\uFF1A${error2.message}`));
          },
          onAnswer: (entry) => setAnswerItem(entry),
          onContinueRun: (entry) => {
            writeJson("run", { mode: "continue", requirementId: entry.id }, entry.root ?? data?.root ?? root).then((result) => {
              if (result?.resumed !== true) throw new Error(result?.message ?? "\u8FD0\u884C\u5C1A\u672A\u7EE7\u7EED\uFF0C\u8BF7\u5237\u65B0\u540E\u68C0\u67E5\u5F53\u524D\u72B6\u6001");
              if (result?.autoAdvanceResumed === false) window.alert(`\u5DF2\u7EE7\u7EED\u672C\u8F6E\uFF0C\u4F46\u81EA\u52A8\u63A8\u8FDB\u672A\u6062\u590D\uFF08${result.autoAdvanceReason}\uFF09\u3002\u9700\u5728\u539F\u751F\u754C\u9762\u68C0\u67E5\u7248\u672C\u4E0E\u6267\u884C\u9884\u7B97\uFF1B\u672A\u65B0\u589E\u6388\u6743\u3002`);
              return reload();
            }).catch((error2) => window.alert(`\u7EE7\u7EED\u5931\u8D25\uFF1A${error2.message}`));
          },
          onResumeRun: (entry) => {
            if (!window.confirm(`\u6062\u590D ${entry.id} \u7684\u672C\u8F6E\u63A8\u8FDB\uFF1F\u4F1A\u65B0\u5EFA\u4E00\u6B21\u8FD0\u884C\u5E76\u4ECE\u4E0A\u6B21\u68C0\u67E5\u70B9\u7EE7\u7EED\u3002`)) return;
            writeJson("run", { mode: "restart", requirementId: entry.id }, root).then((payload) => {
              if (payload?.restarted !== true) window.alert(payload?.message ?? "\u672A\u80FD\u6062\u590D\u63A8\u8FDB");
              return reload();
            }).catch((error2) => window.alert(`\u6062\u590D\u5931\u8D25\uFF1A${error2.message}`));
          },
          narrow
        }) : null,
        defectInboxOpen ? h(DefectInbox, {
          root: data?.root ?? root,
          initial: awaitingDefects,
          onOpen: (entry) => openDefect(entry),
          onSettings: () => {
            setDefectInboxOpen(false);
            setMonitoringOpen(true);
          },
          onClose: () => setDefectInboxOpen(false)
        }) : null,
        defectTarget ? h(DefectModal, {
          defect: defectTarget.defect,
          item: defectTarget.item,
          root: defectTarget.item?.root ?? data?.root ?? root,
          onClose: () => setDefectTarget(null),
          onConfirm: (record) => {
            const next = {
              defect: record ?? defectTarget.defect,
              item: defectTarget.item,
              root: defectTarget.item?.root ?? data?.root ?? root
            };
            setDefectTarget(null);
            setConfirmDefectTarget(next);
          },
          onSettings: () => {
            setDefectTarget(null);
            setMonitoringOpen(true);
          },
          onDone: () => {
            reload();
            loadDefectLedger();
          }
        }) : null,
        confirmDefectTarget ? h(ConfirmDefectModal, {
          defect: confirmDefectTarget.defect,
          item: confirmDefectTarget.item,
          root: confirmDefectTarget.root,
          onClose: () => setConfirmDefectTarget(null),
          onDone: () => {
            setConfirmDefectTarget(null);
            setDefectTarget(null);
            reload();
            loadDefectLedger();
          }
        }) : null,
        monitoringOpen ? h(MonitoringPanel, { root: data?.root ?? root, onClose: () => setMonitoringOpen(false) }) : null,
        feedbackContext ? h(FeedbackDrawer, {
          root: data?.root ?? root,
          context: feedbackContext,
          returnFocus: menuRef.current?.querySelector("button") ?? null,
          onClose: () => setFeedbackContext(null),
          onOpenRequirement: (id, ref) => {
            setFeedbackContext(null);
            setFilter("all");
            setSource("all");
            setKeyword("");
            const targetRoot = typeof ref?.root === "string" ? ref.root : "";
            const currentRoot = data?.root ?? root ?? "";
            const normalise = (value) => String(value ?? "").replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
            if (targetRoot && normalise(targetRoot) !== normalise(currentRoot)) {
              setPendingOpenId(id);
              applyRoot(targetRoot);
              return;
            }
            openRequirementById(id);
            reload();
          }
        }) : null,
        defectToast ? h(DefectToast, {
          toast: defectToast,
          onOpen: (entry) => {
            setDefectToast(null);
            openDefect(entry);
          },
          onClose: () => setDefectToast(null)
        }) : null,
        snapshot ? h(SnapshotModal, { snapshot, onClose: () => setSnapshot(null) }) : null,
        diff ? h(DiffModal, { state: diff, onClose: () => setDiff(null) }) : null,
        startItem ? h(PreflightModal, {
          item: (data?.requirements ?? []).find((entry) => entry.id === startItem.item.id && (!entry.root || entry.root === (startItem.item.root ?? data?.root ?? root))) ?? startItem.item,
          root: startItem.item.root ?? data?.root ?? root,
          projectMeta: projectMetaFor(startItem.item),
          isolate: startItem.isolate,
          onClose: () => setStartItem(null),
          onStarted: () => reload()
        }) : null,
        aiReviewItem ? h(AiReviewModal, {
          item: aiReviewItem,
          root: aiReviewItem.root ?? data?.root ?? root,
          onClose: () => setAiReviewItem(null),
          onDone: () => reload()
        }) : null,
        answerItem ? h(AnswerRunModal, {
          item: answerItem,
          root: answerItem.root ?? data?.root ?? root,
          onClose: () => setAnswerItem(null),
          onDone: () => reload()
        }) : null,
        signoffItem ? h(SignoffModal, {
          item: (data?.requirements ?? []).find((entry) => entry.id === signoffItem.id && (!entry.root || entry.root === (signoffItem.root ?? data?.root ?? root))) ?? signoffItem,
          root: signoffItem.root ?? data?.root ?? root,
          onClose: () => setSignoffItem(null),
          onDone: () => reload()
        }) : null,
        releaseItem ? h(ReleaseModal, {
          item: releaseItem,
          root: releaseItem.root ?? data?.root ?? root,
          onClose: () => setReleaseItem(null),
          onDone: () => reload()
        }) : null,
        rehearsalItem ? h(
          ModalBoundary,
          { key: rehearsalItem.id, onClose: () => setRehearsalItem(null) },
          h(RehearsalModal, {
            item: rehearsalItem,
            root: rehearsalItem.root ?? data?.root ?? root,
            onClose: () => setRehearsalItem(null),
            onDone: () => reload()
          })
        ) : null,
        archiveItem ? h(ArchiveModal, {
          item: archiveItem,
          root: archiveItem.root ?? data?.root ?? root,
          onClose: () => setArchiveItem(null),
          onDone: () => {
            setArchiveItem(null);
            setSelectedId(null);
            reload();
          }
        }) : null,
        removeItem ? h(RemoveModal, {
          item: removeItem,
          root: removeItem.root ?? data?.root ?? root,
          onClose: () => setRemoveItem(null),
          onDone: () => {
            setRemoveItem(null);
            setSelectedId(null);
            reload();
          }
        }) : null,
        acceptanceItem ? h(AcceptanceModal, {
          item: acceptanceItem,
          root: acceptanceItem.root ?? data?.root ?? root,
          onClose: () => setAcceptanceItem(null),
          onDone: () => reload()
        }) : null,
        associateTarget ? h(AssociateModal, {
          workspace: associateTarget,
          onClose: () => setAssociateTarget(null),
          onLinked: (result) => {
            setProjectId(result.id);
            if (typeof localStorage !== "undefined") localStorage.setItem(PROJECT_KEY, result.id);
            loadProjects();
            reload();
          }
        }) : null,
        exchangeOpen ? h(ExchangeModal, { root: exchangeRoot, visibleIds: exportableIds, onClose: () => setExchangeOpen(false), onApplied: reload }) : null,
        createOpen ? h(IntentModal, {
          root: data?.root ?? root,
          project: data?.project ?? currentProject?.projectId,
          projectName: data?.projectName ?? currentProject?.name,
          projectId: data?.project ?? currentProject?.projectId ?? null,
          onClose: () => setCreateOpen(false),
          onCreated: onIntentCreated,
          onOpenRequirement: (id) => {
            setCreateOpen(false);
            openRequirementById(id);
          }
        }) : null,
        traceItem ? h(TraceModal, {
          item: traceItem,
          allItems: items,
          onClose: () => setTraceItem(null),
          onOpenRequirement: (id) => {
            setTraceItem(null);
            openRequirementById(id);
          }
        }) : null
      );
    }
    function RequirementsIcon() {
      return h(
        "svg",
        { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" },
        h("path", {
          d: "M3.5 2.5h6l3 3v8a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z",
          stroke: "currentColor",
          strokeWidth: 1.2
        }),
        h("path", { d: "M5.5 7h5M5.5 10h4", stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round" })
      );
    }
    return {
      inject: ["slots", "layout"],
      apply(ctx) {
        function SettingsPage() {
          const workspace = ctx.get?.("uiWorkspace");
          return h(Workbench, { openPanel: () => ctx.layout.selectPanel("requirements"), onOpenSession: typeof workspace?.openSession === "function" ? (id) => workspace.openSession(id) : void 0 });
        }
        function MainPage() {
          const workspace = ctx.get?.("uiWorkspace");
          return h(Workbench, { onOpenSession: typeof workspace?.openSession === "function" ? (id) => workspace.openSession(id) : void 0 });
        }
        ctx.slots.inject(
          "settings.section",
          () => ctx.slots.register({ name: "settings.section", id: "requirements", order: 91, label: "Requirements" }, SettingsPage)
        );
        ctx.slots.inject(
          "sidebar.panellist",
          () => ctx.slots.register({ name: "sidebar.panellist", id: "requirements", order: 90, label: () => "\u9700\u6C42" }, RequirementsIcon)
        );
        ctx.slots.inject("main", () => ctx.slots.register({ name: "main", key: "requirements" }, MainPage));
      }
    };
  }
});
