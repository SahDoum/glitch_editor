import { examplePhotoUrl } from "./example-photo";

export function WelcomeScreen({
  onOpenPhoto,
  onTryExample,
  busy,
}: {
  readonly onOpenPhoto: () => void;
  readonly onTryExample: () => void;
  readonly busy: boolean;
}) {
  return (
    <div className="welcome">
      <div className="welcome-content">
        <h1>Glitch photo editor</h1>
        <div className="welcome-actions">
          <button
            className="welcome-button"
            type="button"
            onClick={onOpenPhoto}
            disabled={busy}
          >
            Open photo
          </button>
          <p>Drop a JPG or JPEG here</p>
          <button
            className="welcome-example tool-toggle"
            type="button"
            onClick={onTryExample}
            disabled={busy}
          >
            Try an example
          </button>
        </div>
        <p>Photos are processed in your browser.</p>
      </div>
      <figure className="welcome-comparison">
        <img
          width="512"
          height="512"
          src={examplePhotoUrl("original")}
          alt="Astronaut Eileen Collins in an orange space suit"
        />
        <img
          width="512"
          height="512"
          src={examplePhotoUrl("pixelate")}
          alt=""
          className="welcome-effect"
        />
        <figcaption>
          <span>Original</span>
          <span>With effect</span>
        </figcaption>
      </figure>
      <footer className="welcome-footer">
        <details>
          <summary>About</summary>
          <p>Make room for happy accidents.</p>
          <p>Example photo of Eileen Collins by NASA.</p>
          <nav className="contact-links" aria-label="Contact">
            <a href="https://instagram.com/sahdoum">Instagram</a>
            <a href="https://t.me/achekhonte">Telegram</a>
            <a href="https://github.com/sahdoum">GitHub</a>
          </nav>
        </details>
        {import.meta.env.VITE_GTM_CONTAINER_ID && (
          <p className="analytics-notice">
            This site uses Google Tag Manager for visit analytics. Google
            receives visit data.{" "}
            <a href="https://policies.google.com/privacy">
              Google privacy policy
            </a>
          </p>
        )}
      </footer>
    </div>
  );
}
