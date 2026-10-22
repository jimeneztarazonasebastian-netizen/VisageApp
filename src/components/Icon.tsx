const PATHS: Record<string, React.ReactNode> = {
  sparkles: (
    <>
      <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
    </>
  ),
  smile: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 14.5q4 3.5 8 0" />
      <path d="M9 9.5h.01M15 9.5h.01" strokeWidth="2.6" />
    </>
  ),
  face: (
    <>
      <path d="M12 3c-4 0-7 3.2-7 7.5 0 4.6 3.2 9.5 7 9.5s7-4.9 7-9.5C19 6.2 16 3 12 3z" />
      <path d="M9 11h.01M15 11h.01" strokeWidth="2.6" />
      <path d="M10 16h4" />
    </>
  ),
  lips: <path d="M3 12c2.5-3 4.5-4.5 6-4.5 1.2 0 2.2.8 3 .8s1.8-.8 3-.8c1.5 0 3.5 1.5 6 4.5-2.7 3.4-5.7 5-9 5s-6.3-1.6-9-5zM3 12h18" />,
  eye: (
    <>
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  hair: <path d="M5 20c-1-6 0-14 7-14s8 8 7 14M8 20c-.5-4 .5-9 4-11 2 2 3.5 6 4 11" />,
  background: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="12" cy="11" r="3" />
      <path d="M6.5 20c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5" />
    </>
  ),
  filter: (
    <>
      <circle cx="9" cy="10" r="5.5" />
      <circle cx="15" cy="10" r="5.5" />
      <circle cx="12" cy="15" r="5.5" />
    </>
  ),
  sliders: <path d="M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4" />,
  looks: (
    <>
      <rect x="3" y="3" width="8" height="8" rx="2" />
      <rect x="13" y="3" width="8" height="8" rx="2" />
      <rect x="3" y="13" width="8" height="8" rx="2" />
      <rect x="13" y="13" width="8" height="8" rx="2" />
    </>
  ),
  glasses: (
    <>
      <circle cx="6.5" cy="13" r="3.8" />
      <circle cx="17.5" cy="13" r="3.8" />
      <path d="M10.3 12.5q1.7-1.2 3.4 0M2.7 12L2 9M21.3 12l.7-3" />
    </>
  ),
  ai: (
    <>
      <path d="M9.5 4l1.6 4.4 4.4 1.6-4.4 1.6-1.6 4.4-1.6-4.4L3.5 10l4.4-1.6z" />
      <path d="M17.5 13l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z" />
      <path d="M17 3v3M15.5 4.5h3" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  undo: <path d="M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 010 11H11" />,
  redo: <path d="M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 000 11H13" />,
  compare: (
    <>
      <path d="M12 3v18" />
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M12 5h7a2 2 0 012 2v10a2 2 0 01-2 2h-7z" fill="currentColor" stroke="none" opacity=".35" />
    </>
  ),
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  share: <path d="M12 15V3M8 7l4-4 4 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />,
  camera: (
    <>
      <path d="M4 8h3l2-3h6l2 3h3a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="9" cy="10" r="2" />
      <path d="M21 16l-5-5-9 9" />
    </>
  ),
  reset: <path d="M4 12a8 8 0 108-8 8.5 8.5 0 00-6 2.5L4 8M4 3v5h5" />,
  none: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6l12.8 12.8" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 018 0v4" />
    </>
  ),
};

export function Icon({ name, className = "h-6 w-6" }: { name: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {PATHS[name]}
    </svg>
  );
}
