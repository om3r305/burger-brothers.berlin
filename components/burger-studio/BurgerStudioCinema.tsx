"use client";

import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import "./burger-studio-cinema.css";

const Studio = dynamic(() => import("./BurgerStudioV2"), {
  loading: () => <div className="bsc-loading" role="status">Deine Bühne wird vorbereitet …</div>,
});
const INTRO_MS = 6600;
const EMBERS = Array.from({ length: 28 }, (_, index) => index);
type Phase = "gate" | "intro" | "studio";

export default function BurgerStudioCinema() {
  const [phase, setPhase] = useState<Phase>("gate");
  const [portrait, setPortrait] = useState(false);
  const [sound, setSound] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [mediaFailed, setMediaFailed] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const audio = useRef<AudioContext | null>(null);
  const gain = useRef<GainNode | null>(null);
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const started = useRef(false);

  const stopAudio = useCallback(() => {
    if (utterance.current && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      utterance.current = null;
    }
    const context = audio.current;
    audio.current = null;
    gain.current = null;
    if (context && context.state !== "closed") void context.close().catch(() => {});
  }, []);

  const enterStudio = useCallback(() => {
    started.current = true;
    video.current?.pause();
    stopAudio();
    setPhase("studio");
  }, [stopAudio]);

  useEffect(() => {
    const orientation = window.matchMedia("(max-width: 1023px) and (orientation: portrait)");
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => { setPortrait(orientation.matches); setReducedMotion(motion.matches); };
    sync();
    orientation.addEventListener("change", sync);
    motion.addEventListener("change", sync);
    return () => {
      orientation.removeEventListener("change", sync);
      motion.removeEventListener("change", sync);
      stopAudio();
    };
  }, [stopAudio]);

  useEffect(() => {
    if (phase !== "intro") return;
    const timeout = window.setTimeout(enterStudio, INTRO_MS);
    const onVisibility = () => { if (document.hidden) enterStudio(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { window.clearTimeout(timeout); document.removeEventListener("visibilitychange", onVisibility); };
  }, [phase, enterStudio]);

  useEffect(() => {
    if (phase === "studio") heading.current?.focus();
    if (phase === "intro" && reducedMotion) enterStudio();
  }, [phase, reducedMotion, enterStudio]);

  function startAudio() {
    try {
      const AudioConstructor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioConstructor) {
        const context = new AudioConstructor();
        audio.current = context;
        const master = context.createGain();
        master.gain.value = 0.28;
        master.connect(context.destination);
        gain.current = master;
        void context.resume().catch(() => {});
        const now = context.currentTime;
        // A low cinematic swell, followed by a soft fire texture. No external audio request.
        const bass = context.createOscillator();
        const envelope = context.createGain();
        bass.type = "sine";
        bass.frequency.setValueAtTime(88, now);
        bass.frequency.exponentialRampToValueAtTime(38, now + 1.8);
        envelope.gain.setValueAtTime(0.001, now);
        envelope.gain.exponentialRampToValueAtTime(0.65, now + 0.15);
        envelope.gain.exponentialRampToValueAtTime(0.001, now + 2.3);
        bass.connect(envelope); envelope.connect(master);
        bass.start(now); bass.stop(now + 2.4);
        const buffer = context.createBuffer(1, context.sampleRate * 5, context.sampleRate);
        const samples = buffer.getChannelData(0);
        let previous = 0;
        for (let index = 0; index < samples.length; index++) {
          previous = (previous + (Math.random() * 2 - 1) * 0.04) / 1.04;
          samples[index] = previous * 3;
        }
        const fire = context.createBufferSource();
        fire.buffer = buffer;
        const filter = context.createBiquadFilter();
        filter.type = "lowpass"; filter.frequency.value = 1100;
        const flameGain = context.createGain();
        flameGain.gain.setValueAtTime(0.001, now);
        flameGain.gain.linearRampToValueAtTime(0.2, now + 0.8);
        flameGain.gain.linearRampToValueAtTime(0.001, now + 5);
        fire.connect(filter); filter.connect(flameGain); flameGain.connect(master);
        fire.start(now); fire.stop(now + 5);
      }
      if ("speechSynthesis" in window) {
        const voice = new SpeechSynthesisUtterance("Dein Burger. Deine Regeln. Willkommen im Burger Studio.");
        voice.lang = "de-DE"; voice.rate = 0.88; voice.pitch = 0.85; voice.volume = 0.8;
        const germanVoice = window.speechSynthesis.getVoices().find(item => item.lang.startsWith("de"));
        if (germanVoice) voice.voice = germanVoice;
        utterance.current = voice;
        window.speechSynthesis.speak(voice);
      }
    } catch { stopAudio(); }
  }

  function start(withSound: boolean) {
    if (started.current) return;
    started.current = true;
    setSound(withSound);
    if (reducedMotion) { enterStudio(); return; }
    if (withSound) startAudio();
    setPhase("intro");
  }

  function toggleSound() {
    const enabled = !sound;
    setSound(enabled);
    if (gain.current && audio.current) gain.current.gain.setTargetAtTime(enabled ? 0.28 : 0, audio.current.currentTime, 0.04);
    if (!enabled && utterance.current && "speechSynthesis" in window) {
      window.speechSynthesis.cancel(); utterance.current = null;
    }
  }

  if (phase === "studio") return (
    <div className="bsc-studio">
      <header className="bsc-studio-bar">
        <h1 ref={heading} tabIndex={-1}>DEIN BURGER. DEINE REGELN.</h1>
        <span>BURGER BROTHERS · STUDIO</span>
      </header>
      <Studio />
    </div>
  );

  return (
    <main className={`bsc-screen bsc-${phase}${portrait ? " bsc-portrait" : ""}`}>
      {phase === "intro" ? <>
        <img className="bsc-fire bsc-fire-poster" src="/flames/studio-cinema-poster.webp" alt="" aria-hidden="true" />
        {!mediaFailed ? <video className="bsc-fire" ref={video} autoPlay muted playsInline preload="none" poster="/flames/studio-cinema-poster.webp"
          onError={() => setMediaFailed(true)} aria-hidden="true">
          <source src="/flames/flame-loop.mp4" type="video/mp4" />
        </video> : null}
        <div className="bsc-fire-glow" aria-hidden="true" />
        <div className="bsc-embers" aria-hidden="true">{EMBERS.map(index => <i key={index} style={{
          left: `${(index * 37) % 100}%`, animationDelay: `${(index % 7) * -0.43}s`,
          animationDuration: `${2.4 + (index % 5) * 0.4}s`,
        }} />)}</div>
        <div className="bsc-letterbox" aria-hidden="true" />
        <div className="bsc-intro-caption" aria-live="polite">
          <p>BURGER BROTHERS BERLIN</p>
          <h1><span>DEIN BURGER.</span><span>DEINE REGELN.</span></h1>
          <div className="bsc-caption-line" />
          <strong>CREATE SOMETHING LEGENDARY</strong>
        </div>
        <div className="bsc-hero-burger" aria-hidden="true">
          {(["bun-bottom", "beef", "cheddar", "lettuce", "bun-classic"] as const).map((kind, index) =>
            <img key={kind} src={`/images/burger-studio/${kind}.webp`} alt="" style={{ "--layer": index } as CSSProperties} />)}
        </div>
        <div className="bsc-controls">
          <button onClick={toggleSound} aria-pressed={sound}>Ton {sound ? "an" : "aus"}</button>
          <button onClick={enterStudio}>Intro überspringen <span aria-hidden="true">↗</span></button>
        </div>
        <div className="bsc-progress" aria-hidden="true" />
      </> : <>
        <a className="bsc-back" href="/menu">← Zurück zum Menü</a>
        <div className="bsc-gate-content">
          <p className="bsc-eyebrow">BURGER BROTHERS BERLIN / STUDIO</p>
          {portrait ? <div className="bsc-phone" aria-hidden="true"><i /></div> : <div className="bsc-mark" aria-hidden="true">BB<span>STUDIO</span></div>}
          <h1>{portrait ? <>DREH DEIN HANDY.<br /><em>DEINE BÜHNE WARTET.</em></> : <>DEIN BURGER.<br /><em>DEINE REGELN.</em></>}</h1>
          <p className="bsc-description">{portrait ? "Für das volle Kinoerlebnis: Bitte halte dein Handy quer." : "Feuer. Geschmack. Deine Kreation. Bereit für deinen großen Auftritt?"}</p>
          <div className="bsc-gate-actions">
            <button className="bsc-start" onClick={() => start(true)}>{portrait ? "Auch hochkant starten" : "Erlebnis starten"} <span aria-hidden="true">↗</span></button>
            <button className="bsc-quiet" onClick={() => start(false)}>Ohne Ton starten</button>
          </div>
          <button className="bsc-direct" onClick={enterStudio}>Direkt meinen Burger bauen →</button>
          <p className="bsc-small">Kurzes Intro · jederzeit überspringbar · Ton steuerbar</p>
        </div>
        <div className="bsc-bottom-label"><span>HANDCRAFTED IN BERLIN</span><span>01 / YOUR CREATION</span></div>
      </>}
    </main>
  );
}
