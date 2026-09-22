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
let userMessage;
let isSending = false;
const chatHistory     = [];
const inputInitHeight = chatInput.scrollHeight;

// Nginx reenvía esta ruta al servicio FastAPI dentro de Docker.
const FASTAPI_ENDPOINT = "/api/chat";

function createConversationId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function getConversationId() {
  try {
    const storageKey = "fimebot-conversation-id";
    const storedId = sessionStorage.getItem(storageKey);
    if (storedId) return storedId;

    const newId = createConversationId();
    sessionStorage.setItem(storageKey, newId);
    return newId;
  } catch {
    return createConversationId();
  }
}

const conversationId = getConversationId();

function setSending(sending) {
  isSending = sending;
  chatInput.disabled = sending;
  sendChatBtn.setAttribute("aria-disabled", String(sending));
}

toggleChatBtn.addEventListener("click", () => {
  transformCont.classList.toggle("show-chat");
});

closeChatBtn.addEventListener("click", () => {
  transformCont.classList.remove("show-chat");
});

/*****************************************************
  4. FUNCIONES DE RENDERIZADO Y CREACIÓN DE MENSAJES
*****************************************************/
function renderMarkdown(element, text) {
  if (typeof marked !== "undefined" && typeof marked.parse === "function") {
    element.innerHTML = marked.parse(text, { breaks: true, gfm: true });
  } else {
    element.textContent = text;
  }
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

  try {
    const res = await fetch(FASTAPI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Conversation-Id": conversationId
      },
      body: JSON.stringify({
        messages: chatHistory,
        stream: true,
        think: false
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error("Error del servidor:", errorText);
      throw new Error(`Error ${res.status}: ${errorText || "Error en el servidor"}`);
    }

    bubble.classList.remove("thinking-animation");
    bubble.textContent = "";

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("text/event-stream") && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let botMessage = "";
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
              chatbox.scrollTop = chatbox.scrollHeight;
            }
          } catch {
            // Ignorar chunks incompletos
          }
        }
      }

      if (!botMessage.trim()) {
        botMessage = "No se recibió respuesta del modelo.";
        renderMarkdown(bubble, botMessage);
      }

      chatHistory.push({ role: "assistant", content: botMessage });
    } else {
      // Fallback JSON no streaming
      const data = await res.json();
      const botMessage = data?.message?.content || "Sin respuesta del modelo.";
      renderMarkdown(bubble, botMessage);
      chatHistory.push({ role: "assistant", content: botMessage });
    }

    incomingChatLi.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    console.error("Error en la comunicación:", err);
    bubble.classList.remove("thinking-animation");
    bubble.textContent = err.message || "Error obteniendo respuesta.";
    bubble.classList.add("error");
  } finally {
    setSending(false);
    chatInput.focus();
    chatbox.scrollTo(0, chatbox.scrollHeight);
  }
}

/*****************************************************
  6. MANEJO DEL ENVÍO DE MENSAJES
*****************************************************/
function handleChat() {
  if (isSending) return;

  userMessage = chatInput.value.trim();
  if (!userMessage) return;

  setSending(true);

  chatInput.value = "";
  chatInput.style.height = `${inputInitHeight}px`;

  // Agregar el mensaje del usuario al historial
  chatHistory.push({ role: "user", content: userMessage });

  // Crear y mostrar el mensaje del usuario
  const outgoingLi = createChatLi(userMessage, "outgoing");
  chatbox.appendChild(outgoingLi);
  chatbox.scrollTo(0, chatbox.scrollHeight);

  // Mostrar el indicador "Pensando..." y comenzar streaming inmediatamente
  setTimeout(() => {
    const incomingLi = createChatLi("Pensando...", "incoming");
    chatbox.appendChild(incomingLi);
    incomingLi.scrollIntoView({ behavior: "smooth", block: "start" });
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
