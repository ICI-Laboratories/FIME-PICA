/*****************************************************
  1. OBTENCIÓN DE ELEMENTOS DEL DOM
*****************************************************/
const toggleChatBtn = document.getElementById("toggle-chat-btn");
const transformCont = document.getElementById("transform-container");
const closeChatBtn  = document.getElementById("close-chat-btn");

const chatInput   = document.querySelector(".chat-input textarea");
const sendChatBtn = document.getElementById("send-btn");
const chatbox     = document.querySelector(".chatbox");

/*****************************************************
  2. VARIABLES GLOBALES
*****************************************************/
let isSending = false;
const chatHistory     = [];
const inputInitHeight = chatInput.scrollHeight;

// Nginx reenvía esta ruta al servicio FastAPI dentro de Docker.
const FASTAPI_ENDPOINT = "/api/chat";

function setSending(sending) {
  isSending = sending;
  chatInput.disabled = sending;
  sendChatBtn.disabled = sending;
  chatbox.setAttribute("aria-busy", String(sending));
  document.querySelectorAll("[data-question]").forEach(button => { button.disabled = sending; });
}

toggleChatBtn.addEventListener("click", () => {
  const open = transformCont.classList.toggle("show-chat");
  toggleChatBtn.setAttribute("aria-expanded", String(open));
  if (open) chatInput.focus();
});

closeChatBtn.addEventListener("click", () => {
  transformCont.classList.remove("show-chat");
  toggleChatBtn.setAttribute("aria-expanded", "false");
  toggleChatBtn.focus();
});

/*****************************************************
  4. FUNCIONES DE RENDERIZADO Y CREACIÓN DE MENSAJES
*****************************************************/
// Render a small Markdown subset as DOM nodes; never interpret reply HTML.
function appendInline(parent, text) {
  const pattern = /\[([^\]]+)\]\(([^\s)]+)\)|\*\*([^*]+)\*\*/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    parent.append(document.createTextNode(text.slice(cursor, match.index)));
    if (match[3]) {
      const strong = document.createElement("strong");
      strong.textContent = match[3];
      parent.append(strong);
    } else {
      let safe = false;
      try {
        const url = new URL(match[2], window.location.origin);
        safe = (url.origin === window.location.origin && match[2].startsWith("/")) ||
          (url.protocol === "https:" && (url.hostname === "ucol.mx" || url.hostname.endsWith(".ucol.mx")));
      } catch { /* Invalid links remain plain text. */ }
      if (safe) {
        const link = document.createElement("a");
        link.textContent = match[1];
        link.href = match[2];
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        parent.append(link);
      } else {
        parent.append(document.createTextNode(match[1]));
      }
    }
    cursor = match.index + match[0].length;
  }
  parent.append(document.createTextNode(text.slice(cursor)));
}

function renderMarkdown(element, text) {
  const fragment = document.createDocumentFragment();
  let list = null;
  for (const line of text.split("\n")) {
    const item = line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)$/);
    if (item) {
      if (!list) { list = document.createElement("ul"); fragment.append(list); }
      const li = document.createElement("li");
      appendInline(li, item[1]);
      list.append(li);
    } else {
      list = null;
      if (!line.trim()) continue;
      const paragraph = document.createElement("p");
      appendInline(paragraph, line.replace(/^#{1,6}\s+/, ""));
      fragment.append(paragraph);
    }
  }
  element.replaceChildren(fragment);
}

function createChatLi(message, className) {
  const li = document.createElement("li");
  li.classList.add("chat", className);

  const isThinking = message === "Pensando...";
  if (className === "incoming") {
    const icon = document.createElement("span");
    icon.classList.add("material-symbols-outlined");
    icon.textContent = "smart_toy";
    li.appendChild(icon);
  }

  const bubble = document.createElement("div");
  bubble.classList.add("chat-bubble");
  if (isThinking) {
    bubble.classList.add("thinking-animation");
    bubble.textContent = message;
  } else if (className === "incoming") {
    renderMarkdown(bubble, message);
  } else {
    bubble.textContent = message;
  }
  li.appendChild(bubble);

  return li;
}

/*****************************************************
  5. COMUNICACIÓN CON EL BACKEND (STREAMING SSE + MD)
*****************************************************/
async function generateResponse(incomingChatLi) {
  const bubble = incomingChatLi.querySelector(".chat-bubble") || incomingChatLi.querySelector("p");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(FASTAPI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      signal: controller.signal,
      body: JSON.stringify({
        // Previous assistant text is ignored by the server; bound it to keep
        // long conversations inside the request's total size limit.
        messages: chatHistory.slice(-13).map(message => ({
          role: message.role,
          content: message.content.slice(0, message.role === "user" ? 1200 : 3000)
        })),
        stream: true,
        think: false
      }),
    });

    if (!res.ok) {
      throw new Error(res.status === 429
        ? "Has enviado varias consultas seguidas. Espera un minuto y vuelve a intentar."
        : "No pude completar la consulta. Intenta de nuevo en unos momentos.");
    }

    bubble.classList.remove("thinking-animation");
    bubble.textContent = "";

    const contentType = res.headers.get("content-type") || "";
    let botMessage = "";
    if (contentType.includes("text/event-stream") && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop(); // Guardar fragmento incompleto

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data:")) continue;
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === "[DONE]") continue;

          try {
            const parsed = JSON.parse(dataStr);
            const delta = parsed.choices?.[0]?.delta?.content || "";
            if (delta) {
              botMessage += delta;
              renderMarkdown(bubble, botMessage);
              scrollChat();
            }
          } catch {
            // Ignorar chunks incompletos
          }
        }
      }

      if (!botMessage.trim()) throw new Error("No recibí una respuesta. Vuelve a intentar.");
    } else {
      // Fallback JSON no streaming
      const data = await res.json();
      botMessage = data?.message?.content || "No hay una respuesta disponible. Intenta de nuevo.";
      renderMarkdown(bubble, botMessage);
    }

    chatHistory.push({ role: "assistant", content: botMessage });
    if (chatHistory.length > 12) chatHistory.splice(0, chatHistory.length - 12);
  } catch (err) {
    if (chatHistory.at(-1)?.role === "user") chatHistory.pop();
    bubble.classList.remove("thinking-animation");
    bubble.textContent = err.name === "AbortError"
      ? "La consulta tardó demasiado. Intenta de nuevo."
      : (err instanceof TypeError ? "No hay conexión con FimeBot. Revisa tu conexión e intenta de nuevo." : err.message);
    bubble.classList.add("error");
  } finally {
    clearTimeout(timeout);
    setSending(false);
    chatInput.focus();
    scrollChat();
  }
}

/*****************************************************
  6. MANEJO DEL ENVÍO DE MENSAJES
*****************************************************/
function handleChat() {
  if (isSending) return;

  const userMessage = chatInput.value.trim().slice(0, 1200);
  if (!userMessage) return;

  setSending(true);

  chatInput.value = "";
  chatInput.style.height = `${inputInitHeight}px`;

  // Agregar el mensaje del usuario al historial
  chatHistory.push({ role: "user", content: userMessage });

  // Crear y mostrar el mensaje del usuario
  const outgoingLi = createChatLi(userMessage, "outgoing");
  chatbox.appendChild(outgoingLi);
  scrollChat();

  // Mostrar el indicador "Pensando..." y comenzar streaming inmediatamente
  setTimeout(() => {
    const incomingLi = createChatLi("Pensando...", "incoming");
    chatbox.appendChild(incomingLi);
    scrollChat();
    generateResponse(incomingLi);
  }, 100);
}
/*****************************************************
  7. AJUSTE AUTOMÁTICO DE ALTURA DEL TEXTAREA
*****************************************************/
chatInput.addEventListener("input", () => {
  chatInput.style.height = `${inputInitHeight}px`;
  chatInput.style.height = `${chatInput.scrollHeight}px`;
});
/*****************************************************
  8. ENVÍO DE MENSAJES (ENTER Y BOTÓN)
*****************************************************/
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && window.innerWidth > 800) {
    e.preventDefault();
    handleChat();
  }
});
sendChatBtn.addEventListener("click", handleChat);
document.querySelectorAll("[data-question]").forEach(button => {
  button.addEventListener("click", () => {
    if (isSending) return;
    chatInput.value = button.dataset.question;
    handleChat();
  });
});

function scrollChat() {
  const container = document.querySelector(".chat-content");
  container.scrollTop = container.scrollHeight;
}
/*****************************************************
  9. CARRUSEL FUNCIONAL
*****************************************************/
const carousel = document.querySelector(".carousel");
const slides = document.querySelectorAll(".slide");

const prevBtn = document.getElementById("prev-slide");
const nextBtn = document.getElementById("next-slide");

let currentIndex = 0;

function showSlide(index) {
  if (index < 0) {
    index = slides.length - 1;
  } else if (index >= slides.length) {
    index = 0;
  }

  const offset = index * 100;
  carousel.style.transform = `translateX(-${offset}%)`;

  currentIndex = index;
}

prevBtn.addEventListener("click", () => {
  showSlide(currentIndex - 1);
});
nextBtn.addEventListener("click", () => {
  showSlide(currentIndex + 1);
});

 setInterval(() => {
   showSlide(currentIndex + 1);
 }, 4000);
/*****************************************************
  10. Aviso de Privacidad
*****************************************************/
document.addEventListener("DOMContentLoaded", () => {
  const modal = document.getElementById("privacy-modal");

  // Mostrar el modal al cargar la página
  if (!modal) return;
  modal.style.display = "flex";

  // Ocultar el modal después de 3 segundos
  setTimeout(() => {
      modal.style.display = "none";
  }, 5000);
});

/*
    MIT License (with attribution required)

    Copyright (c) 2025 Pedro Antonio Ibarra Facio

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    1. Attribution must be given to the original author (e.g., "Developed by Pedro Antonio Ibarra Facio").
    2. If used by an educational institution or organization, visible credit must be included on the website, promotional materials, or related documentation.

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.
*/

/* This code was developed with the assistance of ChatGPT (OpenAI). */
