import React, { useRef, useState } from 'react';

interface JoystickProps {
  onChange: (data: { dx: number; dy: number }) => void;
}

export const Joystick: React.FC<JoystickProps> = ({ onChange }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [touchPos, setTouchPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    setIsDragging(true);
    updatePosition(e.touches[0]);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;
    updatePosition(e.touches[0]);
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    setTouchPos({ x: 0, y: 0 });
    onChange({ dx: 0, dy: 0 });
  };

  const updatePosition = (touch: React.Touch) => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const dx = touch.clientX - centerX;
    const dy = touch.clientY - centerY;

    const distance = Math.sqrt(dx * dx + dy * dy);
    const maxRadius = rect.width / 2 - 25; // 25 is half of the 50px thumb

    let finalX = dx;
    let finalY = dy;

    if (distance > maxRadius) {
      finalX = (dx / distance) * maxRadius;
      finalY = (dy / distance) * maxRadius;
    }

    setTouchPos({ x: finalX, y: finalY });

    // Send normalized direction vector
    const normalizedDx = finalX / maxRadius;
    const normalizedDy = finalY / maxRadius;
    onChange({ dx: normalizedDx, dy: normalizedDy });
  };

  return (
    <div
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{
        width: 120,
        height: 120,
        borderRadius: '50%',
        background: 'rgba(15, 23, 42, 0.4)',
        border: '2px solid rgba(255, 255, 255, 0.08)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        position: 'relative',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        touchAction: 'none',
        boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.3)',
      }}
    >
      {/* Outer bounding circle guide */}
      <div
        style={{
          width: 70,
          height: 70,
          borderRadius: '50%',
          border: '1px dashed rgba(255, 255, 255, 0.1)',
          position: 'absolute',
        }}
      />
      {/* Interactive stick handle */}
      <div
        style={{
          width: 50,
          height: 50,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
          boxShadow: '0 4px 12px rgba(37, 99, 235, 0.4)',
          transform: `translate(${touchPos.x}px, ${touchPos.y}px)`,
          transition: isDragging ? 'none' : 'transform 0.15s ease-out',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
};
