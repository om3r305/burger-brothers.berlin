"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { createCinemaAudio } from "./cinema-audio";
import "./burger-studio-cinema-lab.css";

const Builder = dynamic(() => import("./BurgerStudioV2"), {
  loading: () => <div className="bcl-loading" role="status">Deine Zutaten werden vorbereitet …</div>,
});
const Model = dynamic(() => import("./BurgerCinemaModel"), {
  ssr: false,
  loading: () => <div className="bcl-loading" role="status">Die 360° Ansicht wird vorbereitet …</div>,
});
const FILM_DURATION = 8500;
type Phase = "gate" | "film" | "atelier" | "builder";
type CinemaAudio = ReturnType<typeof createCinemaAudio>;

export default function BurgerStudioCinemaLab() {
  const [phase, setPhase] = useState<Phase>("gate");
  const [sound, setSound] = useState(false);
  const [portrait, setPortrait] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [imageReady, setImageReady] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [audioUnavailable, setAudioUnavailable] = useState(false);
  const audio = useRef<CinemaAudio | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const phaseRef = useRef<Phase>("gate");
  const startLock = useRef(false);

  const stopAudio = useCallback(() => {
    audio.current?.stop();
    audio.current = null;
  }, []);

  const arrive = useCallback(() => {
    setPhase("atelier");
    phaseRef.current = "atelier";
    audio.current?.cue("reveal");
  }, []);

  useEffect(() => {
    const orientation = window.matchMedia("(orientation: portrait)");
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      setPortrait(orientation.matches);
      setReducedMotion(motion.matches);
    };
    sync();
    orientation.addEventListener("change", sync);
    motion.addEventListener("change", sync);
    const hide = () => {
      if (document.hidden) {
        stopAudio();
        setSound(false);
        if (phaseRef.current === "film") arrive();
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      orientation.removeEventListener("change", sync);
      motion.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", hide);
      stopAudio();
    };
  }, [arrive, stopAudio]);

  useEffect(() => {
    if (phase !== "film") return;
    if (reducedMotion) { arrive(); return; }
    const timer = window.setTimeout(arrive, FILM_DURATION);
    return () => window.clearTimeout(timer);
  }, [phase, reducedMotion, arrive]);

  useEffect(() => {
    if (phase === "atelier" || phase === "builder") heading.current?.focus({ preventScroll: true });
  }, [phase]);

  useEffect(() => {
    if (!modelOpen || !dialog.current) return;
    const element = dialog.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [modelOpen]);

  function enableAudio() {
    stopAudio();
    const controller = createCinemaAudio();
    audio.current = controller;
    setAudioUnavailable(false);
    // start() constructs and resumes the context inside this user gesture.
    void controller.start().catch(() => {
      if (audio.current !== controller) return;
      stopAudio();
      setSound(false);
      setAudioUnavailable(true);
    });
  }

  function start(withSound: boolean) {
    if (startLock.current) return;
    startLock.current = true;
    setSound(withSound);
    if (withSound) enableAudio();
    else stopAudio();
    const next = reducedMotion ? "atelier" : "film";
    phaseRef.current = next;
    setPhase(next);
  }

  function toggleSound() {
    const next = !sound;
    setSound(next);
    if (next && !audio.current) enableAudio();
    else audio.current?.setMuted(!next);
  }

  function enterBuilder() {
    stopAudio();
    setSound(false);
    phaseRef.current = "builder";
    setPhase("builder");
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function replay() {
    stopAudio();
    setSound(false);
    startLock.current = false;
    phaseRef.current = "gate";
    setPhase("gate");
  }

  if (phase === "builder") return (
    <div className="bcl-builder">
      <header className="bcl-builder-bar">
        <button type="button" onClick={replay}>← Zurück zur Bühne</button>
        <h1 ref={heading} tabIndex={-1}>DEINE KREATION</h1>
        <span>BURGER BROTHERS · BERLIN</span>
      </header>
      <Builder />
    </div>
  );

  return (
    <main className={`bcl bcl-${phase}${portrait ? " bcl-portrait" : ""}${reducedMotion ? " bcl-still" : ""}`}>
      <div className="bcl-picture" aria-hidden="true">
        <img src="/images/burger-studio/cinema/hero.webp" alt="" fetchPriority="high" loading="eager"
          onLoad={() => setImageReady(true)} onError={() => setImageFailed(true)} />
      </div>
      <div className="bcl-shade" aria-hidden="true" />
      <div className="bcl-grain" aria-hidden="true" />
      {phase !== "gate" && !reducedMotion ? <div className="bcl-atmosphere" aria-hidden="true">
        <i className="bcl-steam bcl-steam-one" /><i className="bcl-steam bcl-steam-two" />
        {[0, 1, 2, 3, 4, 5].map(index => <i className="bcl-spark" key={index} style={{ left: `${56 + index * 7}%`, animationDelay: `${index * -1.8}s` }} />)}
      </div> : null}

      <header className="bcl-top">
        <a href="/menu" className="bcl-brand"><span>BURGER BROTHERS</span><small>BERLIN</small></a>
        <span className="bcl-edition"><i /> CINEMA LAB</span>
      </header>

      {phase === "gate" ? <section className="bcl-gate-copy">
        <p className="bcl-overline">DEIN PLATZ IN DER ERSTEN REIHE</p>
        <h1>{portrait ? <>Einmal drehen.<br /><em>Dann genießen.</em></> : <>Licht aus.<br /><em>Geschmack an.</em></>}</h1>
        <p className="bcl-lead">{portrait ? "Halte dein Handy quer für die große Bühne. Du kannst auch hochkant starten." : "Ein kurzer Vorgeschmack. Danach gehört die Bühne deinem Burger."}</p>
        {portrait ? <div className="bcl-orientation"><svg viewBox="0 0 48 48" aria-hidden="true"><rect x="15" y="5" width="18" height="32" rx="4" fill="none" stroke="currentColor" strokeWidth="1.5"/><path d="M37 16a16 16 0 0 1-8 24m0-6v6h6" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg><span>Im Querformat noch intensiver</span></div> : null}
        <div className="bcl-start-options">
          <button type="button" className="bcl-primary" onClick={() => start(true)} disabled={!imageReady && !imageFailed}> {imageReady || imageFailed ? "Mit Sound erleben" : "Die Bühne wird vorbereitet …"}<span aria-hidden="true">↗</span></button>
          <button type="button" className="bcl-text-button" onClick={() => start(false)} disabled={!imageReady && !imageFailed}>Ohne Ton starten</button>
        </div>
        <button type="button" className="bcl-direct" onClick={enterBuilder}>Direkt meinen Burger bauen <span aria-hidden="true">→</span></button>
        <p className="bcl-note">Kopfhörer empfohlen · Intro jederzeit überspringbar</p>
        {imageFailed ? <p className="bcl-notice" role="status">Das Motiv konnte nicht geladen werden. Das Studio ist trotzdem verfügbar.</p> : null}
      </section> : null}

      {phase === "film" ? <>
        <section className="bcl-film-copy" aria-label="Cinematische Burger-Vorschau">
          <p className="bcl-overline">HANDCRAFTED IN BERLIN</p>
          <h1>Dein Burger.<br /><em>Deine Regeln.</em></h1>
          <span className="bcl-copy-rule" />
        </section>
        <div className="bcl-shot-label" aria-hidden="true"><span>01 — FEUER & GESCHMACK</span><span>02 — DEINE BÜHNE</span></div>
      </> : null}

      {phase === "atelier" ? <section className="bcl-atelier-copy">
        <p className="bcl-overline">DAS BURGER STUDIO</p>
        <h1 ref={heading} tabIndex={-1}>Dein Burger.<br /><em>Deine Regeln.</em></h1>
        <p className="bcl-lead">Wähle deine Zutaten.<br />Mach ihn zu deinem Original.</p>
        <button type="button" className="bcl-primary" onClick={enterBuilder}>Meinen Burger kreieren <span aria-hidden="true">↗</span></button>
        <button type="button" className="bcl-explore" onClick={() => { audio.current?.cue("ingredient"); setModelOpen(true); }}> <span aria-hidden="true">◌</span> Burger in 360° entdecken</button>
        <p className="bcl-note">360° Inspiration · festes Burger-Modell</p>
      </section> : null}

      <footer className="bcl-bottom">
        <span className="bcl-bottom-caption">{phase === "gate" ? "DESIGNVORSCHAU / 01" : "FIRE. FLAVOUR. YOUR CREATION."}</span>
        {phase !== "gate" ? <div className="bcl-controls">
          <button type="button" onClick={toggleSound} aria-pressed={sound} aria-label={sound ? "Ton ausschalten" : "Ton einschalten"}><span aria-hidden="true">{sound ? "◖))" : "◖×"}</span> {sound ? "Ton an" : "Ton aus"}</button>
          {phase === "film" ? <button type="button" onClick={arrive}>Intro überspringen <span aria-hidden="true">→</span></button> : <button type="button" onClick={replay}>Noch einmal <span aria-hidden="true">↺</span></button>}
        </div> : null}
      </footer>
      {audioUnavailable ? <p className="bcl-audio-notice" role="status">Ton ist hier nicht verfügbar. Du kannst ohne Ton fortfahren.</p> : null}

      {modelOpen ? <dialog ref={dialog} className="bcl-model-dialog" aria-labelledby="bcl-model-title" onCancel={() => setModelOpen(false)} onClick={event => { if (event.target === event.currentTarget) setModelOpen(false); }}>
        <div className="bcl-model-panel">
          <header><div><p className="bcl-overline">INSPIRATION / 360°</p><h2 id="bcl-model-title">Jede Seite zählt.</h2></div><button type="button" autoFocus onClick={() => setModelOpen(false)} aria-label="360° Ansicht schließen">✕</button></header>
          <Model />
          <div className="bcl-model-credit">3D-Modell: <a href="https://sketchfab.com/3d-models/hamburger-food-big-hamburger-a23e498da6ea44f081b00f2c3a0bdfde" target="_blank" rel="noreferrer">„hamburger, гамбургер, food, big-hamburger“</a> von <a href="https://sketchfab.com/usp05" target="_blank" rel="noreferrer">usp05</a> / Sketchfab · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a> · Skalierung und Beleuchtung angepasst.</div>
          <footer><span>Ein festes Modell zum Entdecken.</span><button type="button" onClick={() => { setModelOpen(false); enterBuilder(); }}>Jetzt meinen Burger bauen →</button></footer>
        </div>
      </dialog> : null}
    </main>
  );
}
