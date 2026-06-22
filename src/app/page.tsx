"use client";

import React, { useState } from "react";
import Link from "next/link";
import Image from "next/image";

interface DraggableSticker {
  id: string;
  src: string;
  alt: string;
  width: number;
  height: number;
  initialX: number;
  initialY: number;
  rotation: number;
}

const DraggableImage: React.FC<{ sticker: DraggableSticker }> = ({ sticker }) => {
  const [position, setPosition] = useState({ x: sticker.initialX, y: sticker.initialY });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);

  React.useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        setPosition({
          x: e.clientX - dragStart.x,
          y: e.clientY - dragStart.y,
        });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragStart]);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    });
  };

  const handleMouseEnter = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsHovered(true);
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const rotateX = ((y - centerY) / centerY) * -25;
    const rotateY = ((x - centerX) / centerX) * 25;
    setTilt({ x: rotateX, y: rotateY });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isDragging) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const rotateX = ((y - centerY) / centerY) * -25;
    const rotateY = ((x - centerX) / centerX) * 25;
    setTilt({ x: rotateX, y: rotateY });
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setTilt({ x: 0, y: 0 });
  };

  const baseZIndex = 100 + parseInt(sticker.id) * 10;
  const currentZIndex = isDragging ? 9999 : (isHovered ? baseZIndex + 50 : baseZIndex);

  return (
    <div
      className={`absolute select-none touch-none group ${
        isDragging ? 'cursor-grabbing dragging' : 'cursor-grab'
      }`}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        zIndex: currentZIndex,
      }}
      onMouseDown={handleMouseDown}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <Image
        src={sticker.src}
        alt={sticker.alt}
        width={sticker.width}
        height={sticker.height}
        style={{
          transform: `rotate(${sticker.rotation}deg) perspective(800px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg) scale(${
            isDragging ? '0.95' : (tilt.x !== 0 || tilt.y !== 0 ? '1.1' : '1')
          })`,
          transition: isDragging ? 'transform 0.1s ease-out' : 'transform 0.15s ease-out',
        }}
        className="drop-shadow-lg transition-opacity duration-300 ease-out group-[.dragging]:opacity-75"
        draggable={false}
      />
    </div>
  );
};

const MainPage = () => {
  const stickers: DraggableSticker[] = [
    {
      id: '1',
      src: '/images/orpheus_flag.svg',
      alt: 'Orpheus flag',
      width: 150,
      height: 150,
      initialX: 100,
      initialY: 200,
      rotation: 12,
    },
    {
      id: '2',
      src: '/images/hack_camp_fire_sticker.svg',
      alt: 'Hack camp fire',
      width: 120,
      height: 120,
      initialX: typeof window !== 'undefined' ? window.innerWidth - 250 : 1200,
      initialY: 300,
      rotation: -12,
    },
    {
      id: '3',
      src: '/images/hack_to_the_future.svg',
      alt: 'Hack to the future',
      width: 140,
      height: 140,
      initialX: 200,
      initialY: 500,
      rotation: 6,
    },
  ];

  return (
    <div className="min-h-screen bg-white relative" style={{
      backgroundImage: `
        linear-gradient(to right, #e0f2fe 1px, transparent 1px),
        linear-gradient(to bottom, #e0f2fe 1px, transparent 1px)
      `,
      backgroundSize: '30px 30px',
    }}>

      <div className="absolute inset-0">
        {stickers.map((sticker) => (
          <DraggableImage key={sticker.id} sticker={sticker} />
        ))}
      </div>

      <div className="relative overflow-hidden">
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-32 z-20">
          <div className="text-center">            
            <h1 className="text-6xl sm:text-7xl lg:text-8xl font-black text-hackclub-dark mb-8 leading-tight">
              Hack Club
              <br />
              <span className="text-hackclub-red">Shop</span>
            </h1>
            
            <p className="text-xl sm:text-2xl text-hackclub-slate mb-10 max-w-2xl mx-auto font-bold">
              Stickers, shirts, and other cool stuff. All proceeds support HC&apos;s {" "}
              <span className="text-hackclub-red font-black">YSWS</span>, {" "}
              <span className="text-hackclub-red font-black">Hackathons</span>{" "}
              and other projects.
            </p>
            
            <Link
              href="/shop"
              className="inline-flex items-center gap-2 bg-hackclub-red hover:bg-hackclub-orange text-white font-black text-lg px-8 py-4 rounded-full transition-all shadow-lg hover:shadow-xl hover:scale-105 transform"
            >
              <span>Go Shopping :3</span>
              <span className="group-hover:translate-x-1 transition-transform">→</span>
            </Link>
          </div>
        </div>
      </div>

      <footer className="bg-hackclub-dark text-white py-12 mt-20 relative z-20">
        <div className="max-w-7xl mx-auto px-4">
          <div className="text-center space-y-3">
            <p className="text-lg font-bold flex items-center justify-center gap-1">
              made with{" "}
              <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd" />
              </svg>
              {" "}by teenagers
            </p>            <div className="flex flex-wrap justify-center items-center gap-x-3 text-sm">
              <a href="https://hackclub.com/" className="underline hover:decoration-wavy text-hackclub-muted hover:text-white transition-colors" target="_blank" rel="noopener noreferrer">
                hack club
              </a>
              <span className="text-hackclub-muted">|</span>
              <a href="https://hackclub.com/slack/" className="underline hover:decoration-wavy text-hackclub-muted hover:text-white transition-colors" target="_blank" rel="noopener noreferrer">
                slack
              </a>
              <span className="text-hackclub-muted">|</span>
              <a href="https://hackclub.com/clubs/" className="underline hover:decoration-wavy text-hackclub-muted hover:text-white transition-colors" target="_blank" rel="noopener noreferrer">
                clubs
              </a>
              <span className="text-hackclub-muted">|</span>
              <a href="https://hackclub.com/hackathons/" className="underline hover:decoration-wavy text-hackclub-muted hover:text-white transition-colors" target="_blank" rel="noopener noreferrer">
                hackathons
              </a>
            </div>            <p className="text-hackclub-muted text-sm">
              © 2026 Hack Club · 501(c)(3) nonprofit (EIN: 81-2908499)
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default MainPage;