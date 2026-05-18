import React, { useCallback, useEffect, useRef, useState } from 'react';
import satori from 'satori';
import { SatoriTemplate as Template } from './Template.jsx';

export default function App() {
  const [svgOutput, setSvgOutput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [title, setTitle] = useState('Hello From Vite!');
  const [subtitle, setSubtitle] = useState('This is live updating in the browser.');

  const fontBufferRef = useRef(null);
  const generateRef = useRef(null);

  const loadFont = useCallback(async () => {
    if (fontBufferRef.current) return fontBufferRef.current;
    const res = await fetch('/Roboto-Regular.ttf');
    if (!res.ok) throw new Error(`Font fetch failed: ${res.status}`);
    fontBufferRef.current = await res.arrayBuffer();
    return fontBufferRef.current;
  }, []);

  const generateSvg = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // Dynamic import with cache-bust so each compile picks up the latest
      // Template source — Fast Refresh self-accepts inside Template.jsx, so
      // the static import binding above never updates on HMR.
      const mod = await import(/* @vite-ignore */ `./Template.jsx?t=${Date.now()}`);
      const FreshTemplate = mod.SatoriTemplate;

      const fontBuffer = await loadFont();

      const svg = await satori(
        <FreshTemplate title={title} subtitle={subtitle} />,
        {
          width: 800,
          height: 400,
          fonts: [
            { name: 'Roboto', data: fontBuffer, weight: 400, style: 'normal' },
          ],
        }
      );

      setSvgOutput(svg);
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [title, subtitle, loadFont]);

  // Keep a stable ref to the latest generateSvg so the HMR listener (which
  // only registers once) always calls the current closure.
  generateRef.current = generateSvg;

  // Debounced auto-compile on mount and whenever props change.
  useEffect(() => {
    const t = setTimeout(() => { generateSvg(); }, 300);
    return () => clearTimeout(t);
  }, [generateSvg]);

  // Recompile when Template.jsx is hot-updated.
  useEffect(() => {
    if (!import.meta.hot) return;
    const handler = (payload) => {
      const touched = payload?.updates?.some((u) => u.path.includes('/Template.'));
      if (touched) generateRef.current?.();
    };
    import.meta.hot.on('vite:afterUpdate', handler);
    return () => import.meta.hot.off?.('vite:afterUpdate', handler);
  }, []);

  const downloadSvg = () => {
    const blob = new Blob([svgOutput], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'satori-output.svg';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', background: '#1e293b', minHeight: '100vh', color: '#fff' }}>
      <h2>
        Satori Developer Sandbox{' '}
        <span style={{ fontSize: '14px', color: '#94a3b8', fontWeight: 'normal' }}>
          {loading ? '· compiling…' : ''}
        </span>
      </h2>

      <div style={{ marginBottom: '20px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          style={{ padding: '8px', borderRadius: '4px', border: 'none' }}
        />
        <input
          value={subtitle}
          onChange={(e) => setSubtitle(e.target.value)}
          placeholder="Subtitle"
          style={{ padding: '8px', borderRadius: '4px', border: 'none', width: '300px' }}
        />
        {svgOutput && (
          <button
            onClick={downloadSvg}
            style={{ padding: '8px 16px', cursor: 'pointer', borderRadius: '4px', border: 'none', background: '#22c55e', fontWeight: 'bold' }}
          >
            Download SVG
          </button>
        )}
      </div>

      {error && (
        <div style={{ marginBottom: '20px', padding: '12px', background: '#7f1d1d', borderRadius: '4px', color: '#fecaca' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: '40px', flexWrap: 'wrap' }}>
        <div>
          <h3>1. Live HTML Preview (Vite HMR)</h3>
          <div style={{ border: '2px solid #475569', borderRadius: '8px', overflow: 'hidden' }}>
            <Template title={title} subtitle={subtitle} />
          </div>
        </div>

        <div>
          <h3>2. Satori Rendered SVG</h3>
          {svgOutput ? (
            <div
              style={{ border: '2px solid #22c55e', borderRadius: '8px', overflow: 'hidden', background: '#000' }}
              dangerouslySetInnerHTML={{ __html: svgOutput }}
            />
          ) : (
            <div style={{ width: '800px', height: '400px', border: '2px dashed #475569', borderRadius: '8px', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#64748b' }}>
              {loading ? 'Compiling…' : 'Waiting for first compile'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
