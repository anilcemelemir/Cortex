// =============================================================
//  Cortex icon set
// =============================================================

(function () {
  const paths = {
    cortex: `
      <path d="M12 3.4c4.8 0 8.6 3.8 8.6 8.6s-3.8 8.6-8.6 8.6-8.6-3.8-8.6-8.6S7.2 3.4 12 3.4Z" fill="none" stroke="currentColor" stroke-width="1.8"/>
      <path d="M15.8 7.2a5.3 5.3 0 1 0 0 9.6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M8.7 9.1h4.1l2.6 2.9-2.6 2.9H8.7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="8.2" cy="9.1" r="1.25" fill="currentColor"/>
      <circle cx="15.8" cy="12" r="1.25" fill="currentColor"/>
      <circle cx="8.2" cy="14.9" r="1.25" fill="currentColor"/>`,
    home: `<path d="M4.5 11.2 12 5l7.5 6.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.7 10.6v8.1h10.6v-8.1" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M10 18.6v-4.5h4v4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`,
    plus: `<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/>`,
    menu: `<path d="M7 9.5h10L12 15z" fill="currentColor"/>`,
    close: `<path d="M7 7l10 10M17 7 7 17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`,
    mic: `<path d="M9 7a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v3M9 20h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
    micOff: `<path d="M9 7a3 3 0 0 1 5.4-1.8M15 9.4V12a3 3 0 0 1-4.7 2.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M6.5 11.5a5.5 5.5 0 0 0 8.8 4.4M17.5 11.5a5.5 5.5 0 0 1-.7 2.7M12 17v3M9 20h6M4.8 4.8l14.4 14.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
    speaker: `<path d="M4.5 9.5h3.3L12 6v12l-4.2-3.5H4.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M15.3 9a4.6 4.6 0 0 1 0 6M17.7 6.7a8 8 0 0 1 0 10.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
    speakerOff: `<path d="M4.5 9.5h3.3L12 6v8.1M8.8 14.5 12 18v-2.6M16.8 9.2l3.4 3.4M20.2 9.2l-3.4 3.4M4.8 4.8l14.4 14.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
    camera: `<path d="M4.5 8.2h10.8v8.7H4.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="m15.3 11 4.2-2.4v7.8L15.3 14z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`,
    screen: `<path d="M4 6.5h16v10H4zM9 20h6M12 16.5V20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
    phone: `<path d="M7.2 6.2c.5 5.2 5.4 10.1 10.6 10.6l1.6-2.5-3.4-2-1.7 1.3a9.1 9.1 0 0 1-3.9-3.9L11.7 8l-2-3.4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`,
    settings: `<path d="M12 8.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2Z" fill="none" stroke="currentColor" stroke-width="2"/><path d="m19.1 13.7 1.2 1.1-1.8 3.1-1.6-.5a7.2 7.2 0 0 1-1.6.9l-.3 1.7H9l-.3-1.7a7.2 7.2 0 0 1-1.6-.9l-1.6.5-1.8-3.1 1.2-1.1a7.2 7.2 0 0 1 0-1.8l-1.2-1.1 1.8-3.1 1.6.5a7.2 7.2 0 0 1 1.6-.9L9 5.6h6l.3 1.7a7.2 7.2 0 0 1 1.6.9l1.6-.5 1.8 3.1-1.2 1.1a7.2 7.2 0 0 1 0 1.8Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>`,
    hash: `<path d="M9.5 4.8 7.8 19.2M16.2 4.8l-1.7 14.4M5 9h14M4.3 15h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
    code: `<path d="m9.2 8-4 4 4 4M14.8 8l4 4-4 4M13 5.8 11 18.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
    attach: `<path d="M8.2 12.7 13.8 7a3 3 0 0 1 4.3 4.2l-7.2 7.2a4.5 4.5 0 0 1-6.4-6.4l7.4-7.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="m9 15 6.6-6.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
    copy: `<path d="M8 8.5h9.5V19H8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M5.5 15.5H4.8A1.8 1.8 0 0 1 3 13.7V5.8A1.8 1.8 0 0 1 4.8 4h7.9a1.8 1.8 0 0 1 1.8 1.8v.7" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`,
    file: `<path d="M7 4.5h6l4 4v11H7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M13 4.5v4h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`,
    crown: `<path d="M5 17.5h14l1-9-4.3 3.1L12 5.5l-3.7 6.1L4 8.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M7 20h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
    trash: `<path d="M6.5 8h11M10 8V6h4v2M8 8l.8 12h6.4L16 8M10.5 11v6M13.5 11v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
    live: `<path d="M5.5 7.5h13v8h-13zM9.3 19h5.4M12 15.5V19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="17.4" cy="8.5" r="1.6" fill="currentColor"/>`
  };

  function svg(name, cls = 'app-icon') {
    return `<svg class="${cls}" data-icon-name="${name}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name] || paths.cortex}</svg>`;
  }

  function hydrate(root = document) {
    root.querySelectorAll('[data-icon]').forEach((node) => {
      node.innerHTML = svg(node.dataset.icon);
    });
  }

  window.Icons = { svg, hydrate };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => hydrate());
  else hydrate();
})();
