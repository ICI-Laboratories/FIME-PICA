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
  4. FUNCIONES DE CREACIÓN DE MENSAJES
*****************************************************/
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

  const text = document.createElement("p");
  if (isThinking) {
    text.classList.add("thinking-animation");
  }
  text.textContent = message;
  li.appendChild(text);

  return li;
}
/*****************************************************
  5. COMUNICACIÓN CON EL BACKEND
*****************************************************/
async function generateResponse(incomingChatLi) {
  const msgElem = incomingChatLi.querySelector("p");

  let res, data;
  try {
    res = await fetch(FASTAPI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Conversation-Id": conversationId
      },
      body: JSON.stringify({
        messages: chatHistory,
        stream: false,
        think: false
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error("Error del servidor:", errorText);
      throw new Error(`Error del servidor: ${res.status} - ${errorText || "Sin detalles"}`);
    }

    data = await res.json();

    // Extraer la respuesta del modelo
    const botMessage = data?.message?.content || "Sin respuesta del modelo.";
    msgElem.textContent = botMessage;

    // Agregar la respuesta al historial de chat
    chatHistory.push({ role: "assistant", content: botMessage });

    // Hacer scroll para mostrar la respuesta
    incomingChatLi.scrollIntoView({ behavior: "smooth", block: "start" });

  } catch (err) {
    console.error("Error en la comunicación:", err);
    msgElem.textContent = err.message || "Error obteniendo respuesta.";
    msgElem.classList.add("error");
  } finally {
    setSending(false);
    chatInput.focus();
  }

  // Hacer scroll hasta el final del chatbox
  chatbox.scrollTo(0, chatbox.scrollHeight);
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

  // Mostrar el indicador "Pensando..." y generar respuesta
  setTimeout(() => {
    const incomingLi = createChatLi("Pensando...", "incoming");
    chatbox.appendChild(incomingLi);
    incomingLi.scrollIntoView({ behavior: "smooth", block: "start" });
    generateResponse(incomingLi);
  }, 500);
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
