
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const state = {
    token: localStorage.getItem("nanii_token") || "",
    user: null,
    history: [],
    study: null,
    source: "youtube",
    mode: "full",
    registering: false,
    busy: false,
    startedAt: 0,
    timer: null,
    notes: "",
    lastPage: "dashboard"
  };

  const pageNames = {
    dashboard: "Dashboard",
    studio: "AI Study Studio",
    reader: "Study Notes",
    library: "My Study Library",
    revision: "Quick Revision"
  };

  const sourceNames = {
    youtube: "YouTube",
    file: "Document",
    image: "Image",
    search: "Topic",
    text: "Text"
  };

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);
  }

  function markdown(value) {
    const text = String(value || "");

    if (window.marked && window.DOMPurify) {
      return DOMPurify.sanitize(
        marked.parse(text, { breaks: true })
      );
    }

    return `<div style="white-space:pre-wrap">${
      escapeHTML(text)
    }</div>`;
  }

  function toast(message) {
    const box = $("toast");
    box.textContent = message;
    box.hidden = false;

    clearTimeout(toast.timeout);
    toast.timeout = setTimeout(() => {
      box.hidden = true;
    }, 4500);
  }

  async function request(path, options = {}, authenticated = true) {
    const headers = { ...(options.headers || {}) };

    if (authenticated) {
      if (!state.token) {
        throw new Error("Please sign in first.");
      }
      headers.Authorization = `Bearer ${state.token}`;
    }

    const response = await fetch("/api" + path, {
      ...options,
      headers
    });

    if (!response.ok) {
      let message = `Request failed (${response.status})`;

      try {
        const result = await response.json();
        message = typeof result.detail === "string"
          ? result.detail
          : JSON.stringify(result.detail || message);
      } catch {}

      if (response.status === 401 && authenticated) {
        logout(false);
      }

      throw new Error(message);
    }

    return response;
  }

  async function json(path, options = {}, authenticated = true) {
    return (await request(path, options, authenticated)).json();
  }

  function localDateKey(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";

    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Unknown date";

    return date.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric"
    });
  }

  function modeName(mode) {
    return mode === "full" ? "Full Notes" : `${mode} Marks`;
  }

  function reviewKey() {
    return `nanii_reviewed_${state.user?.id || "guest"}`;
  }

  function reviewedItems() {
    try {
      return new Set(
        JSON.parse(localStorage.getItem(reviewKey()) || "[]")
          .map(Number)
      );
    } catch {
      return new Set();
    }
  }

  function setReviewed(items) {
    localStorage.setItem(reviewKey(), JSON.stringify([...items]));
  }

  function showAuth() {
    $("authScreen").hidden = false;
    $("workspace").hidden = true;
  }

  function showWorkspace() {
    $("authScreen").hidden = true;
    $("workspace").hidden = false;
  }

  function closeMobileMenu() {
    $("sidebar").classList.remove("open");
    $("mobileOverlay").hidden = true;
  }

  function navigate(page) {
    if (!pageNames[page]) return;

    state.lastPage = page;

    for (const name of Object.keys(pageNames)) {
      $(`${name}Page`).hidden = name !== page;
    }

    $("pageLabel").textContent = pageNames[page];

    document.querySelectorAll("[data-page]").forEach((button) => {
      button.classList.toggle(
        "active",
        button.dataset.page === page
      );
    });

    closeMobileMenu();
    window.scrollTo({ top: 0, behavior: "instant" });

    if (page === "dashboard") renderDashboard();
    if (page === "library") renderLibrary();
    if (page === "revision") renderRevisionOptions();
  }

  function toggleRegistration() {
    state.registering = !state.registering;

    $("nameGroup").hidden = !state.registering;

    $("authTitle").textContent = state.registering
      ? "Create your account."
      : "Welcome back.";

    $("authSubmit").textContent = state.registering
      ? "Create account"
      : "Sign in";

    $("authSwitchText").textContent = state.registering
      ? "Already have an account?"
      : "New to NANII?";

    $("authToggle").textContent = state.registering
      ? "Sign in"
      : "Create an account";

    $("authPassword").autocomplete = state.registering
      ? "new-password"
      : "current-password";

    $("authError").textContent = "";
  }

  async function submitAuth(event) {
    event.preventDefault();

    const email = $("authEmail").value.trim();
    const password = $("authPassword").value;
    const name = $("authName").value.trim();

    if (state.registering && !name) {
      $("authError").textContent = "Enter your name.";
      return;
    }

    const body = state.registering
      ? { name, email, password }
      : { email, password };

    $("authError").textContent = "";
    $("authSubmit").disabled = true;

    try {
      const result = await json(
        state.registering ? "/register" : "/login",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        },
        false
      );

      state.token = result.token;
      state.user = result.user;

      localStorage.setItem("nanii_token", state.token);

      await startApp();
    } catch (error) {
      $("authError").textContent = error.message;
    } finally {
      $("authSubmit").disabled = false;
    }
  }

  function logout(notify = true) {
    state.token = "";
    state.user = null;
    state.study = null;
    state.history = [];

    localStorage.removeItem("nanii_token");
    showAuth();

    if (notify) toast("Signed out.");
  }

  async function loadHistory() {
    const result = await json("/history");

    state.history = Array.isArray(result)
      ? result.sort((a, b) =>
          new Date(b.created_at) - new Date(a.created_at))
      : [];

    renderDashboard();
    renderLibrary();
    renderRevisionOptions();
  }

  function renderDashboard() {
    const lessons = state.history;
    const reviewed = reviewedItems();
    const now = Date.now();

    $("statTotal").textContent = lessons.length;

    $("statWeek").textContent = lessons.filter((item) => {
      const time = new Date(item.created_at).getTime();
      return time <= now && now - time < 7 * 86400000;
    }).length;

    $("statDays").textContent = new Set(
      lessons.map((x) => localDateKey(x.created_at))
        .filter(Boolean)
    ).size;

    $("statReviewed").textContent = lessons.filter(
      (x) => reviewed.has(Number(x.id))
    ).length;

    const latest = lessons[0];

    $("continueButton").disabled = !latest;
    $("continueTitle").textContent = latest
      ? latest.title
      : "Your first lesson starts here.";

    $("continueSubtitle").textContent = latest
      ? "Pick up where you left off."
      : "Create notes from a YouTube lecture, document or topic.";

    $("continueMeta").replaceChildren();

    if (latest) {
      for (const label of [
        sourceNames[latest.source_type] || "Study",
        modeName(latest.mode),
        formatDate(latest.created_at)
      ]) {
        const chip = document.createElement("span");
        chip.textContent = label;
        $("continueMeta").appendChild(chip);
      }
    }

    renderLessons($("recentLessons"), lessons.slice(0, 5), false);
    renderActivity();
  }

  function renderActivity() {
    const container = $("activityChart");
    container.replaceChildren();

    const counts = {};

    for (const lesson of state.history) {
      const key = localDateKey(lesson.created_at);
      if (key) counts[key] = (counts[key] || 0) + 1;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(today);
      date.setDate(date.getDate() - (6 - index));

      return {
        date,
        count: counts[localDateKey(date)] || 0
      };
    });

    const maximum = Math.max(1, ...days.map((day) => day.count));
    let total = 0;

    days.forEach((day, index) => {
      total += day.count;

      const wrap = document.createElement("div");
      wrap.className = "activity-day";

      const bar = document.createElement("div");
      bar.className = "activity-bar";

      if (index === 6) bar.classList.add("today");

      bar.style.height =
        `${Math.max(4, day.count / maximum * 115)}px`;

      bar.title = `${day.count} lessons`;

      const label = document.createElement("small");
      label.textContent = day.date.toLocaleDateString(
        "en-IN", { weekday: "short" }
      );

      wrap.append(bar, label);
      container.appendChild(wrap);
    });

    $("activityText").textContent =
      `${total} lesson(s) created in the last 7 days.`;
  }

  function renderLessons(container, lessons, allowDelete) {
    container.replaceChildren();

    if (!lessons.length) {
      const empty = document.createElement("p");
      empty.className = "empty-list";
      empty.textContent = "No lessons found.";
      container.appendChild(empty);
      return;
    }

    for (const lesson of lessons) {
      const row = document.createElement("div");
      row.className = "lesson-item";

      const icon = document.createElement("span");
      icon.className = "lesson-icon";
      icon.textContent = ({
        youtube: "▶",
        file: "▤",
        image: "▧",
        text: "✎",
        search: "⌕"
      })[lesson.source_type] || "▤";

      const details = document.createElement("div");
      details.className = "lesson-details";

      const title = document.createElement("strong");
      title.textContent = lesson.title;

      const meta = document.createElement("small");
      meta.textContent = [
        sourceNames[lesson.source_type] || "Study",
        modeName(lesson.mode),
        formatDate(lesson.created_at),
        reviewedItems().has(Number(lesson.id))
          ? "Reviewed" : ""
      ].filter(Boolean).join(" · ");

      details.append(title, meta);

      const actions = document.createElement("div");
      actions.className = "lesson-actions";

      const read = document.createElement("button");
      read.className = "small-button";
      read.textContent = "Read ↗";
      read.onclick = () => openStudy(lesson.id);
      actions.appendChild(read);

      if (allowDelete) {
        const remove = document.createElement("button");
        remove.className = "small-button danger";
        remove.textContent = "Delete";
        remove.onclick = () => deleteStudy(lesson.id);
        actions.appendChild(remove);
      }

      row.append(icon, details, actions);
      container.appendChild(row);
    }
  }

  function renderLibrary() {
    const query = $("librarySearch").value.trim().toLowerCase();
    const filter = $("libraryFilter").value;

    const filtered = state.history.filter((item) => (
      (!query || item.title.toLowerCase().includes(query)) &&
      (!filter || item.source_type === filter)
    ));

    renderLessons($("libraryList"), filtered, true);
  }

  async function deleteStudy(id) {
    if (!confirm("Delete this saved lesson?")) return;

    try {
      await request(`/study/${id}`, { method: "DELETE" });

      if (state.study?.id === id) state.study = null;

      await loadHistory();
      toast("Study deleted.");
    } catch (error) {
      toast(error.message);
    }
  }

  function renderRevisionOptions() {
    const select = $("revisionStudy");
    const previous = select.value;

    select.replaceChildren();

    for (const lesson of state.history) {
      const option = document.createElement("option");
      option.value = lesson.id;
      option.textContent = lesson.title;
      select.appendChild(option);
    }

    if (state.history.some((x) => String(x.id) === previous)) {
      select.value = previous;
    }

    if (!state.history.length) {
      const option = document.createElement("option");
      option.textContent = "No saved lessons";
      option.value = "";
      select.appendChild(option);
    }
  }

  function selectSource(source) {
    state.source = source;

    $("youtubeFields").hidden = source !== "youtube";
    $("uploadFields").hidden = source !== "upload";
    $("searchFields").hidden = source !== "search";

    document.querySelectorAll("[data-source]").forEach((button) => {
      button.classList.toggle(
        "active",
        button.dataset.source === source
      );
    });
  }

  function selectMode(mode) {
    state.mode = mode;

    document.querySelectorAll("[data-mode]").forEach((button) => {
      button.classList.toggle(
        "active",
        button.dataset.mode === mode
      );
    });
  }

  function setGenerating(busy) {
    state.busy = busy;
    $("generateButton").disabled = busy;
    $("generationProgress").hidden = !busy;

    if (state.timer) clearInterval(state.timer);

    if (busy) {
      state.startedAt = Date.now();
      $("progressTitle").textContent =
        "Processing source and generating notes...";

      state.timer = setInterval(() => {
        const seconds = Math.floor(
          (Date.now() - state.startedAt) / 1000
        );

        $("progressTime").textContent =
          `Processing: ${seconds} seconds`;
      }, 1000);
    } else {
      state.timer = null;
    }
  }

  async function generateStudy() {
    if (state.busy) return;

    const subject = $("subjectInput").value.trim();
    const mode = state.mode;

    $("studyError").textContent = "";

    let promise;

    try {
      if (state.source === "youtube") {
        const source = $("videoUrl").value.trim();

        if (!source) throw new Error("Enter a YouTube URL.");

        promise = json("/study", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source_type: "youtube",
            source,
            mode,
            subject
          })
        });
      } else if (state.source === "upload") {
        const file = $("studyFile").files[0];

        if (!file) throw new Error("Choose a file.");

        if (file.size > 20 * 1024 * 1024) {
          throw new Error("Maximum upload size is 20 MB.");
        }

        const form = new FormData();
        form.append("file", file);
        form.append("mode", mode);
        form.append("subject", subject);

        promise = json("/upload", {
          method: "POST",
          body: form
        });
      } else {
        const topic = $("topicInput").value.trim();

        if (topic.length < 3) {
          throw new Error("Enter a topic of at least 3 characters.");
        }

        const params = new URLSearchParams({
          q: topic,
          mode,
          subject
        });

        promise = json(`/search?${params}`);
      }

      setGenerating(true);

      const result = await promise;

      state.study = {
        ...result,
        source_type: state.source,
        mode,
        summary: result.summary || ""
      };

      state.notes = result.summary || "";

      displayStudy(state.study);

      navigate("reader");

      try {
        await loadHistory();
      } catch (error) {
        toast("Study saved, but history refresh failed.");
      }
    } catch (error) {
      $("studyError").textContent = error.message;
      toast(error.message);
    } finally {
      setGenerating(false);
    }
  }

  function displayStudy(study) {
    $("readerTitle").textContent =
      study.title || "Study Notes";

    $("readerMeta").textContent =
      `${modeName(study.mode || state.mode)} · NANII Study Material`;

    $("studyNotes").innerHTML = markdown(study.summary);

    state.notes = study.summary || "";

    const incomplete = Boolean(study.truncated);

    $("readerWarning").hidden = !incomplete;

    $("readerWarning").textContent = incomplete
      ? "Source processing was incomplete or some content may be missing. Check the study notes against the original source."
      : "";

    $("readerMessage").textContent = "";

    $("chatMessages").replaceChildren();

    updateReviewedButton();

    $("notesButton").classList.add("selected");

    // Generated source frames must remain clickable images.
    $("studyNotes").querySelectorAll("img").forEach((img) => {
      img.loading = "lazy";
      img.addEventListener("error", () => {
        img.alt = "Source image unavailable";
      });
    });
  }

  async function openStudy(id) {
    try {
      const result = await json(`/study/${id}`);

      state.study = result;
      displayStudy(result);
      navigate("reader");
    } catch (error) {
      toast(error.message);
    }
  }

  function updateReviewedButton() {
    if (!state.study) return;

    const reviewed = reviewedItems().has(
      Number(state.study.id)
    );

    $("reviewButton").textContent = reviewed
      ? "✓ Reviewed"
      : "Mark reviewed";
  }

  function toggleReviewed() {
    if (!state.study) return;

    const reviewed = reviewedItems();
    const id = Number(state.study.id);

    if (reviewed.has(id)) reviewed.delete(id);
    else reviewed.add(id);

    setReviewed(reviewed);
    updateReviewedButton();
    renderDashboard();
    renderLibrary();
  }

  async function showRevision(kind, id = null) {
    const studyId = id || state.study?.id;

    if (!studyId) {
      toast("Select a saved lesson first.");
      return;
    }

    const message = "Generating revision...";
    $("readerMessage").textContent = message;
    $("revisionMessage").textContent = message;

    try {
      const result = await json("/revision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          study_id: Number(studyId),
          kind
        })
      });

      if (!state.study || Number(state.study.id) !== Number(studyId)) {
        const lesson = await json(`/study/${studyId}`);
        state.study = lesson;
        state.notes = lesson.summary || "";
        $("readerTitle").textContent = lesson.title;
        $("readerMeta").textContent = modeName(lesson.mode);
      }

      $("studyNotes").innerHTML = markdown(result.content || "");
      $("readerMessage").textContent =
        `Showing ${kind}. Click Study notes to return.`;

      $("revisionMessage").textContent = "";
      $("notesButton").classList.remove("selected");

      navigate("reader");
    } catch (error) {
      $("readerMessage").textContent = error.message;
      $("revisionMessage").textContent = error.message;
      toast(error.message);
    }
  }

  function restoreNotes() {
    $("studyNotes").innerHTML = markdown(state.notes);
    $("readerMessage").textContent = "";
    $("notesButton").classList.add("selected");
  }

  async function downloadPDF() {
    if (!state.study?.id) return;

    $("readerMessage").textContent = "Preparing PDF...";

    try {
      const response = await request(
        `/study/${state.study.id}/pdf`
      );

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = url;
      link.download = `NANII_Study_${state.study.id}.pdf`;

      document.body.appendChild(link);
      link.click();
      link.remove();

      setTimeout(() => URL.revokeObjectURL(url), 5000);

      $("readerMessage").textContent = "PDF download started.";
    } catch (error) {
      $("readerMessage").textContent = error.message;
    }
  }

  function addChatBubble(role, text) {
    const bubble = document.createElement("div");
    bubble.className = `chat-bubble ${role}`;
    bubble.innerHTML = markdown(text);
    $("chatMessages").appendChild(bubble);
  }

  async function askQuestion(event) {
    event.preventDefault();

    const question = $("chatQuestion").value.trim();

    if (!question || !state.study?.id) return;

    addChatBubble("user", question);
    $("chatQuestion").value = "";
    $("chatButton").disabled = true;

    try {
      const result = await json("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          study_id: state.study.id,
          question
        })
      });

      addChatBubble("assistant", result.answer);
    } catch (error) {
      addChatBubble("assistant", `Error: ${error.message}`);
    } finally {
      $("chatButton").disabled = false;
    }
  }

  async function loadAIStatus() {
    try {
      const status = await json("/ai-status");

      const online =
        status.connected &&
        status.text_model_available;

      $("aiDot").className = online ? "online" : "offline";
      $("aiStatus").textContent = online
        ? "AI Connected"
        : "AI Unavailable";
    } catch {
      $("aiDot").className = "offline";
      $("aiStatus").textContent = "AI Offline";
    }
  }

  async function startApp() {
    try {
      const user = await json("/me");
      state.user = user;

      showWorkspace();

      const firstName = (user.name || "Student")
        .trim()
        .split(/\s+/)[0];

      $("welcomeTitle").textContent =
        `Welcome back, ${firstName}.`;

      $("userAvatar").textContent =
        firstName.charAt(0).toUpperCase();

      $("todayLabel").textContent =
        new Date().toLocaleDateString("en-IN", {
          weekday: "long",
          day: "numeric",
          month: "long"
        }).toUpperCase();

      navigate("dashboard");

      await Promise.allSettled([
        loadHistory(),
        loadAIStatus()
      ]);
    } catch {
      logout(false);
    }
  }

  function setupEvents() {
    $("authToggle").onclick = toggleRegistration;
    $("authForm").addEventListener("submit", submitAuth);

    $("logoutButton").onclick = () => logout();

    document.querySelectorAll("[data-page]").forEach((button) => {
      button.onclick = () => navigate(button.dataset.page);
    });

    document.querySelectorAll("[data-go]").forEach((button) => {
      button.onclick = () => navigate(button.dataset.go);
    });

    $("menuToggle").onclick = () => {
      $("sidebar").classList.add("open");
      $("mobileOverlay").hidden = false;
    };

    $("mobileOverlay").onclick = closeMobileMenu;

    document.querySelectorAll("[data-source]").forEach((button) => {
      button.onclick = () => selectSource(button.dataset.source);
    });

    document.querySelectorAll("[data-mode]").forEach((button) => {
      button.onclick = () => selectMode(button.dataset.mode);
    });

    $("studyFile").onchange = () => {
      $("selectedFile").textContent =
        $("studyFile").files[0]?.name || "No file selected";
    };

    $("generateButton").onclick = generateStudy;

    $("librarySearch").oninput = renderLibrary;
    $("libraryFilter").onchange = renderLibrary;

    $("continueButton").onclick = () => {
      if (state.history[0]) openStudy(state.history[0].id);
    };

    document.querySelectorAll("[data-quick]").forEach((button) => {
      button.onclick = () => {
        const latest = state.history[0];

        if (!latest) {
          toast("Create a lesson first.");
          navigate("studio");
          return;
        }

        showRevision(button.dataset.quick, latest.id);
      };
    });

    document.querySelectorAll("[data-revision]").forEach((button) => {
      button.onclick = () =>
        showRevision(button.dataset.revision);
    });

    document.querySelectorAll("[data-kind]").forEach((button) => {
      button.onclick = () =>
        showRevision(
          button.dataset.kind,
          $("revisionStudy").value
        );
    });

    $("notesButton").onclick = restoreNotes;
    $("reviewButton").onclick = toggleReviewed;
    $("pdfButton").onclick = downloadPDF;

    $("chatForm").addEventListener("submit", askQuestion);

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMobileMenu();
    });
  }

  setupEvents();

  if (state.token) startApp();
  else showAuth();
})();
