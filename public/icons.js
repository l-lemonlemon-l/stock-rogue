// Original icon set (inline SVG). No third-party artwork.
const ICONS = (() => {
  const svg = (body, vb = '0 0 32 32') => `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
  return {
    chart: svg(`<rect x="3" y="4" width="26" height="22" fill="#fff" stroke="#2b4f8f"/><rect x="3" y="4" width="26" height="4" fill="#3a6fd8"/>
      <polyline points="6,22 11,16 15,19 20,11 26,13" fill="none" stroke="#1aa33a" stroke-width="2.4"/><rect x="24.5" y="11.5" width="3" height="3" fill="#1aa33a"/>`),
    market: svg(`<rect x="4" y="5" width="24" height="22" fill="#fff" stroke="#2b4f8f"/><rect x="4" y="5" width="24" height="4" fill="#3a6fd8"/>
      <rect x="7" y="12" width="10" height="2" fill="#555"/><rect x="20" y="12" width="5" height="2" fill="#1aa33a"/>
      <rect x="7" y="16" width="10" height="2" fill="#555"/><rect x="20" y="16" width="5" height="2" fill="#d22"/>
      <rect x="7" y="20" width="10" height="2" fill="#555"/><rect x="20" y="20" width="5" height="2" fill="#1aa33a"/>`),
    order: svg(`<rect x="7" y="3" width="18" height="26" fill="#fffbe6" stroke="#8a6d1a"/><rect x="11" y="1" width="10" height="5" fill="#c9a43c" stroke="#8a6d1a"/>
      <path d="M10 12h12M10 16h12M10 20h8" stroke="#555" stroke-width="1.6"/><path d="M19 23l2 2 4-5" stroke="#1aa33a" stroke-width="2" fill="none"/>`),
    bag: svg(`<path d="M6 11h20l-2 17H8z" fill="#f3a531" stroke="#9a5a08"/><path d="M11 11V7h10v4" fill="none" stroke="#9a5a08" stroke-width="2"/>
      <path d="M12 18l3 3 6-6" stroke="#fff" stroke-width="2.4" fill="none"/>`),
    trophy: svg(`<path d="M10 4h12v8a6 6 0 0 1-12 0z" fill="#ffc72c" stroke="#9a6b00"/><path d="M10 7H5c0 5 3 7 6 7M22 7h5c0 5-3 7-6 7" fill="none" stroke="#9a6b00" stroke-width="1.6"/>
      <rect x="14" y="17" width="4" height="5" fill="#d9a514"/><rect x="9" y="22" width="14" height="5" fill="#7a4b14" stroke="#4a2a08"/>`),
    rebirth: svg(`<rect x="4" y="4" width="24" height="24" fill="#fff4d6" stroke="#c0571b"/><path d="M16 7c4 4 6 7 3 12 3-1 4-4 3-6 3 4 1 10-6 10s-9-6-5-11c0 3 2 4 3 4-2-4 0-7 2-9z" fill="#ff7a1a" stroke="#b33b05"/>`),
    bank: svg(`<path d="M3 12L16 4l13 8z" fill="#d7dce8" stroke="#46526e"/><rect x="5" y="12" width="22" height="2" fill="#a7b0c6"/>
      <rect x="7" y="15" width="3" height="9" fill="#e9ecf3" stroke="#46526e"/><rect x="14.5" y="15" width="3" height="9" fill="#e9ecf3" stroke="#46526e"/><rect x="22" y="15" width="3" height="9" fill="#e9ecf3" stroke="#46526e"/>
      <rect x="4" y="25" width="24" height="3" fill="#a7b0c6" stroke="#46526e"/>`),
    help: svg(`<rect x="4" y="4" width="24" height="24" fill="#2f6fde" stroke="#123f93"/><path d="M12 12a4 4 0 1 1 6 3.5c-1.5.8-2 1.6-2 3" stroke="#fff" stroke-width="2.6" fill="none"/><rect x="14.5" y="21.5" width="3" height="3" fill="#fff"/>`),
    cmd: svg(`<rect x="3" y="5" width="26" height="22" fill="#000" stroke="#555"/><rect x="3" y="5" width="26" height="4" fill="#3a6fd8"/><path d="M7 13l4 3-4 3" stroke="#ddd" stroke-width="1.8" fill="none"/><rect x="13" y="19" width="8" height="2" fill="#ddd"/>`),
    briefcase: svg(`<rect x="4" y="10" width="24" height="16" fill="#8b5a2b" stroke="#4d2f12"/><path d="M12 10V7h8v3" fill="none" stroke="#4d2f12" stroke-width="2"/><rect x="4" y="16" width="24" height="2" fill="#6a421d"/><rect x="14" y="15" width="4" height="4" fill="#e3b448" stroke="#4d2f12"/>`),
    news: svg(`<rect x="4" y="6" width="22" height="20" fill="#fff" stroke="#555"/><rect x="26" y="10" width="3" height="16" fill="#ddd" stroke="#555"/><rect x="7" y="9" width="16" height="4" fill="#333"/>
      <path d="M7 16h7M7 19h7M7 22h7" stroke="#888" stroke-width="1.4"/><rect x="16" y="16" width="7" height="7" fill="#b9cdf0"/>`),
    users: svg(`<rect x="8" y="6" width="8" height="8" fill="#f2c6a0" stroke="#7a5233"/><rect x="4" y="17" width="16" height="9" fill="#3a6fd8" stroke="#1d3f86"/>
      <rect x="19" y="8" width="7" height="7" fill="#f2c6a0" stroke="#7a5233"/><rect x="18" y="18" width="10" height="8" fill="#1aa33a" stroke="#0e6522"/>`),
    star: svg(`<path d="M16 3l3.8 8 8.7 1-6.4 6 1.7 8.6L16 22.4 8.2 26.6 9.9 18l-6.4-6 8.7-1z" fill="#ffc72c" stroke="#9a6b00"/>`),
    start: svg(`<rect x="2" y="2" width="28" height="28" fill="#fff" opacity=".18"/><polyline points="5,24 12,16 17,20 27,8" fill="none" stroke="#fff" stroke-width="3.4"/><path d="M21 7h7v7z" fill="#fff"/>`),
    'start-green': svg(`<rect x="2" y="2" width="28" height="28" fill="#3d9a2e" stroke="#1f5e14"/><polyline points="5,24 12,16 17,20 27,8" fill="none" stroke="#fff" stroke-width="3.4"/><path d="M21 7h7v7z" fill="#fff"/>`),
    lock: svg(`<rect x="7" y="14" width="18" height="13" fill="#c9a43c" stroke="#7a5c10"/><path d="M11 14V9h10v5" fill="none" stroke="#7a5c10" stroke-width="2.4"/><rect x="15" y="18" width="2" height="5" fill="#5a420a"/>`),
    warning: svg(`<path d="M16 3L30 28H2z" fill="#ffd21f" stroke="#8a6d00"/><rect x="14.6" y="11" width="2.8" height="9" fill="#000"/><rect x="14.6" y="22.5" width="2.8" height="2.8" fill="#000"/>`),
    error: svg(`<rect x="3" y="3" width="26" height="26" fill="#e2412c" stroke="#8c1b0e"/><path d="M11 11l10 10M21 11L11 21" stroke="#fff" stroke-width="3.2"/>`),
    info: svg(`<rect x="3" y="3" width="26" height="26" fill="#fff" stroke="#2f6fde" stroke-width="2"/><rect x="14.3" y="8" width="3.4" height="3.4" fill="#2f6fde"/><rect x="14.3" y="14" width="3.4" height="10" fill="#2f6fde"/>`),
    shark: svg(`<path d="M2 22c6-3 10-4 14-4l4-10c1 4 2 7 2 10 4 1 7 2 9 4-5 2-11 3-17 3-5 0-9-1-12-3z" fill="#7b8ea8" stroke="#3a4a60"/><rect x="23" y="20" width="2" height="2" fill="#000"/><path d="M0 28h32" stroke="#2f6fde" stroke-width="2"/>`),
    power: svg(`<rect x="2" y="2" width="28" height="28" fill="#e2412c" stroke="#fff"/><path d="M11 11a8 8 0 1 0 10 0" stroke="#fff" stroke-width="2.6" fill="none"/><rect x="14.7" y="6" width="2.6" height="10" fill="#fff"/>`),
    logoff: svg(`<rect x="2" y="2" width="28" height="28" fill="#f3a531" stroke="#fff"/><rect x="8" y="10" width="8" height="8" fill="none" stroke="#fff" stroke-width="2.4"/><path d="M15 16l9 7M20 19l2-2M22 21l2-2" stroke="#fff" stroke-width="2.4"/>`),
    chat: svg(`<rect x="3" y="5" width="22" height="15" fill="#fff" stroke="#2b4f8f" stroke-width="2"/><path d="M8 20v6l6-6" fill="#fff" stroke="#2b4f8f" stroke-width="2"/>
      <rect x="7" y="9" width="14" height="2" fill="#3a6fd8"/><rect x="7" y="13" width="10" height="2" fill="#3a6fd8"/><rect x="20" y="15" width="10" height="9" fill="#ffd34d" stroke="#8a6d1a"/>`),
    mic: svg(`<rect x="12" y="3" width="8" height="15" fill="#c8ccd6" stroke="#46526e" stroke-width="2"/><path d="M8 13v3c0 5 3.5 7 8 7s8-2 8-7v-3" fill="none" stroke="#46526e" stroke-width="2"/>
      <rect x="15" y="23" width="2" height="5" fill="#46526e"/><rect x="10" y="27" width="12" height="2" fill="#46526e"/>`),
    micoff: svg(`<rect x="12" y="3" width="8" height="15" fill="#c8ccd6" stroke="#46526e" stroke-width="2"/><path d="M8 13v3c0 5 3.5 7 8 7s8-2 8-7v-3" fill="none" stroke="#46526e" stroke-width="2"/>
      <rect x="15" y="23" width="2" height="5" fill="#46526e"/><rect x="10" y="27" width="12" height="2" fill="#46526e"/><path d="M5 5l22 22" stroke="#d22" stroke-width="3"/>`),
    disk: svg(`<rect x="4" y="4" width="24" height="24" fill="#3a6fd8" stroke="#1d3a78" stroke-width="2"/><rect x="9" y="5" width="13" height="8" fill="#e8ecf4"/><rect x="18" y="6" width="3" height="6" fill="#1d3a78"/>
      <rect x="8" y="17" width="16" height="10" fill="#fff"/><path d="M10 20h12M10 23h9" stroke="#999" stroke-width="1.4"/>`),
    settings: svg(`<rect x="11" y="11" width="10" height="10" fill="#fff" stroke="#46526e" stroke-width="2"/><path d="M16 3v6M16 23v6M3 16h6M23 16h6M6.8 6.8l3.5 3.5M21.7 21.7l3.5 3.5M6.8 25.2l3.5-3.5M21.7 10.3l3.5-3.5" stroke="#46526e" stroke-width="3"/>`),
    certificate: svg(`<rect x="3" y="6" width="26" height="18" fill="#fff8e1" stroke="#8a6d1a"/><rect x="5.5" y="8.5" width="21" height="13" fill="none" stroke="#c9a43c"/><path d="M9 13h14M9 16h9" stroke="#8a6d1a" stroke-width="1.4"/>
      <rect x="19" y="19" width="7" height="7" fill="#d22"/><path d="M20 26l-1 4 3-2 3 2-1-4" fill="#d22"/>`),
    flag: svg(`<rect x="6" y="3" width="3" height="26" fill="#555"/><path d="M9 4h18l-4 6 4 6H9z" fill="#ffc72c" stroke="#9a6b00"/><path d="M13 8h2v2h-2zM17 10h2v2h-2zM13 12h2v2h-2z" fill="#9a6b00"/>`),
    network: svg(`<rect x="3" y="5" width="12" height="9" fill="#cfe0ff" stroke="#fff"/><rect x="17" y="18" width="12" height="9" fill="#cfe0ff" stroke="#fff"/><path d="M9 14v5h11" stroke="#fff" stroke-width="1.6" fill="none"/>`),
    user: svg(`<rect width="32" height="32" fill="#1f6b3a"/><path d="M4 26l7-8 5 4 8-11 4 4v11H4z" fill="#38c06a"/><path d="M6 23l6-6 5 4 7-9" stroke="#fff" stroke-width="2" fill="none"/><rect x="22" y="5" width="6" height="6" fill="#ffd34d"/>`),
    left: svg(`<path d="M20 4L8 16l12 12z" fill="#fff" stroke="#123f93" stroke-width="2"/>`),
    right: svg(`<path d="M12 4l12 12-12 12z" fill="#fff" stroke="#123f93" stroke-width="2"/>`),
    min: svg(`<rect x="2" y="8" width="7" height="2" fill="#fff"/>`, '0 0 11 11'),
    max: svg(`<rect x="1.5" y="1.5" width="8" height="8" fill="none" stroke="#fff" stroke-width="1.4"/><rect x="1" y="1" width="9" height="2.2" fill="#fff"/>`, '0 0 11 11'),
    close: svg(`<path d="M2 2l7 7M9 2l-7 7" stroke="#fff" stroke-width="2"/>`, '0 0 11 11'),
  };
})();
