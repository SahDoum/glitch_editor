declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

export function startAnalytics(containerId: string | undefined): void {
  if (!containerId) return;
  if (!/^GTM-[A-Z0-9]+$/.test(containerId)) {
    console.warn("Google Tag Manager is disabled: invalid container ID.");
    return;
  }

  const dataLayer = (window.dataLayer ??= []);
  dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(containerId)}`;
  script.onerror = () =>
    console.warn("Google Tag Manager could not be loaded.");
  document.head.appendChild(script);
}
