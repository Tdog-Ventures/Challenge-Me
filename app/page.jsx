'use client';
import React, { useState, useEffect, useRef } from 'react';

export default function StopMeChallenge() {
  const imgRef = useRef(null);
  const containerRef = useRef(null);
  const posRef = useRef(-300);
  const animationRef = useRef(null);
  const [stopped, setStopped] = useState(false);
  const [won, setWon] = useState(false);
  const [gameActive, setGameActive] = useState(true);
  const [params, setParams] = useState({
    imageUrl: 'https://via.placeholder.com/400x600/00FF88/000000?text=STOP+ME',
    message: 'YOU GOT IT!',
    speed: 6,
    tolerance: 70,
    backgroundColor: '#0a0a0a',
    accentColor: '#00FF88',
    outlineColor: '#00FF88'
  });

  // Read URL params client-side only
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setParams({
      imageUrl: p.get('image') || 'https://via.placeholder.com/400x600/00FF88/000000?text=STOP+ME',
      message: p.get('message') || 'YOU GOT IT!',
      speed: parseFloat(p.get('speed') || '6'),
      tolerance: parseInt(p.get('zone') || '70'),
      backgroundColor: p.get('bg') || '#0a0a0a',
      accentColor: p.get('accent') || '#00FF88',
      outlineColor: p.get('outline') || p.get('accent') || '#00FF88'
    });
  }, []);

  // 60fps loop using ref - no re-render
  useEffect(() => {
    if (!gameActive || stopped) return;
    
    const animate = () => {
      posRef.current += params.speed;
      if (posRef.current > window.innerWidth + 300) {
        posRef.current = -300;
      }
      if (imgRef.current) {
        imgRef.current.style.transform = `translate3d(${posRef.current}px, -50%, 0)`;
      }
      animationRef.current = requestAnimationFrame(animate);
    };
    
    animationRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationRef.current);
  }, [gameActive, stopped, params.speed]);

  const handleTap = () => {
    if (stopped || !gameActive) return;
    setStopped(true);
    cancelAnimationFrame(animationRef.current);

    const screenCenter = window.innerWidth / 2;
    const imageCenter = posRef.current + 150; // approx center of 300px image
    const min = screenCenter - params.tolerance;
    const max = screenCenter + params.tolerance;

    if (imageCenter >= min && imageCenter <= max) {
      setWon(true);
      setGameActive(false);
      if (navigator.vibrate) navigator.vibrate(100);
    } else {
      setTimeout(() => {
        posRef.current = -300;
        setStopped(false);
        setWon(false);
        setGameActive(true);
      }, 900);
    }
  };

  const handleReset = () => {
    posRef.current = -300;
    setStopped(false);
    setWon(false);
    setGameActive(true);
  };

  return (
    <div
      ref={containerRef}
      onClick={handleTap}
      style={{
        width: '100vw',
        height: '100vh',
        backgroundColor: params.backgroundColor,
        overflow: 'hidden',
        position: 'relative',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Arial Black, Arial, sans-serif',
        touchAction: 'none',
        userSelect: 'none'
      }}
    >
      {/* Target Zone - Two dotted lines */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '5%',
          bottom: '5%',
          width: `${params.tolerance * 2}px`,
          transform: 'translateX(-50%)',
          borderLeft: `4px dashed ${params.accentColor}`,
          borderRight: `4px dashed ${params.accentColor}`,
          boxShadow: `0 0 20px ${params.accentColor}40`,
          opacity: gameActive ? 0.6 : 0.2,
          zIndex: 1,
          pointerEvents: 'none'
        }}
      />

      {/* Zooming image with THICK OUTLINE - the viral part */}
      <img
        ref={imgRef}
        src={params.imageUrl}
        alt="challenge"
        style={{
          position: 'absolute',
          left: 0,
          top: '50%',
          height: '420px',
          width: 'auto',
          maxWidth: '320px',
          objectFit: 'contain',
          filter: `drop-shadow(0 0 0 ${params.outlineColor}) drop-shadow(0 0 0 ${params.outlineColor}) drop-shadow(0 0 0 ${params.outlineColor}) drop-shadow(0 0 12px ${params.outlineColor}) brightness(${stopped ? 0.7 : 1})`,
          willChange: 'transform',
          pointerEvents: 'none',
          zIndex: 10,
          transform: 'translate3d(-300px, -50%, 0)'
        }}
      />

      {won && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            zIndex: 100,
          }}
        >
          <div
            style={{
              fontSize: '64px',
              fontWeight: '900',
              color: '#FF0000',
              WebkitTextStroke: '3px white',
              textShadow: '0 0 30px #FF0000, 0 0 60px #FF0000',
              textAlign: 'center',
              padding: '20px',
              lineHeight: '1.1',
              animation: 'pop 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
            }}
          >
            {params.message}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); handleReset(); }}
            style={{
              marginTop: '30px',
              padding: '18px 48px',
              fontSize: '20px',
              backgroundColor: params.accentColor,
              color: '#000',
              border: 'none',
              borderRadius: '12px',
              cursor: 'pointer',
              fontWeight: '900',
              boxShadow: `0 0 20px ${params.accentColor}`
            }}
          >
            PLAY AGAIN
          </button>
        </div>
      )}

      {stopped && !won && (
        <div
          style={{
            position: 'absolute',
            bottom: '60px',
            left: '50%',
            transform: 'translateX(-50%)',
            fontSize: '28px',
            color: '#ff4444',
            fontWeight: '900',
            background: 'rgba(0,0,0,0.7)',
            padding: '8px 20px',
            borderRadius: '8px',
            zIndex: 50
          }}
        >
          TRY AGAIN!
        </div>
      )}

      {gameActive && !stopped && (
        <div
          style={{
            position: 'absolute',
            top: '30px',
            left: '50%',
            transform: 'translateX(-50%)',
            fontSize: '22px',
            color: params.accentColor,
            fontWeight: '900',
            letterSpacing: '2px',
            textShadow: `0 0 10px ${params.accentColor}`,
            zIndex: 20
          }}
        >
          TAP TO STOP
        </div>
      )}

      <style>{`@keyframes pop { 0% { transform: scale(0.5); } 100% { transform: scale(1); } }`}</style>
    </div>
  );
}
