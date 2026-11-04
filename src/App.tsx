function App() {
  return (
    <main className="workspace">
      <header className="topbar">
        <a className="brand" href="/" aria-label="JPEG Glitch Editor home">
          <span className="brand-mark" aria-hidden="true">
            J
          </span>
          <span>JPEG Glitch Editor</span>
        </a>
        <span className="local-badge">
          <span className="status-dot" aria-hidden="true" />
          Local workspace
        </span>
      </header>

      <section className="canvas" aria-labelledby="workspace-title">
        <div className="canvas-grid" aria-hidden="true" />
        <div className="welcome">
          <div className="eyebrow">JPEG STRUCTURE · CREATIVE CONTROL</div>
          <h1 id="workspace-title">Make room for happy accidents.</h1>
          <p>
            A non-destructive workspace for exploring the building blocks of
            JPEG images.
          </p>
          <div className="milestone-note">
            <span className="note-index">00</span>
            <span>Workspace foundation ready. Image import is next.</span>
          </div>
        </div>
        <div className="canvas-coordinate" aria-hidden="true">
          00 × 00
        </div>
      </section>

      <footer className="statusbar">
        <span>Original files stay on your device.</span>
        <span className="statusbar-right">
          <span>JPEG DOMAIN</span>
          <span className="status-divider" aria-hidden="true" />
          <span>FOUNDATION 0.1</span>
        </span>
      </footer>
    </main>
  );
}

export default App;
