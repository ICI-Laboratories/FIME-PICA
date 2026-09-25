/**
 * Keep rotation optional and stop it when a visitor starts keyboard navigation.
 * Rendering uses the existing slide track so the original layout stays intact.
 */
export function initCarousel(root, {
  motion = globalThis.matchMedia("(prefers-reduced-motion: reduce)"),
  schedule = globalThis.setInterval,
  cancel = globalThis.clearInterval,
} = {}) {
  if (!root) return;
  const document = root.ownerDocument;
  const track = root.querySelector(".carousel");
  const slides = [...root.querySelectorAll(".slide")];
  const previous = root.querySelector("#prev-slide");
  const next = root.querySelector("#next-slide");
  const playback = root.querySelector("#toggle-carousel");
  const status = root.querySelector(".carousel-status");
  if (!track || !slides.length || !previous || !next || !playback || !status) return;

  let currentIndex = 0;
  let playing = !motion.matches && slides.length > 1;
  let timer = null;
  let pointerWasPlaying;

  function showSlide(index) {
    currentIndex = (index + slides.length) % slides.length;
    track.style.transform = `translateX(-${currentIndex * 100}%)`;
    slides.forEach((slide, slideIndex) => {
      const inactive = slideIndex !== currentIndex;
      slide.setAttribute("aria-hidden", String(inactive));
      slide.toggleAttribute("inert", inactive);
      slide.setAttribute("aria-label", `${slideIndex + 1} de ${slides.length}`);
    });
    status.querySelector("[data-carousel-count]").textContent = `${currentIndex + 1} de ${slides.length}`;
    const title = slides[currentIndex].querySelector("h3")?.textContent || "";
    status.querySelector("[data-carousel-announcement]").textContent = `Imagen ${currentIndex + 1} de ${slides.length}: ${title}`;
  }

  function syncRotation() {
    if (timer !== null) cancel(timer);
    timer = null;
    const rotating = playing && !document.hidden;
    playback.textContent = playing ? "Pausar imágenes" : "Reproducir imágenes";
    status.setAttribute("aria-live", rotating ? "off" : "polite");
    if (rotating) timer = schedule(() => showSlide(currentIndex + 1), 5000);
  }

  function pause() {
    playing = false;
    syncRotation();
  }

  previous.addEventListener("click", () => {
    pause();
    showSlide(currentIndex - 1);
  });
  next.addEventListener("click", () => {
    pause();
    showSlide(currentIndex + 1);
  });

  root.addEventListener("focusin", pause);
  // Pointer focus pauses before click; preserve the action the user pressed.
  playback.addEventListener("pointerdown", () => { pointerWasPlaying = playing; });
  playback.addEventListener("click", (event) => {
    const wasPlaying = event.detail > 0 && pointerWasPlaying !== undefined ? pointerWasPlaying : playing;
    pointerWasPlaying = undefined;
    playing = !wasPlaying && slides.length > 1;
    syncRotation();
  });
  motion.addEventListener("change", pause);
  document.addEventListener("visibilitychange", syncRotation);

  showSlide(0);
  if (slides.length > 1) {
    for (const element of [previous, next, playback, status]) element.hidden = false;
  }
  syncRotation();
}

if (typeof document !== "undefined") {
  initCarousel(document.querySelector(".carousel-section"));
}
