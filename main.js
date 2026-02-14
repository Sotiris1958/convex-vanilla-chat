import "./style.css";
import { ConvexClient } from "convex/browser";
import { api } from "./convex/_generated/api.js";
import { Clerk } from "@clerk/clerk-js";

// -------------------- init --------------------
const convex = new ConvexClient(import.meta.env.VITE_CONVEX_URL);
const clerk = new Clerk(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const app = document.getElementById("app");

// This is the REAL identity subject used by Convex auth (stable across sessions).
let mySubject = null;
const presenceSessionId =
  localStorage.getItem("presenceSessionId") ??
  (() => {
    const id = crypto.randomUUID();
    localStorage.setItem("presenceSessionId", id);
    return id;
  })();

// -------------------- tiny router --------------------
function navigate(path) {
  history.pushState({}, "", path);
  renderRoute().catch(console.error);
}
window.addEventListener("popstate", () => renderRoute().catch(console.error));

function currentPath() {
  return window.location.pathname || "/";
}

// -------------------- helpers --------------------
function escapeHtml(s) {
  return (s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}
function pad(n) {
  return n.toString().padStart(2, "0");
}
function formatTime(ms) {
  const d = new Date(ms);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

// -------------------- Convex auth via Clerk token --------------------
function wireConvexAuth() {
  convex.setAuth(async () => {
    if (!clerk.session) return null;
    return await clerk.session.getToken({ template: "convex" });
  });
}

// -------------------- /sign-in --------------------
async function renderSignIn() {
  app.innerHTML = `
    <div style="max-width: 420px; margin: 40px auto; padding: 0 12px;">
      <h1>Sign in</h1>
      <div id="sign-in"></div>
    </div>
  `;
  clerk.mountSignIn(document.getElementById("sign-in"));

  const stop = clerk.addListener(() => {
    if (clerk.isSignedIn) {
      stop();
      navigate("/chat");
    }
  });
}

// -------------------- /chat state --------------------
let unsubMessages = null;
let unsubPresence = null;
let unsubTyping = null;

let heartbeatTimer = null;
let typingPollTimer = null;

let typingThrottleTimer = null;
let typingStopTimer = null;

// inline edit state
let editingId = null;
let editingText = "";

// -------------------- room helpers --------------------
function roomValue() {
  const roomInput = document.getElementById("room");
  const r = (roomInput?.value ?? "").trim();
  return r || "general";
}

// -------------------- presence/typing render --------------------
function renderOnlineUsers(users) {
  const box = document.getElementById("onlineUsers");
  if (!box) return;

  const names = (users ?? []).map((u) => u.name);
  box.innerHTML =
    names.length === 0
      ? `<span style="opacity:.7;">Online: (nobody)</span>`
      : `<span style="opacity:.7;">Online (${names.length}):</span> ${names
          .map((n) => `<span class="pill">${escapeHtml(n)}</span>`)
          .join(" ")}`;
}

function renderTyping(users) {
  const box = document.getElementById("typingUsers");
  if (!box) return;

  const names = (users ?? []).map((u) => u.name);
  if (names.length === 0) {
    box.innerHTML = "";
    return;
  }

  box.innerHTML = `<span style="opacity:.7;">Typing:</span> ${names
    .map((n) => `<span class="pill">${escapeHtml(n)}</span>`)
    .join(" ")}`;
}

// -------------------- message render --------------------
function renderMessages(messagesDesc) {
  const list = document.getElementById("messages");
  const messages = [...(messagesDesc ?? [])].reverse(); // oldest -> newest

  list.innerHTML = messages
    .map((m) => {
      const t = formatTime(m._creationTime);

      // ✅ Correct ownership check (works across Google/email/etc.)
      const isMine = mySubject && m.authorId === mySubject;

      const isEditing = editingId === m._id;

      const actions = isMine
        ? `<span class="actions">
             <button class="linkbtn" data-action="edit" data-id="${m._id}">Edit</button>
             <button class="linkbtn" data-action="delete" data-id="${m._id}">Delete</button>
           </span>`
        : "";

      const bodyHtml = isEditing
        ? `<div class="editbox">
             <input id="editInput" value="${escapeHtml(editingText)}" />
             <div class="edithelp">Enter = save • Esc = cancel</div>
           </div>`
        : `<div class="body">${escapeHtml(m.body)}</div>`;

      return `
        <li>
          <div class="meta">
            <span class="time">${escapeHtml(t)}</span>
            <span class="author">${escapeHtml(m.author)}:</span>
            ${actions}
          </div>
          ${bodyHtml}
        </li>`;
    })
    .join("");

  // scroll
  const scroller = list.parentElement;
  scroller.scrollTop = scroller.scrollHeight;

  // wire actions
  list.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const action = btn.dataset.action;
      const id = btn.dataset.id;

      if (action === "edit") {
        // Start edit mode
        const msg = messages.find((x) => x._id === id);
        if (!msg) return;

        editingId = id;
        editingText = msg.body;
        renderMessages(messagesDesc);

        // focus input
        const input = document.getElementById("editInput");
        if (input) {
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);

          input.addEventListener("keydown", async (e) => {
            if (e.key === "Escape") {
              editingId = null;
              editingText = "";
              refreshMessages().catch(console.error);
              return;
            }
            if (e.key === "Enter") {
              const newBody = input.value;
              try {
                await convex.mutation(api.messages.edit, { id, body: newBody });
                editingId = null;
                editingText = "";
                refreshMessages().catch(console.error);
              } catch (err) {
                console.error("edit failed:", err);
                alert("Edit failed (check console).");
              }
            }
          });

          input.addEventListener("input", () => {
            editingText = input.value;
          });
        }
      }

      if (action === "delete") {
        const ok = confirm("Delete this message?");
        if (!ok) return;

        try {
          await convex.mutation(api.messages.remove, { id });
        } catch (err) {
          console.error("delete failed:", err);
          alert("Delete failed (check console).");
        }
      }
    });
  });
}

// -------------------- refreshers --------------------
async function refreshMessages() {
  const room = roomValue();
  const data = await convex.query(api.messages.listByRoom, { room, limit: 100 });
  renderMessages(data);
}

async function refreshPresence() {
  const room = roomValue();
  const users = await convex.query(api.presence.listOnlineByRoom, { room });
  renderOnlineUsers(users);
}

async function refreshTyping() {
  const room = roomValue();
  const users = await convex.query(api.typing.listByRoom, { room });
  renderTyping(users);
}

// -------------------- presence heartbeat --------------------
async function heartbeat() {
  if (!clerk.isSignedIn) return;     // ✅ add this line
  const room = roomValue();
  try {
    await convex.mutation(api.presence.heartbeat, { room });
  } catch (e) {
    console.error("heartbeat failed:", e);
  }
}


// -------------------- typing helpers --------------------
async function typingPing() {
  if (!clerk.isSignedIn) return;
  const room = roomValue();
  try {
    await convex.mutation(api.typing.ping, { room });
  } catch (e) {
    console.error("typing ping failed:", e);
  }
}
async function typingStop() {
  if (!clerk.isSignedIn) return;
  const room = roomValue();
  try {
    await convex.mutation(api.typing.stop, { room });
  } catch {}
}
function onUserTyping() {
  if (!typingThrottleTimer) {
    typingThrottleTimer = setTimeout(() => {
      typingThrottleTimer = null;
    }, 800);
    typingPing().catch(console.error);
  }
  if (typingStopTimer) clearTimeout(typingStopTimer);
  typingStopTimer = setTimeout(() => {
    typingStop().catch(console.error);
  }, 1200);
}

// -------------------- subscriptions --------------------
function stopRoomSubscriptions() {
  if (unsubMessages) unsubMessages();
  unsubMessages = null;
  if (unsubPresence) unsubPresence();
  unsubPresence = null;
  if (unsubTyping) unsubTyping();
  unsubTyping = null;

  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;

  if (typingPollTimer) clearInterval(typingPollTimer);
  typingPollTimer = null;

  if (typingThrottleTimer) clearTimeout(typingThrottleTimer);
  typingThrottleTimer = null;

  if (typingStopTimer) clearTimeout(typingStopTimer);
  typingStopTimer = null;

  // cancel edit when switching rooms
  editingId = null;
  editingText = "";
}

function resubscribeRoom() {
  typingStop().catch(() => {});
  stopRoomSubscriptions();

  const room = roomValue();

  unsubMessages = convex.onUpdate(
    api.messages.listByRoom,
    { room, limit: 100 },
    () => refreshMessages().catch(console.error)
  );
  unsubPresence = convex.onUpdate(
    api.presence.listOnlineByRoom,
    { room },
    () => refreshPresence().catch(console.error)
  );
  unsubTyping = convex.onUpdate(
    api.typing.listByRoom,
    { room },
    () => refreshTyping().catch(console.error)
  );

  refreshMessages().catch(console.error);
  refreshPresence().catch(console.error);
  refreshTyping().catch(console.error);

  heartbeat().catch(console.error);
  heartbeatTimer = setInterval(() => heartbeat().catch(console.error), 10_000);

  typingPollTimer = setInterval(() => refreshTyping().catch(console.error), 1_000);
}

// -------------------- /chat render --------------------
async function renderChat() {
  if (!clerk.isSignedIn) {
    navigate("/sign-in");
    return;
  }

  // ✅ fetch my identity subject once (used for edit/delete ownership)
  try {
    mySubject = (await convex.query(api.users.me, {}))?.subject ?? null;
  } catch (e) {
    console.error("Failed to load my subject:", e);
    mySubject = null;
  }

  app.innerHTML = `
    <div id="chatApp" style="max-width: 900px; margin: 0 auto; padding: 16px; display: grid; gap: 12px;">
      <header style="display:grid; gap:10px;">
        <h1 style="margin:0;">Convex Vanilla Chat</h1>

        <div style="display:flex; gap:12px; align-items:end; flex-wrap:wrap; justify-content:space-between;">
          <div style="display:flex; gap:12px; align-items:end; flex-wrap:wrap;">
            <div id="user-button"></div>

            <label style="display:grid; gap:6px;">
              Room
              <input id="room" placeholder="general" />
            </label>
          </div>

          <div style="text-align:right; display:grid; gap:6px;">
            <div id="onlineUsers"></div>
            <div id="typingUsers"></div>
          </div>
        </div>
      </header>

      <main style="border:1px solid #ddd; border-radius:10px; height:55vh; overflow:auto; padding:10px;">
        <ul id="messages" style="list-style:none; padding:0; margin:0; display:grid; gap:8px;"></ul>
      </main>

      <footer>
        <form id="form" style="display:grid; grid-template-columns: 1fr auto; gap:10px;">
          <input id="text" placeholder="Type a message…" autocomplete="off" />
          <button type="submit">Send</button>
        </form>
      </footer>
    </div>
  `;

  // small styles
  const style = document.createElement("style");
  style.textContent = `
    .pill { display:inline-block; padding:2px 8px; border:1px solid #ddd; border-radius:999px; margin-left:6px; font-size:12px; }
    .meta { display:flex; gap:10px; align-items:baseline; }
    .time { font-size:12px; opacity:0.7; }
    .body { margin-top:4px; }
    .actions { margin-left:auto; display:flex; gap:10px; }
    .linkbtn { background:none; border:none; padding:0; cursor:pointer; text-decoration:underline; opacity:.75; }
    .linkbtn:hover { opacity:1; }
    .editbox { display:grid; gap:6px; margin-top:6px; }
    .edithelp { font-size:12px; opacity:.7; }
    #editInput { width:100%; }
  `;
  document.head.appendChild(style);

  clerk.mountUserButton(document.getElementById("user-button"));

  const roomInput = document.getElementById("room");
  roomInput.value = localStorage.getItem("chatRoom") ?? "general";
  roomInput.addEventListener("input", () =>
    localStorage.setItem("chatRoom", roomInput.value)
  );

  // subscribe initial + debounce resubscribe on room change
  resubscribeRoom();
  let t = null;
  roomInput.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(resubscribeRoom, 200);
  });

  // typing events
  const text = document.getElementById("text");
  text.addEventListener("input", onUserTyping);

  // send
  const form = document.getElementById("form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const room = roomValue();
    const body = text.value;

    text.value = "";
    text.focus();

    try {
      await convex.mutation(api.messages.send, { room, body });
      typingStop().catch(() => {});
    } catch (err) {
      console.error("send failed:", err);
    }
  });

  window.addEventListener("beforeunload", () => {
    try {
      convex.mutation(api.presence.leave, { room: roomValue() });
      convex.mutation(api.typing.stop, { room: roomValue() });
    } catch {}
  });
}

// -------------------- route rendering --------------------
async function renderRoute() {
  if (!clerk.loaded) return;
  if (currentPath() !== "/chat") {
    stopRoomSubscriptions?.(); // if function exists in your file
  }
  if (currentPath() === "/chat") return renderChat();
  return renderSignIn();
}

// -------------------- boot --------------------
await clerk.load();
wireConvexAuth();

if (currentPath() === "/") {
  navigate(clerk.isSignedIn ? "/chat" : "/sign-in");
} else {
  renderRoute().catch(console.error);
}
